#!/usr/bin/env bun
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem } from '@effect/platform';
import { S3 } from '@effect-aws/client-s3';
import * as Cli from '@effect/cli';
import { Effect, Data, Config, Redacted, Layer } from 'effect';
import Groq from 'groq-sdk';
import * as path from 'node:path';

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
  s3Bucket: Config.string('S3_BUCKET'),
  presignedUrlExpirySeconds: Config.number('PRESIGNED_URL_EXPIRY_SECONDS').pipe(
    Config.withDefault(3 * 24 * 60 * 60), // 3 days
  ),
  audioCacheDir: Config.string('AUDIO_CACHE_DIR').pipe(
    Config.withDefault('node_modules/.cache/audio'),
  ),
  contentDir: Config.string('CONTENT_DIR').pipe(Config.withDefault('src/content')),
});

function downloadAudioFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Downloading audio from: ${url}`);

    const config = yield* appConfig;

    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(config.audioCacheDir, { recursive: true });
    const outputTemplate = path.join(config.audioCacheDir, '%(id)s_%(title)s.%(ext)s');

    // Build the yt-dlp command using nix run
    // -x: extract audio only
    // --audio-format mp3: convert to mp3 (widely supported by transcription services)
    // -o: output template for filename
    // --print filename: print the final filename after download
    const command = Command.make(
      'nix',
      'run',
      'nixpkgs#yt-dlp',
      '--',
      '-x',
      '--audio-format',
      'mp3',
      '-o',
      outputTemplate,
      '--print',
      'after_move:filepath',
      url,
    );

    const output = yield* Command.string(command).pipe(
      Effect.mapError(
        (error) =>
          new YtDlpError({ message: 'Failed to download audio from YouTube', cause: error }),
      ),
    );

    // The --print after_move:filepath outputs the final file path
    const filePath = output.trim();

    yield* Effect.log(`Audio download completed. Downloaded to: ${filePath}`);

    const filename = path.basename(filePath, '.mp3');
    const underscoreIndex = filename.indexOf('_');
    const videoId = underscoreIndex > 0 ? filename.slice(0, underscoreIndex) : filename;
    const videoTitle = underscoreIndex > 0 ? filename.slice(underscoreIndex + 1) : filename;

    return {
      filePath,
      videoId,
      videoTitle,
    };
  });
}

function uploadAudioToS3(options: {
  filePath: string;
  key: string;
  bucket: string;
  presignedUrlExpirySeconds: number;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Uploading audio to S3: ${options.key} to bucket: ${options.bucket}`);

    const fs = yield* FileSystem.FileSystem;

    const fileContent = yield* fs.readFile(options.filePath);
    yield* S3.putObject({
      Bucket: options.bucket,
      Key: options.key,
      Body: fileContent,
      ContentType: 'audio/mpeg',
    });

    yield* Effect.log('Audio uploaded to S3 successfully');

    yield* Effect.log('Generating presigned URL...');
    const presignedUrl = yield* S3.getObject(
      { Bucket: options.bucket, Key: options.key },
      { presigned: true, expiresIn: options.presignedUrlExpirySeconds },
    );
    yield* Effect.log(
      `Presigned URL generated (expires in ${options.presignedUrlExpirySeconds} seconds)`,
    );

    return presignedUrl;
  });
}

function transcribeAudio(options: {
  audioUrl: string;
  videoId: string;
  videoTitle: string;
  language?: string;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Transcribing audio from URL...`);

    const fs = yield* FileSystem.FileSystem;
    const config = yield* appConfig;

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

    // Generate output filename: videoId_videoTitle.txt
    const sanitizedTitle = options.videoTitle.replace(/[/\\?%*:|"<>]/g, '_');
    const outputFilename = `${options.videoId}_${sanitizedTitle}.txt`;
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

    const sanitizedTitle = videoTitle.replace(/[/\\?%*:|"<>]/g, '_');
    const s3Key = `audio/${videoId}_${sanitizedTitle}.mp3`;
    const audioUrl = yield* uploadAudioToS3({
      filePath,
      key: s3Key,
      bucket: config.s3Bucket,
      presignedUrlExpirySeconds: config.presignedUrlExpirySeconds,
    });

    yield* Effect.log(`Cleaning up local audio file: ${filePath}`);
    yield* fs.remove(filePath);

    const result = yield* transcribeAudio({
      audioUrl,
      videoId,
      videoTitle,
    });

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

const services = Layer.mergeAll(s3Layer);

const command = Cli.Command.make('get-transcript', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('Getting transcript...');
    const subtitles = yield* getTranscriptFromYouTube(videoUrl);
    yield* Effect.log(subtitles);
  }).pipe(Effect.orDie, Effect.provide(services)),
);

const cli = Cli.Command.run(command, {
  name: 'Get Transcript CLI',
  version: 'v0.0.1',
});
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
