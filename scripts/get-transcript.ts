#!/usr/bin/env bun
/**
 * Chunking tutorial: https://github.com/groq/groq-api-cookbook/blob/main/tutorials/06-multimodal/audio-chunking/audio_chunking_tutorial.ipynb
 *
 * Run with: infisical run -- ./scripts/get-transcript.ts --log-level debug
 *
 * Optional chunking config (both can be set, audio splits to satisfy both):
 *   MAX_CHUNK_SIZE_MB=24        # Split if file exceeds this size (Groq limit: 25MB)
 *   MAX_CHUNK_DURATION_SECONDS=600  # Split if duration exceeds this (recommended: 600s = 10min)
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem } from '@effect/platform';
import { S3 } from '@effect-aws/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as Cli from '@effect/cli';
import { Effect, Data, Config, Redacted, Layer, Duration, Option } from 'effect';
import Groq from 'groq-sdk';
import * as path from 'node:path';
import { CommandUtils } from '../src/lib/effect-utils';

const videoUrl = 'https://www.youtube.com/watch?v=_9V_Hbe-N1A';

class YtDlpError extends Data.TaggedError('YtDlpError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class GroqTranscribeError extends Data.TaggedError('GroqTranscribeError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const appConfig = Config.all({
  groqApiKey: Config.redacted('GROQ_API_KEY'),
  s3AccessKey: Config.redacted('S3_ACCESS_KEY'),
  s3SecretKey: Config.redacted('S3_SECRET_KEY'),
  s3Endpoint: Config.string('S3_ENDPOINT'),
  s3Bucket: Config.string('S3_BUCKET').pipe(Config.withDefault('dwarkesh-context-window')),
  audioCacheDir: Config.string('AUDIO_CACHE_DIR').pipe(
    Config.withDefault('node_modules/.cache/audio'),
  ),
  contentDir: Config.string('CONTENT_DIR').pipe(Config.withDefault('src/content')),
  // Toggle between presigned URLs (true) and public-read ACL (false)
  // Set to false if using S3-compatible storage that doesn't support presigned URLs
  // (e.g., Alarik - see https://github.com/achtungsoftware/alarik/issues/1)
  usePresignedLinks: Config.boolean('USE_PRESIGNED_LINKS').pipe(Config.withDefault(true)),
  presignedUrlExpirySeconds: Config.number('PRESIGNED_URL_EXPIRY_SECONDS').pipe(
    Config.withDefault(3600),
  ),
  // Max chunk size in MB for Groq API (25MB free tier, 100MB dev tier via URL)
  // Optional: if not set, file size won't be used as a splitting criterion
  maxChunkSizeMB: Config.option(Config.number('MAX_CHUNK_SIZE_MB')),
  // Max chunk duration in seconds (tutorial recommends 600s = 10 minutes)
  // Optional: if not set, duration won't be used as a splitting criterion
  maxChunkDurationSeconds: Config.option(Config.number('MAX_CHUNK_DURATION_SECONDS')),
  // Overlap between chunks in seconds to avoid cutting words at boundaries
  chunkOverlapSeconds: Config.number('CHUNK_OVERLAP_SECONDS').pipe(Config.withDefault(5)),
});

function getAudioFileInfo(filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Get file size
    const stat = yield* fs.stat(filePath);
    const fileSizeBytes = Number(stat.size);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

    // Get duration using ffprobe (accessed via ffmpeg nix package)
    const ffprobeCmdParts = [
      'nix',
      'shell',
      'nixpkgs#ffmpeg',
      '--command',
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ] as const;

    const result = yield* CommandUtils.withLog(
      Command.make(...ffprobeCmdParts),
      CommandUtils.runCommandBuffered,
    ).pipe(
      Effect.scoped,
      Effect.catchAll(() => Effect.succeed({ exitCode: 1, stdout: '', stderr: '' })),
    );

    const durationSeconds = parseFloat(result.stdout.trim()) || 0;
    const duration = Duration.seconds(durationSeconds);

    return {
      fileSizeBytes,
      fileSizeMB,
      durationSeconds,
      duration,
      formattedDuration: Duration.format(duration),
      formattedSize: `${fileSizeMB.toFixed(2)} MB`,
    };
  });
}

function getVideoMetadata(url: string) {
  return Effect.gen(function* () {
    const cmdParts = [
      'nix',
      'run',
      'nixpkgs#yt-dlp',
      '--',
      '--skip-download',
      '--print',
      '%(id)s',
      '--print',
      '%(title)s',
      '--print',
      '%(upload_date)s',
      url,
    ] as const;

    const result = yield* CommandUtils.withLog(
      Command.make(...cmdParts),
      CommandUtils.runCommandBuffered,
    ).pipe(
      Effect.scoped,
      Effect.mapError(
        (error) => new YtDlpError({ message: 'Failed to fetch video metadata', cause: error }),
      ),
    );

    if (result.exitCode !== 0) {
      throw new YtDlpError({
        message: 'Failed to fetch video metadata',
        cause: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }

    yield* Effect.logDebug(`Raw yt-dlp stdout: ${result.stdout}`);
    yield* Effect.logDebug(`Raw yt-dlp stderr: ${result.stderr}`);

    const lines = result.stdout.trim().split('\n');
    const [videoId, videoTitle, uploadDateRaw] = lines;

    // Convert YYYYMMDD to ISO date format (YYYY-MM-DD)
    const uploadDate = uploadDateRaw
      ? `${uploadDateRaw.slice(0, 4)}-${uploadDateRaw.slice(4, 6)}-${uploadDateRaw.slice(6, 8)}`
      : null;

    return { videoId, videoTitle, uploadDate };
  });
}

function downloadAudioFromYouTube(url: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(config.audioCacheDir, { recursive: true });

    // First, fetch metadata to determine the expected file path
    yield* Effect.log(`Fetching video metadata for: ${url}`);
    const { videoId, videoTitle, uploadDate } = yield* getVideoMetadata(url);

    // Use base64url encoding for clean filenames
    const encodedTitle = Buffer.from(videoTitle).toString('base64url');
    const expectedFilePath = path.join(config.audioCacheDir, `${videoId}_${encodedTitle}.mp3`);

    // Check if file already exists
    const fileExists = yield* fs.exists(expectedFilePath);
    if (fileExists) {
      yield* Effect.log(`Using cached audio file: ${expectedFilePath}`);
      return { filePath: expectedFilePath, videoId, videoTitle, uploadDate };
    }

    // Download the audio
    yield* Effect.log(`Downloading audio from: ${url}`);
    const cmdParts = [
      'nix',
      'run',
      'nixpkgs#yt-dlp',
      '--',
      '-x',
      '--audio-format',
      'mp3',
      '-o',
      expectedFilePath,
      url,
    ] as const;

    const result = yield* CommandUtils.withLog(
      Command.make(...cmdParts),
      CommandUtils.runCommandBuffered,
    ).pipe(
      Effect.scoped,
      Effect.mapError(
        (error) =>
          new YtDlpError({ message: 'Failed to download audio from YouTube', cause: error }),
      ),
    );

    if (result.exitCode !== 0) {
      throw new YtDlpError({
        message: 'Failed to download audio from YouTube',
        cause: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }

    yield* Effect.logDebug(`Raw yt-dlp stdout: ${result.stdout}`);
    yield* Effect.logDebug(`Raw yt-dlp stderr: ${result.stderr}`);

    yield* Effect.log(`Audio download completed: ${expectedFilePath}`);

    return {
      filePath: expectedFilePath,
      videoId,
      videoTitle,
      uploadDate,
    };
  });
}

class FfmpegError extends Data.TaggedError('FfmpegError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function preprocessAudio(filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Compute preprocessed file path: replace extension with _16k.mp3
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    // Use low bitrate MP3 (32kbps is plenty for 16kHz mono speech)
    const preprocessedPath = path.join(dir, `${baseName}_16k.mp3`);

    // Check if already preprocessed
    const exists = yield* fs.exists(preprocessedPath);
    if (exists) {
      yield* Effect.log(`Using cached preprocessed audio: ${preprocessedPath}`);
      return preprocessedPath;
    }

    yield* Effect.log(`Preprocessing audio to 16kHz mono MP3 (32kbps): ${filePath}`);

    // Ensure output directory exists
    yield* fs.makeDirectory(dir, { recursive: true });

    // ffmpeg -i <input> -ar 16000 -ac 1 -b:a 32k <output>
    // 32kbps is sufficient for 16kHz mono speech
    const cmdParts = [
      'nix',
      'shell',
      'nixpkgs#ffmpeg',
      '--command',
      'ffmpeg',
      '-y',
      '-i',
      filePath,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-map',
      '0:a',
      '-b:a',
      '32k',
      preprocessedPath,
    ] as const;

    const result = yield* CommandUtils.withLog(
      Command.make(...cmdParts),
      CommandUtils.runCommandBuffered,
    ).pipe(
      Effect.scoped,
      Effect.mapError(
        (error) => new FfmpegError({ message: 'Failed to preprocess audio', cause: error }),
      ),
    );

    if (result.exitCode !== 0) {
      throw new FfmpegError({
        message: 'Failed to preprocess audio',
        cause: { exitCode: result.exitCode, stderr: result.stderr },
      });
    }

    yield* Effect.log(`Audio preprocessing completed: ${preprocessedPath}`);

    return preprocessedPath;
  });
}

interface AudioChunk {
  filePath: string;
  chunkIndex: number;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Split audio file into chunks based on file size AND/OR duration constraints.
 * Uses the minimum number of splits needed to satisfy BOTH constraints (if set).
 * Adds overlap between chunks to avoid cutting words at boundaries.
 *
 * - MAX_CHUNK_SIZE_MB: Optional size constraint (e.g., 24 for Groq's 25MB limit)
 * - MAX_CHUNK_DURATION_SECONDS: Optional duration constraint (e.g., 600 = 10 minutes, recommended by Groq)
 *
 * If neither is set, no splitting occurs.
 *
 * Based on Groq's audio chunking tutorial:
 * https://github.com/groq/groq-api-cookbook/tree/main/tutorials/audio-chunking
 */
function splitAudio(filePath: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    const fileInfo = yield* getAudioFileInfo(filePath);
    const overlapSeconds = config.chunkOverlapSeconds;

    // Calculate chunks needed for each constraint (if set)
    let chunksForSize = 1;
    let chunksForDuration = 1;

    if (Option.isSome(config.maxChunkSizeMB)) {
      const maxChunkBytes = config.maxChunkSizeMB.value * 1024 * 1024;
      chunksForSize = Math.ceil(fileInfo.fileSizeBytes / maxChunkBytes);
      yield* Effect.logDebug(
        `Size constraint: ${config.maxChunkSizeMB.value}MB -> ${chunksForSize} chunks needed`,
      );
    }

    if (Option.isSome(config.maxChunkDurationSeconds)) {
      chunksForDuration = Math.ceil(
        fileInfo.durationSeconds / config.maxChunkDurationSeconds.value,
      );
      yield* Effect.logDebug(
        `Duration constraint: ${config.maxChunkDurationSeconds.value}s -> ${chunksForDuration} chunks needed`,
      );
    }

    // Use the maximum to satisfy BOTH constraints
    const numChunks = Math.max(chunksForSize, chunksForDuration);

    // If only 1 chunk needed, no splitting required
    if (numChunks <= 1) {
      yield* Effect.log(
        `No splitting needed (size: ${fileInfo.formattedSize}, duration: ${fileInfo.formattedDuration})`,
      );
      return [
        {
          filePath,
          chunkIndex: 0,
          startSeconds: 0,
          endSeconds: fileInfo.durationSeconds,
        },
      ] as AudioChunk[];
    }

    const chunkDurationSeconds = fileInfo.durationSeconds / numChunks;

    yield* Effect.log(
      `Splitting ${fileInfo.formattedSize} audio (${fileInfo.formattedDuration}) into ${numChunks} chunks (~${chunkDurationSeconds.toFixed(0)}s each)`,
    );

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);

    const chunks: AudioChunk[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startSeconds = Math.max(0, i * chunkDurationSeconds - (i > 0 ? overlapSeconds : 0));
      const endSeconds = Math.min(
        fileInfo.durationSeconds,
        (i + 1) * chunkDurationSeconds + (i < numChunks - 1 ? overlapSeconds : 0),
      );
      const duration = endSeconds - startSeconds;

      const chunkPath = path.join(dir, `${baseName}_chunk${i}${ext}`);

      // Check if chunk already exists (caching)
      const chunkExists = yield* fs.exists(chunkPath);
      if (chunkExists) {
        yield* Effect.log(`Using cached chunk ${i}: ${chunkPath}`);
        chunks.push({ filePath: chunkPath, chunkIndex: i, startSeconds, endSeconds });
        continue;
      }

      yield* Effect.log(
        `Creating chunk ${i + 1}/${numChunks}: ${startSeconds.toFixed(1)}s - ${endSeconds.toFixed(1)}s`,
      );

      // Use ffmpeg to extract the chunk
      const cmdParts = [
        'nix',
        'shell',
        'nixpkgs#ffmpeg',
        '--command',
        'ffmpeg',
        '-y',
        '-i',
        filePath,
        '-ss',
        startSeconds.toString(),
        '-t',
        duration.toString(),
        '-c',
        'copy',
        chunkPath,
      ] as const;

      const result = yield* CommandUtils.withLog(
        Command.make(...cmdParts),
        CommandUtils.runCommandBuffered,
      ).pipe(
        Effect.scoped,
        Effect.mapError(
          (error) => new FfmpegError({ message: `Failed to create chunk ${i}`, cause: error }),
        ),
      );

      if (result.exitCode !== 0) {
        throw new FfmpegError({
          message: `Failed to create chunk ${i}`,
          cause: { exitCode: result.exitCode, stderr: result.stderr },
        });
      }

      chunks.push({ filePath: chunkPath, chunkIndex: i, startSeconds, endSeconds });
    }

    yield* Effect.log(`Created ${chunks.length} audio chunks`);
    return chunks;
  }).pipe(Effect.withLogSpan('splitAudio'));
}

function checkS3Exists(options: { bucket: string; key: string }) {
  return Effect.gen(function* () {
    const result = yield* S3.headObject({
      Bucket: options.bucket,
      Key: options.key,
    }).pipe(
      Effect.map(() => true),
      Effect.catchTag('NotFound', () => Effect.succeed(false)),
      Effect.catchAll(() => Effect.succeed(false)),
    );
    return result;
  });
}

/**
 * Generates a presigned URL for an S3 object.
 */
function generatePresignedUrl(options: { bucket: string; key: string; expiresIn: number }) {
  return Effect.gen(function* () {
    const config = yield* appConfig;

    const client = new S3Client({
      endpoint: config.s3Endpoint,
      credentials: {
        accessKeyId: Redacted.value(config.s3AccessKey),
        secretAccessKey: Redacted.value(config.s3SecretKey),
      },
      forcePathStyle: true,
      region: 'us-east-1',
    });

    const command = new GetObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
    });

    const url = yield* Effect.tryPromise({
      try: () => getSignedUrl(client, command, { expiresIn: options.expiresIn }),
      catch: (error) => new Error(`Failed to generate presigned URL`, { cause: error }),
    });

    return url;
  });
}

/**
 * Uploads audio to S3 and returns a URL for accessing it.
 *
 * Behavior depends on USE_PRESIGNED_LINKS config:
 * - true: Uses presigned URLs (works with standard S3 and compatible storage like rustfs)
 * - false: Uses public-read ACL (fallback for storage that doesn't support presigned URLs,
 *   e.g., Alarik - see https://github.com/achtungsoftware/alarik/issues/1)
 */
function uploadAudioToS3(options: { filePath: string; key: string; bucket: string }) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    // Check if already uploaded
    const exists = yield* checkS3Exists({ bucket: options.bucket, key: options.key });
    if (exists) {
      yield* Effect.log(`Audio already exists in S3: ${options.key}`);

      if (config.usePresignedLinks) {
        const presignedUrl = yield* generatePresignedUrl({
          bucket: options.bucket,
          key: options.key,
          expiresIn: config.presignedUrlExpirySeconds,
        });
        yield* Effect.logDebug(`Presigned URL: ${presignedUrl}`);
        return presignedUrl;
      } else {
        const publicUrl = `${config.s3Endpoint}/${options.bucket}/${options.key}`;
        return publicUrl;
      }
    }

    yield* Effect.log(`Uploading audio to S3: ${options.key} to bucket: ${options.bucket}`);

    const fileContent = yield* fs.readFile(options.filePath);

    if (config.usePresignedLinks) {
      // Upload without ACL, use presigned URL for access
      yield* S3.putObject({
        Bucket: options.bucket,
        Key: options.key,
        Body: fileContent,
        ContentType: 'audio/mpeg',
      });

      yield* Effect.log('Audio uploaded to S3 successfully');

      const presignedUrl = yield* generatePresignedUrl({
        bucket: options.bucket,
        key: options.key,
        expiresIn: config.presignedUrlExpirySeconds,
      });
      yield* Effect.logDebug(`Presigned URL: ${presignedUrl}`);

      return presignedUrl;
    } else {
      // Upload with public-read ACL for storage that doesn't support presigned URLs
      yield* S3.putObject({
        Bucket: options.bucket,
        Key: options.key,
        Body: fileContent,
        ContentType: 'audio/mpeg',
        ACL: 'public-read',
      });

      yield* Effect.log('Audio uploaded to S3 successfully');

      const publicUrl = `${config.s3Endpoint}/${options.bucket}/${options.key}`;
      yield* Effect.logDebug(`Public URL: ${publicUrl}`);

      return publicUrl;
    }
  });
}

interface ChunkTranscription {
  chunkIndex: number;
  text: string;
  response: unknown; // Raw Groq API response
}

/**
 * Transcribe a single audio chunk.
 * Returns the transcription text and raw response for this chunk.
 */
function transcribeChunk(options: {
  audioUrl: string;
  chunkIndex: number;
  totalChunks: number;
  language?: string;
}) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const groq = new Groq({ apiKey: Redacted.value(config.groqApiKey) });

    yield* Effect.log(`Transcribing chunk ${options.chunkIndex + 1}/${options.totalChunks}...`);

    const transcription = yield* Effect.tryPromise({
      try: () =>
        groq.audio.transcriptions.create({
          url: options.audioUrl,
          model: 'whisper-large-v3-turbo',
          language: options.language ?? 'en',
          response_format: 'verbose_json',
        }),
      catch: (error) =>
        new GroqTranscribeError({
          message: `Failed to transcribe chunk ${options.chunkIndex}`,
          cause: error,
        }),
    });

    yield* Effect.log(
      `Chunk ${options.chunkIndex + 1}/${options.totalChunks} transcribed (${transcription.text.length} chars)`,
    );

    return {
      chunkIndex: options.chunkIndex,
      text: transcription.text,
      response: transcription,
    } satisfies ChunkTranscription;
  }).pipe(Effect.withLogSpan(`transcribeChunk-${options.chunkIndex}`));
}

/**
 * Merge overlapping transcription chunks.
 * Uses simple word-level deduplication at boundaries.
 *
 * Based on Groq's audio chunking tutorial:
 * https://github.com/groq/groq-api-cookbook/tree/main/tutorials/audio-chunking
 */
function mergeTranscripts(chunks: ChunkTranscription[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0].text;

  // Sort by chunk index to ensure correct order
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  // Simple merge: join with space, then clean up duplicate words at boundaries
  // For overlapping chunks, the same words may appear at the end of one chunk
  // and the start of the next. We do a simple deduplication.
  let result = sorted[0].text;

  for (let i = 1; i < sorted.length; i++) {
    const prevWords = result.split(/\s+/).slice(-10); // Last 10 words of previous
    const nextWords = sorted[i].text.split(/\s+/);

    // Find overlap by looking for matching sequences
    let overlapStart = 0;
    for (let j = 1; j <= Math.min(prevWords.length, 10); j++) {
      const prevEnd = prevWords.slice(-j).join(' ').toLowerCase();
      const nextStart = nextWords.slice(0, j).join(' ').toLowerCase();
      if (prevEnd === nextStart) {
        overlapStart = j;
      }
    }

    // Skip the overlapping words from the next chunk
    const mergedNext = nextWords.slice(overlapStart).join(' ');
    result = result + ' ' + mergedNext;
  }

  // Clean up multiple spaces
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitize a string for use as a filename.
 * Removes/replaces characters that are problematic in filenames.
 */
function sanitizeFilename(title: string): string {
  return (
    title
      // Replace special dashes with regular dash
      .replace(/[–—]/g, '-')
      // Remove characters that are problematic in filenames
      .replace(/[<>:"/\\|?*]/g, '')
      // Replace multiple spaces/underscores with single space
      .replace(/[\s_]+/g, ' ')
      // Trim whitespace
      .trim()
      // Replace spaces with underscores for cleaner filenames
      .replace(/\s+/g, '_')
      // Limit length to avoid filesystem issues
      .slice(0, 200)
  );
}

interface TranscriptOutput {
  createdAt: string;
  videoMetadata: {
    videoId: string;
    title: string;
    url: string;
    uploadDate: string | null;
  };
  transcript: string;
  rawResponses: unknown[];
}

function transcribeAudio(options: {
  chunkUrls: string[];
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  uploadDate: string | null;
  language?: string;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Transcribing ${options.chunkUrls.length} audio chunk(s)...`);

    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

    yield* fs.makeDirectory(config.contentDir, { recursive: true });

    // Transcribe all chunks in parallel with limited concurrency
    const transcribeEffects = options.chunkUrls.map((url, i) =>
      transcribeChunk({
        audioUrl: url,
        chunkIndex: i,
        totalChunks: options.chunkUrls.length,
        language: options.language,
      }),
    );

    const chunkResults = yield* Effect.all(transcribeEffects, { concurrency: 3 });

    yield* Effect.log(`All ${chunkResults.length} chunks transcribed, merging...`);

    // Merge the transcripts
    const mergedText = mergeTranscripts(chunkResults);

    // Build the output JSON structure
    const output: TranscriptOutput = {
      createdAt: new Date().toISOString(),
      videoMetadata: {
        videoId: options.videoId,
        title: options.videoTitle,
        url: options.videoUrl,
        uploadDate: options.uploadDate,
      },
      transcript: mergedText,
      rawResponses: chunkResults.map((r) => r.response),
    };

    const cleanTitle = sanitizeFilename(options.videoTitle);
    const outputFilename = `${options.videoId}_${cleanTitle}.json`;
    const outputPath = path.join(config.contentDir, outputFilename);

    yield* fs.writeFileString(outputPath, JSON.stringify(output, null, 2));

    yield* Effect.log(`Transcript saved to: ${outputPath} (${mergedText.length} chars)`);

    return {
      text: mergedText,
      outputPath,
      output,
    };
  }).pipe(Effect.withLogSpan('transcribeAudio'));
}

export function getTranscriptFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    const { filePath, videoId, videoTitle, uploadDate } = yield* downloadAudioFromYouTube(url);

    // Preprocess audio to 16kHz mono MP3 for smaller size
    const preprocessedPath = yield* preprocessAudio(filePath);

    const fileInfo = yield* getAudioFileInfo(preprocessedPath);
    yield* Effect.log(`Audio file size: ${fileInfo.formattedSize}`);
    yield* Effect.log(`Audio duration: ${fileInfo.formattedDuration}`);

    // Split audio into chunks if needed (based on file size)
    const chunks = yield* splitAudio(preprocessedPath);

    // Upload all chunks to S3 in parallel
    const encodedTitle = Buffer.from(videoTitle).toString('base64url');
    const uploadEffects = chunks.map((chunk) => {
      const s3Key = `audio/${videoId}_${encodedTitle}_chunk${chunk.chunkIndex}.mp3`;
      return uploadAudioToS3({
        filePath: chunk.filePath,
        key: s3Key,
        bucket: config.s3Bucket,
      }).pipe(Effect.withLogSpan(`uploadChunk-${chunk.chunkIndex}`));
    });

    yield* Effect.log(`Uploading ${chunks.length} chunk(s) to S3...`);
    const chunkUrls = yield* Effect.all(uploadEffects, { concurrency: 3 }).pipe(
      Effect.withLogSpan('uploadChunks'),
    );

    // Transcribe all chunks
    const result = yield* transcribeAudio({
      chunkUrls,
      videoId,
      videoTitle,
      videoUrl: url,
      uploadDate,
    });

    // Clean up local files
    yield* Effect.log(`Cleaning up local audio files`);
    yield* fs.remove(filePath);
    yield* fs.remove(preprocessedPath);

    // Clean up chunk files (if they're different from preprocessed)
    for (const chunk of chunks) {
      if (chunk.filePath !== preprocessedPath) {
        yield* fs.remove(chunk.filePath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      }
    }

    yield* Effect.log('Transcript pipeline completed successfully');

    return result;
  }).pipe(Effect.withLogSpan('getTranscriptFromYouTube'));
}

const s3Layer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* appConfig;
    const accessKey = Redacted.value(config.s3AccessKey);
    const secretKey = Redacted.value(config.s3SecretKey);

    return S3.layer({
      endpoint: config.s3Endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
      region: 'us-east-1',
    });
  }),
);

const services = Layer.mergeAll(BunContext.layer, s3Layer);

const command = Cli.Command.make('get-transcript', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('Getting transcript...');
    const subtitles = yield* getTranscriptFromYouTube(videoUrl);
    yield* Effect.log(subtitles);
  }).pipe(Effect.orDie),
);

const cli = Cli.Command.run(command, {
  name: 'Get Transcript CLI',
  version: 'v0.0.1',
});

cli(process.argv).pipe(Effect.provide(services), BunRuntime.runMain);
