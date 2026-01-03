#!/usr/bin/env bun
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem } from '@effect/platform';
import { S3 } from '@effect-aws/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as Cli from '@effect/cli';
import { Effect, Data, Config, Redacted, Layer, Duration } from 'effect';
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
    const [videoId, videoTitle] = lines;
    return { videoId, videoTitle };
  });
}

function downloadAudioFromYouTube(url: string) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(config.audioCacheDir, { recursive: true });

    // First, fetch metadata to determine the expected file path
    yield* Effect.log(`Fetching video metadata for: ${url}`);
    const { videoId, videoTitle } = yield* getVideoMetadata(url);

    // Use base64url encoding for clean filenames
    const encodedTitle = Buffer.from(videoTitle).toString('base64url');
    const expectedFilePath = path.join(config.audioCacheDir, `${videoId}_${encodedTitle}.mp3`);

    // Check if file already exists
    const fileExists = yield* fs.exists(expectedFilePath);
    if (fileExists) {
      yield* Effect.log(`Using cached audio file: ${expectedFilePath}`);
      return { filePath: expectedFilePath, videoId, videoTitle };
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

function transcribeAudio(options: {
  audioUrl: string;
  filePath: string;
  videoId: string;
  videoTitle: string;
  language?: string;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Transcribing audio from URL: ${options.audioUrl}`);

    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

    const fileInfo = yield* getAudioFileInfo(options.filePath);
    yield* Effect.log(`Audio file size: ${fileInfo.formattedSize}`);
    yield* Effect.log(`Audio duration: ${fileInfo.formattedDuration}`);

    yield* fs.makeDirectory(config.contentDir, { recursive: true });

    const groq = new Groq({ apiKey: Redacted.value(config.groqApiKey) });

    yield* Effect.log('Sending audio URL to Groq for transcription...');

    const transcription = yield* Effect.tryPromise({
      try: () =>
        groq.audio.transcriptions.create({
          url: options.audioUrl,
          model: 'whisper-large-v3-turbo',
          language: options.language ?? 'en',
          response_format: 'text',
        }),
      catch: (error) =>
        new GroqTranscribeError({
          message: 'Failed to transcribe audio with Groq',
          cause: error,
        }),
    });

    const encodedTitle = Buffer.from(options.videoTitle).toString('base64url');
    const outputFilename = `${options.videoId}_${encodedTitle}.txt`;
    const outputPath = path.join(config.contentDir, outputFilename);

    yield* fs.writeFileString(outputPath, transcription.text);

    yield* Effect.log(`Transcript saved to: ${outputPath}`);

    return {
      text: transcription.text,
      outputPath,
    };
  });
}

export function getTranscriptFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;

    const { filePath, videoId, videoTitle } = yield* downloadAudioFromYouTube(url);

    // Preprocess audio to 16kHz mono FLAC for smaller size
    const preprocessedPath = yield* preprocessAudio(filePath);

    // Upload preprocessed file to S3 and get public URL
    const encodedTitle = Buffer.from(videoTitle).toString('base64url');
    const s3Key = `audio/${videoId}_${encodedTitle}_16k.mp3`;
    const audioUrl = yield* uploadAudioToS3({
      filePath: preprocessedPath,
      key: s3Key,
      bucket: config.s3Bucket,
    });

    // Transcribe using the public URL
    const result = yield* transcribeAudio({
      audioUrl,
      filePath: preprocessedPath,
      videoId,
      videoTitle,
    });

    // Clean up local files
    yield* Effect.log(`Cleaning up local audio files`);
    yield* fs.remove(filePath);
    yield* fs.remove(preprocessedPath);

    yield* Effect.log('Transcript pipeline completed successfully');

    return result;
  });
}

const s3Layer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* appConfig;
    return S3.layer({
      endpoint: config.s3Endpoint,
      credentials: {
        accessKeyId: Redacted.value(config.s3AccessKey),
        secretAccessKey: Redacted.value(config.s3SecretKey),
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
