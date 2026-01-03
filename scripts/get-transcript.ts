#!/usr/bin/env bun
/**
 * Podcast Transcript CLI
 *
 * Commands:
 *   add <youtube-url>              - Add a new video (fetches metadata + creates transcript)
 *   update-metadata <videoId>      - Update metadata for existing video without re-transcribing
 *   update-metadata --all          - Update metadata for all videos
 *   reprocess-transcript <videoId> - Re-download audio and re-transcribe a video
 *   reprocess-transcript --all     - Reprocess all videos
 *   rebuild [--video-id <id>]      - Rebuild transcripts from metadata (for self-hosting)
 *
 * Run with: infisical run -- ./scripts/get-transcript.ts <command> [options]
 *
 * Optional chunking config (both can be set, audio splits to satisfy both):
 *   MAX_CHUNK_SIZE_MB=24             # Split if file exceeds this size (Groq limit: 25MB)
 *   MAX_CHUNK_DURATION_SECONDS=600   # Split if duration exceeds this (recommended: 600s = 10min)
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
import type { PodcastMetadata, Transcript, AudioMetadata } from '../src/lib/schemas';

// ============================================================================
// Errors
// ============================================================================

class YtDlpError extends Data.TaggedError('YtDlpError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class GroqTranscribeError extends Data.TaggedError('GroqTranscribeError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class FfmpegError extends Data.TaggedError('FfmpegError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class MetadataError extends Data.TaggedError('MetadataError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Configuration
// ============================================================================

const appConfig = Config.all({
  groqApiKey: Config.redacted('GROQ_API_KEY'),
  s3AccessKey: Config.redacted('S3_ACCESS_KEY'),
  s3SecretKey: Config.redacted('S3_SECRET_KEY'),
  s3Endpoint: Config.string('S3_ENDPOINT'),
  s3Bucket: Config.string('S3_BUCKET').pipe(Config.withDefault('dwarkesh-context-window')),
  audioCacheDir: Config.string('AUDIO_CACHE_DIR').pipe(
    Config.withDefault('node_modules/.cache/audio'),
  ),
  podcastsMetadataDir: Config.string('PODCASTS_METADATA_DIR').pipe(
    Config.withDefault('src/content/podcasts-metadata'),
  ),
  transcriptsDir: Config.string('TRANSCRIPTS_DIR').pipe(
    Config.withDefault('src/content/transcripts'),
  ),
  usePresignedLinks: Config.boolean('USE_PRESIGNED_LINKS').pipe(Config.withDefault(true)),
  presignedUrlExpirySeconds: Config.number('PRESIGNED_URL_EXPIRY_SECONDS').pipe(
    Config.withDefault(3600),
  ),
  maxChunkSizeMB: Config.option(Config.number('MAX_CHUNK_SIZE_MB')),
  maxChunkDurationSeconds: Config.option(Config.number('MAX_CHUNK_DURATION_SECONDS')),
  chunkOverlapSeconds: Config.number('CHUNK_OVERLAP_SECONDS').pipe(Config.withDefault(5)),
});

// ============================================================================
// Metadata Fetching (yt-dlp)
// ============================================================================

interface YtDlpMetadata {
  id: string;
  title: string;
  description: string | null;
  upload_date: string | null;
  duration: number;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  channel: string;
  channel_id: string;
  channel_url: string;
  channel_follower_count: number | null;
  thumbnail: string | null;
  categories: string[];
  tags: string[];
  webpage_url: string;
  availability: string | null;
}

/**
 * Fetch comprehensive video metadata using yt-dlp JSON output
 */
function getFullVideoMetadata(url: string) {
  return Effect.gen(function* () {
    const cmdParts = ['nix', 'run', 'nixpkgs#yt-dlp', '--', '-j', '--skip-download', url] as const;

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
      return yield* Effect.fail(
        new YtDlpError({
          message: 'Failed to fetch video metadata',
          cause: { exitCode: result.exitCode, stderr: result.stderr },
        }),
      );
    }

    const rawMetadata = JSON.parse(result.stdout) as YtDlpMetadata;

    // Convert upload_date from YYYYMMDD to YYYY-MM-DD
    const uploadDate = rawMetadata.upload_date
      ? `${rawMetadata.upload_date.slice(0, 4)}-${rawMetadata.upload_date.slice(4, 6)}-${rawMetadata.upload_date.slice(6, 8)}`
      : null;

    return {
      videoId: rawMetadata.id,
      title: rawMetadata.title,
      description: rawMetadata.description,
      uploadDate,
      duration: rawMetadata.duration,
      viewCount: rawMetadata.view_count,
      likeCount: rawMetadata.like_count,
      commentCount: rawMetadata.comment_count,
      channel: rawMetadata.channel,
      channelId: rawMetadata.channel_id,
      channelUrl: rawMetadata.channel_url,
      channelFollowerCount: rawMetadata.channel_follower_count,
      thumbnail: rawMetadata.thumbnail,
      categories: rawMetadata.categories ?? [],
      tags: rawMetadata.tags ?? [],
      url: rawMetadata.webpage_url,
      availability: rawMetadata.availability,
    };
  }).pipe(Effect.withLogSpan('getFullVideoMetadata'));
}

// ============================================================================
// Audio Processing
// ============================================================================

function getAudioFileInfo(filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const stat = yield* fs.stat(filePath);
    const fileSizeBytes = Number(stat.size);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

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

function downloadAudioFromYouTube(url: string, videoId: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(config.audioCacheDir, { recursive: true });

    // Use videoId for consistent cache paths
    const expectedFilePath = path.join(config.audioCacheDir, `${videoId}.mp3`);

    // Check if file already exists in cache
    const fileExists = yield* fs.exists(expectedFilePath);
    if (fileExists) {
      yield* Effect.log(`Using cached audio file: ${expectedFilePath}`);
      return expectedFilePath;
    }

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
      return yield* Effect.fail(
        new YtDlpError({
          message: 'Failed to download audio from YouTube',
          cause: { exitCode: result.exitCode, stderr: result.stderr },
        }),
      );
    }

    yield* Effect.log(`Audio download completed: ${expectedFilePath}`);
    return expectedFilePath;
  });
}

function preprocessAudio(filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const preprocessedPath = path.join(dir, `${baseName}_16k.mp3`);

    const exists = yield* fs.exists(preprocessedPath);
    if (exists) {
      yield* Effect.log(`Using cached preprocessed audio: ${preprocessedPath}`);
      return preprocessedPath;
    }

    yield* Effect.log(`Preprocessing audio to 16kHz mono MP3 (32kbps): ${filePath}`);

    yield* fs.makeDirectory(dir, { recursive: true });

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
      return yield* Effect.fail(
        new FfmpegError({
          message: 'Failed to preprocess audio',
          cause: { exitCode: result.exitCode, stderr: result.stderr },
        }),
      );
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

function splitAudio(filePath: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    const fileInfo = yield* getAudioFileInfo(filePath);
    const overlapSeconds = config.chunkOverlapSeconds;

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

    const numChunks = Math.max(chunksForSize, chunksForDuration);

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

      const chunkExists = yield* fs.exists(chunkPath);
      if (chunkExists) {
        yield* Effect.log(`Using cached chunk ${i}: ${chunkPath}`);
        chunks.push({ filePath: chunkPath, chunkIndex: i, startSeconds, endSeconds });
        continue;
      }

      yield* Effect.log(
        `Creating chunk ${i + 1}/${numChunks}: ${startSeconds.toFixed(1)}s - ${endSeconds.toFixed(1)}s`,
      );

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
        return yield* Effect.fail(
          new FfmpegError({
            message: `Failed to create chunk ${i}`,
            cause: { exitCode: result.exitCode, stderr: result.stderr },
          }),
        );
      }

      chunks.push({ filePath: chunkPath, chunkIndex: i, startSeconds, endSeconds });
    }

    yield* Effect.log(`Created ${chunks.length} audio chunks`);
    return chunks;
  }).pipe(Effect.withLogSpan('splitAudio'));
}

// ============================================================================
// S3 Operations
// ============================================================================

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

function uploadAudioToS3(options: { filePath: string; key: string; bucket: string }) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

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

// ============================================================================
// Transcription
// ============================================================================

interface ChunkTranscription {
  chunkIndex: number;
  text: string;
  response: unknown;
}

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

function mergeTranscripts(chunks: ChunkTranscription[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0].text;

  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  let result = sorted[0].text;

  for (let i = 1; i < sorted.length; i++) {
    const prevWords = result.split(/\s+/).slice(-10);
    const nextWords = sorted[i].text.split(/\s+/);

    let overlapStart = 0;
    for (let j = 1; j <= Math.min(prevWords.length, 10); j++) {
      const prevEnd = prevWords.slice(-j).join(' ').toLowerCase();
      const nextStart = nextWords.slice(0, j).join(' ').toLowerCase();
      if (prevEnd === nextStart) {
        overlapStart = j;
      }
    }

    const mergedNext = nextWords.slice(overlapStart).join(' ');
    result = result + ' ' + mergedNext;
  }

  return result.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// File Operations
// ============================================================================

function getMetadataPath(videoId: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    return path.join(config.podcastsMetadataDir, `${videoId}.json`);
  });
}

function getTranscriptPath(videoId: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    return path.join(config.transcriptsDir, `${videoId}.json`);
  });
}

function readPodcastMetadata(videoId: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const metadataPath = yield* getMetadataPath(videoId);

    const exists = yield* fs.exists(metadataPath);
    if (!exists) {
      return yield* Effect.fail(
        new MetadataError({ message: `Metadata not found for video: ${videoId}` }),
      );
    }

    const content = yield* fs.readFileString(metadataPath);
    return JSON.parse(content) as PodcastMetadata;
  });
}

function writePodcastMetadata(metadata: PodcastMetadata) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

    yield* fs.makeDirectory(config.podcastsMetadataDir, { recursive: true });

    const metadataPath = yield* getMetadataPath(metadata.videoId);
    yield* fs.writeFileString(metadataPath, JSON.stringify(metadata, null, 2));

    yield* Effect.log(`Metadata saved to: ${metadataPath}`);
  });
}

function writeTranscript(transcript: Transcript) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

    yield* fs.makeDirectory(config.transcriptsDir, { recursive: true });

    const transcriptPath = yield* getTranscriptPath(transcript.videoId);
    yield* fs.writeFileString(transcriptPath, JSON.stringify(transcript, null, 2));

    yield* Effect.log(`Transcript saved to: ${transcriptPath}`);
  });
}

function listAllVideoIds() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

    const exists = yield* fs.exists(config.podcastsMetadataDir);
    if (!exists) {
      return [];
    }

    const files = yield* fs.readDirectory(config.podcastsMetadataDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  });
}

function checkTranscriptExists(videoId: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const transcriptPath = yield* getTranscriptPath(videoId);
    return yield* fs.exists(transcriptPath);
  });
}

// ============================================================================
// Main Pipeline Functions
// ============================================================================

/**
 * Full pipeline: download, process, transcribe, save
 */
function processVideo(url: string, options: { skipIfExists?: boolean } = {}) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const now = new Date().toISOString();

    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    // 1. Fetch full metadata from YouTube
    yield* Effect.log('Fetching video metadata...');
    const videoMeta = yield* getFullVideoMetadata(url);

    // Check if already exists
    const metadataPath = yield* getMetadataPath(videoMeta.videoId);
    const metadataExists = yield* fs.exists(metadataPath);

    if (metadataExists && options.skipIfExists) {
      yield* Effect.log(`Video ${videoMeta.videoId} already exists, skipping`);
      return { skipped: true, videoId: videoMeta.videoId };
    }

    // 2. Download and preprocess audio
    const audioPath = yield* downloadAudioFromYouTube(url, videoMeta.videoId);
    const originalInfo = yield* getAudioFileInfo(audioPath);

    const preprocessedPath = yield* preprocessAudio(audioPath);
    const preprocessedInfo = yield* getAudioFileInfo(preprocessedPath);

    yield* Effect.log(`Audio file size: ${preprocessedInfo.formattedSize}`);
    yield* Effect.log(`Audio duration: ${preprocessedInfo.formattedDuration}`);

    // 3. Split audio into chunks if needed
    const chunks = yield* splitAudio(preprocessedPath);

    // 4. Upload chunks to S3
    const uploadEffects = chunks.map((chunk) => {
      const s3Key = `audio/${videoMeta.videoId}_chunk${chunk.chunkIndex}.mp3`;
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

    // 5. Transcribe all chunks
    yield* Effect.log(`Transcribing ${chunkUrls.length} audio chunk(s)...`);

    const transcribeEffects = chunkUrls.map((audioUrl, i) =>
      transcribeChunk({
        audioUrl,
        chunkIndex: i,
        totalChunks: chunkUrls.length,
      }),
    );

    const chunkResults = yield* Effect.all(transcribeEffects, { concurrency: 3 });

    yield* Effect.log(`All ${chunkResults.length} chunks transcribed, merging...`);
    const mergedText = mergeTranscripts(chunkResults);

    // 6. Build and save metadata
    const metadata: PodcastMetadata = {
      schemaVersion: '1.0.0',
      videoId: videoMeta.videoId,
      url: videoMeta.url,
      metadataCreatedAt: now,
      metadataLastSyncedAt: now,
      transcriptCreatedAt: now,
      title: videoMeta.title,
      description: videoMeta.description,
      uploadDate: videoMeta.uploadDate,
      duration: videoMeta.duration,
      viewCount: videoMeta.viewCount,
      likeCount: videoMeta.likeCount,
      commentCount: videoMeta.commentCount,
      channel: videoMeta.channel,
      channelId: videoMeta.channelId,
      channelUrl: videoMeta.channelUrl,
      channelFollowerCount: videoMeta.channelFollowerCount,
      thumbnail: videoMeta.thumbnail,
      categories: videoMeta.categories,
      tags: videoMeta.tags,
      availability: videoMeta.availability,
    };

    yield* writePodcastMetadata(metadata);

    // 7. Build and save transcript
    const audioMetadata: AudioMetadata = {
      originalFileSizeBytes: originalInfo.fileSizeBytes,
      preprocessedFileSizeBytes: preprocessedInfo.fileSizeBytes,
      durationSeconds: preprocessedInfo.durationSeconds,
      formattedDuration: preprocessedInfo.formattedDuration,
    };

    const transcript: Transcript = {
      schemaVersion: '1.0.0',
      videoId: videoMeta.videoId,
      createdAt: now,
      audioMetadata,
      transcript: mergedText,
      rawResponses: chunkResults.map((r) => r.response),
    };

    yield* writeTranscript(transcript);

    // 8. Clean up local audio files
    yield* Effect.log('Cleaning up local audio files...');
    yield* fs.remove(audioPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    yield* fs.remove(preprocessedPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    for (const chunk of chunks) {
      if (chunk.filePath !== preprocessedPath) {
        yield* fs.remove(chunk.filePath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      }
    }

    yield* Effect.log(`Transcript pipeline completed for: ${videoMeta.videoId}`);

    return {
      skipped: false,
      videoId: videoMeta.videoId,
      title: videoMeta.title,
      transcriptLength: mergedText.length,
    };
  }).pipe(Effect.withLogSpan('processVideo'));
}

/**
 * Update metadata only (no re-transcription)
 */
function updateVideoMetadata(videoId: string) {
  return Effect.gen(function* () {
    const now = new Date().toISOString();

    // Read existing metadata
    const existingMetadata = yield* readPodcastMetadata(videoId);

    yield* Effect.log(`Updating metadata for: ${existingMetadata.title}`);

    // Fetch fresh metadata from YouTube
    const freshMeta = yield* getFullVideoMetadata(existingMetadata.url);

    // Merge: keep original creation timestamp, update sync timestamp
    const updatedMetadata: PodcastMetadata = {
      ...existingMetadata,
      metadataLastSyncedAt: now,
      title: freshMeta.title,
      description: freshMeta.description,
      duration: freshMeta.duration,
      viewCount: freshMeta.viewCount,
      likeCount: freshMeta.likeCount,
      commentCount: freshMeta.commentCount,
      channelFollowerCount: freshMeta.channelFollowerCount,
      thumbnail: freshMeta.thumbnail,
      categories: freshMeta.categories,
      tags: freshMeta.tags,
      availability: freshMeta.availability,
    };

    yield* writePodcastMetadata(updatedMetadata);

    // If transcript exists, update its metadata section too
    const transcriptExists = yield* checkTranscriptExists(videoId);
    if (transcriptExists) {
      yield* Effect.log('Transcript exists, metadata updated in metadata file only');
    }

    yield* Effect.log(`Metadata updated for: ${videoId}`);
    return { videoId, title: updatedMetadata.title };
  }).pipe(Effect.withLogSpan('updateVideoMetadata'));
}

// ============================================================================
// CLI Commands
// ============================================================================

// Add command
const addUrlArg = Cli.Args.text({ name: 'url' }).pipe(
  Cli.Args.withDescription('YouTube video URL to transcribe'),
);

const addCommand = Cli.Command.make('add', { url: addUrlArg }, ({ url }) =>
  Effect.gen(function* () {
    yield* Effect.log(`Adding new video: ${url}`);
    const result = yield* processVideo(url);

    if (result.skipped) {
      yield* Effect.log(`Video ${result.videoId} already exists`);
    } else {
      yield* Effect.log(`Successfully added: ${result.title} (${result.transcriptLength} chars)`);
    }
  }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Add a new video (fetch metadata + create transcript)'));

// Update metadata command
const updateMetadataVideoIdArg = Cli.Args.text({ name: 'videoId' }).pipe(
  Cli.Args.withDescription('Video ID to update metadata for'),
  Cli.Args.optional,
);

const updateMetadataAllOption = Cli.Options.boolean('all').pipe(
  Cli.Options.withAlias('a'),
  Cli.Options.withDescription('Update metadata for all videos'),
  Cli.Options.withDefault(false),
);

const updateMetadataCommand = Cli.Command.make(
  'update-metadata',
  { videoId: updateMetadataVideoIdArg, all: updateMetadataAllOption },
  ({ videoId, all }) =>
    Effect.gen(function* () {
      if (all) {
        yield* Effect.log('Updating metadata for all videos...');
        const videoIds = yield* listAllVideoIds();

        if (videoIds.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        yield* Effect.log(`Found ${videoIds.length} videos to update`);

        for (const id of videoIds) {
          yield* updateVideoMetadata(id).pipe(
            Effect.catchAll((error) => {
              const message = 'message' in error ? error.message : JSON.stringify(error);
              return Effect.log(`Failed to update ${id}: ${message}`);
            }),
          );
        }

        yield* Effect.log(`Updated metadata for ${videoIds.length} videos`);
      } else if (Option.isSome(videoId)) {
        yield* updateVideoMetadata(videoId.value);
      } else {
        yield* Effect.log('Please provide a video ID or use --all flag');
      }
    }).pipe(Effect.orDie),
).pipe(
  Cli.Command.withDescription('Update metadata for existing video(s) without re-transcribing'),
);

// Reprocess transcript command
const reprocessVideoIdArg = Cli.Args.text({ name: 'videoId' }).pipe(
  Cli.Args.withDescription('Video ID to reprocess transcript for'),
  Cli.Args.optional,
);

const reprocessAllOption = Cli.Options.boolean('all').pipe(
  Cli.Options.withAlias('a'),
  Cli.Options.withDescription('Reprocess transcripts for all videos'),
  Cli.Options.withDefault(false),
);

const reprocessTranscriptCommand = Cli.Command.make(
  'reprocess-transcript',
  { videoId: reprocessVideoIdArg, all: reprocessAllOption },
  ({ videoId, all }) =>
    Effect.gen(function* () {
      if (all) {
        yield* Effect.log('Reprocessing transcripts for all videos...');
        const videoIds = yield* listAllVideoIds();

        if (videoIds.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        yield* Effect.log(`Found ${videoIds.length} videos to reprocess`);

        for (const id of videoIds) {
          const metadata = yield* readPodcastMetadata(id);
          yield* processVideo(metadata.url).pipe(
            Effect.catchAll((error) => {
              const message = 'message' in error ? error.message : JSON.stringify(error);
              return Effect.log(`Failed to reprocess ${id}: ${message}`);
            }),
          );
        }

        yield* Effect.log(`Reprocessed transcripts for ${videoIds.length} videos`);
      } else if (Option.isSome(videoId)) {
        const metadata = yield* readPodcastMetadata(videoId.value);
        yield* processVideo(metadata.url);
      } else {
        yield* Effect.log('Please provide a video ID or use --all flag');
      }
    }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Re-download audio and re-transcribe video(s)'));

// Rebuild command (for self-hosting)
const rebuildVideoIdOption = Cli.Options.text('video-id').pipe(
  Cli.Options.withDescription('Specific video ID to rebuild'),
  Cli.Options.optional,
);

const rebuildForceOption = Cli.Options.boolean('force').pipe(
  Cli.Options.withAlias('f'),
  Cli.Options.withDescription('Force rebuild even if transcript exists'),
  Cli.Options.withDefault(false),
);

const rebuildCommand = Cli.Command.make(
  'rebuild',
  { videoId: rebuildVideoIdOption, force: rebuildForceOption },
  ({ videoId, force }) =>
    Effect.gen(function* () {
      yield* Effect.log('Rebuilding transcripts from metadata...');
      yield* Effect.log('This command is for self-hosters to generate their own transcripts.');

      const videoIds = Option.isSome(videoId) ? [videoId.value] : yield* listAllVideoIds();

      if (videoIds.length === 0) {
        yield* Effect.log('No videos found in metadata directory');
        return;
      }

      yield* Effect.log(`Found ${videoIds.length} video(s) to rebuild`);

      let processed = 0;
      let skipped = 0;

      for (const id of videoIds) {
        const transcriptExists = yield* checkTranscriptExists(id);

        if (transcriptExists && !force) {
          yield* Effect.log(`Skipping ${id} (transcript exists, use --force to override)`);
          skipped++;
          continue;
        }

        const metadata = yield* readPodcastMetadata(id);
        yield* Effect.log(`Rebuilding transcript for: ${metadata.title}`);

        yield* processVideo(metadata.url).pipe(
          Effect.catchAll((error) => {
            const message = 'message' in error ? error.message : JSON.stringify(error);
            return Effect.log(`Failed to rebuild ${id}: ${message}`);
          }),
        );
        processed++;
      }

      yield* Effect.log(`Rebuild complete: ${processed} processed, ${skipped} skipped`);
    }).pipe(Effect.orDie),
).pipe(
  Cli.Command.withDescription(
    'Rebuild transcripts from metadata (for self-hosting). Iterates over podcasts-metadata/',
  ),
);

// Root command with subcommands
const rootCommand = Cli.Command.make('get-transcript', {}).pipe(
  Cli.Command.withSubcommands([
    addCommand,
    updateMetadataCommand,
    reprocessTranscriptCommand,
    rebuildCommand,
  ]),
  Cli.Command.withDescription('Podcast transcript CLI for managing video transcriptions'),
);

// ============================================================================
// Main
// ============================================================================

/**
 * Creates the S3 layer from config.
 * Only used by commands that need S3 (add, reprocess-transcript, rebuild).
 * Uses Effect.catchAll to allow CLI to start without S3 config (for --help).
 */
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
  }).pipe(
    Effect.catchAll(() =>
      // Return a layer that will fail when actually used
      Effect.succeed(
        S3.layer({
          endpoint: 'http://localhost:9000',
          credentials: { accessKeyId: '', secretAccessKey: '' },
          forcePathStyle: true,
          region: 'us-east-1',
        }),
      ),
    ),
  ),
);

const services = Layer.mergeAll(BunContext.layer, s3Layer);

const cli = Cli.Command.run(rootCommand, {
  name: 'Podcast Transcript CLI',
  version: 'v1.0.0',
});

cli(process.argv).pipe(Effect.provide(services), BunRuntime.runMain);
