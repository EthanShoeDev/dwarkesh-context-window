#!/usr/bin/env bun
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem } from '@effect/platform';
import { S3 } from '@effect-aws/client-s3';
import * as Cli from '@effect/cli';
import { Effect, Data } from 'effect';
import { getSubtitles } from 'youtube-captions-scraper';
import { InfisicalSDK } from '@infisical/sdk';
import Groq from 'groq-sdk';
import * as path from 'node:path';

const videoUrl = 'https://www.youtube.com/watch?v=_9V_Hbe-N1A';

// =============================================================================
// Errors
// =============================================================================

class YtDlpError extends Data.TaggedError('YtDlpError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class InfisicalError extends Data.TaggedError('InfisicalError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class GroqTranscribeError extends Data.TaggedError('GroqTranscribeError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class S3UploadError extends Data.TaggedError('S3UploadError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// =============================================================================
// Configuration
// =============================================================================

const INFISICAL_SITE_URL = 'https://infisical.ethanshoe.dev';
const INFISICAL_PROJECT_ID = 'a7f3ac80-8dce-488c-8e53-2f002832d237';
const INFISICAL_ENVIRONMENT = 'dev';
const GROQ_SECRET_NAME = 'GROQ_API_KEY';
const ALARIK_ACCESS_KEY_SECRET_NAME = 'ALARIK_S3_ACCESS_KEY';
const ALARIK_SECRET_KEY_SECRET_NAME = 'ALARIK_S3_SECRET_KEY';
const ALARIK_ENDPOINT = 'https://alarik-api.ethanshoe.dev';
const ALARIK_BUCKET = 'dwarkesh-context-window-audio';
const PRESIGNED_URL_EXPIRY_SECONDS = 3 * 24 * 60 * 60; // 3 days
const CACHE_DIR = 'node_modules/.cache/audio';
const CONTENT_DIR = 'src/content';

// =============================================================================
// Infisical Service
// =============================================================================

/**
 * Infisical service for fetching secrets.
 * 
 * This service handles authentication with Infisical using Universal Auth
 * and provides methods to fetch secrets from the configured project/environment.
 * 
 * Requires environment variables:
 * - INFISICAL_CLIENT_ID: Machine Identity client ID
 * - INFISICAL_CLIENT_SECRET: Machine Identity client secret
 */
class Infisical extends Effect.Service<Infisical>()('Infisical', {
  effect: Effect.gen(function* () {
    const clientId = process.env.INFISICAL_CLIENT_ID;
    const clientSecret = process.env.INFISICAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return yield* Effect.fail(
        new InfisicalError({
          message:
            'Missing INFISICAL_CLIENT_ID or INFISICAL_CLIENT_SECRET environment variables. ' +
            'Please create a Machine Identity in Infisical and set these variables.',
        })
      );
    }

    yield* Effect.log('Authenticating with Infisical...');

    const client = new InfisicalSDK({
      siteUrl: INFISICAL_SITE_URL,
    });

    // Authenticate with Universal Auth
    yield* Effect.tryPromise({
      try: () =>
        client.auth().universalAuth.login({
          clientId,
          clientSecret,
        }),
      catch: (error) =>
        new InfisicalError({
          message: 'Failed to authenticate with Infisical',
          cause: error,
        }),
    });

    yield* Effect.log('Infisical authentication successful');

    return {
      /**
       * Fetches a secret by name from Infisical.
       */
      getSecret: (secretName: string) =>
        Effect.tryPromise({
          try: () =>
            client.secrets().getSecret({
              projectId: INFISICAL_PROJECT_ID,
              environment: INFISICAL_ENVIRONMENT,
              secretName,
            }),
          catch: (error) =>
            new InfisicalError({
              message: `Failed to fetch secret '${secretName}' from Infisical`,
              cause: error,
            }),
        }).pipe(Effect.map((secret) => secret.secretValue)),
    };
  }),
}) {}

/**
 * Fetches the Groq API key from Infisical.
 * 
 * @returns Effect that resolves to the Groq API key
 */
export function getGroqApiKey() {
  return Effect.gen(function* () {
    const infisical = yield* Infisical;
    yield* Effect.log('Fetching Groq API key from Infisical...');
    const apiKey = yield* infisical.getSecret(GROQ_SECRET_NAME);
    yield* Effect.log('Successfully retrieved Groq API key');
    return apiKey;
  });
}

/**
 * Fetches Alarik S3 credentials from Infisical.
 * 
 * @returns Effect that resolves to { accessKeyId, secretAccessKey }
 */
export function getAlarikCredentials() {
  return Effect.gen(function* () {
    const infisical = yield* Infisical;
    yield* Effect.log('Fetching Alarik S3 credentials from Infisical...');

    // Fetch both secrets in parallel
    const [accessKeyId, secretAccessKey] = yield* Effect.all([
      infisical.getSecret(ALARIK_ACCESS_KEY_SECRET_NAME),
      infisical.getSecret(ALARIK_SECRET_KEY_SECRET_NAME),
    ]);

    yield* Effect.log('Successfully retrieved Alarik S3 credentials');

    return { accessKeyId, secretAccessKey };
  });
}

// =============================================================================
// Helpers
// =============================================================================

function videoIdFromUrl(url: string): string {
  const urlObj = new URL(url);
  const videoId = urlObj.searchParams.get('v');
  if (!videoId) {
    throw new Error('No video ID found in URL');
  }
  return videoId;
}

/**
 * Downloads audio from a YouTube video using yt-dlp via nix run.
 * 
 * @param url - The YouTube video URL to download audio from
 * @returns Effect that resolves to the path of the downloaded audio file and video metadata
 */
export function downloadAudioFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Downloading audio from: ${url}`);

    const fs = yield* FileSystem.FileSystem;

    // Ensure cache directory exists
    yield* fs.makeDirectory(CACHE_DIR, { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new YtDlpError({
            message: `Failed to create cache directory: ${CACHE_DIR}`,
            cause: error,
          })
      )
    );

    // Use a predictable output template: videoId_title.mp3
    // %(id)s is the video ID, %(title)s is the video title
    const outputTemplate = path.join(CACHE_DIR, '%(id)s_%(title)s.%(ext)s');

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
      url
    );

    // Execute the command and capture output
    const output = yield* Command.string(command).pipe(
      Effect.mapError(
        (error) =>
          new YtDlpError({
            message: `Failed to download audio using yt-dlp`,
            cause: error,
          })
      )
    );

    // The --print after_move:filepath outputs the final file path
    const filePath = output.trim();

    yield* Effect.log('Audio download completed');
    yield* Effect.log(`Downloaded to: ${filePath}`);

    // Extract video ID and title from filename for later use
    const filename = path.basename(filePath, '.mp3');
    const underscoreIndex = filename.indexOf('_');
    const videoId = underscoreIndex > 0 ? filename.slice(0, underscoreIndex) : filename;
    const videoTitle =
      underscoreIndex > 0 ? filename.slice(underscoreIndex + 1) : filename;

    return {
      filePath,
      videoId,
      videoTitle,
    };
  });
}

// =============================================================================
// S3 Upload
// =============================================================================

/**
 * Uploads an audio file to Alarik S3-compatible storage and returns a presigned URL.
 * 
 * @param options - Configuration options
 * @param options.filePath - Local path to the audio file
 * @param options.key - S3 object key (path in bucket)
 * @param options.accessKeyId - Alarik S3 access key
 * @param options.secretAccessKey - Alarik S3 secret key
 * @returns Effect that resolves to the presigned URL for the uploaded file
 */
export function uploadAudioToS3(options: {
  filePath: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  // Create S3 layer for Alarik
  const alarikS3Layer = S3.layer({
    endpoint: ALARIK_ENDPOINT,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    forcePathStyle: true, // Required for most S3-compatible storage
    region: 'us-east-1', // Required but ignored by most S3-compatible storage
  });

  return Effect.gen(function* () {
    yield* Effect.log(`Uploading audio to S3: ${options.key}`);

    const fs = yield* FileSystem.FileSystem;

    // Read the audio file
    const fileContent = yield* fs.readFile(options.filePath).pipe(
      Effect.mapError(
        (error) =>
          new S3UploadError({
            message: `Failed to read audio file: ${options.filePath}`,
            cause: error,
          })
      )
    );

    // Upload to S3
    yield* S3.putObject({
      Bucket: ALARIK_BUCKET,
      Key: options.key,
      Body: fileContent,
      ContentType: 'audio/mpeg',
    }).pipe(
      Effect.mapError(
        (error) =>
          new S3UploadError({
            message: 'Failed to upload audio to S3',
            cause: error,
          })
      )
    );

    yield* Effect.log('Audio uploaded to S3 successfully');

    // Generate presigned URL for reading the object
    yield* Effect.log('Generating presigned URL...');

    const presignedUrl = yield* S3.getObject(
      { Bucket: ALARIK_BUCKET, Key: options.key },
      { presigned: true, expiresIn: PRESIGNED_URL_EXPIRY_SECONDS }
    ).pipe(
      Effect.mapError(
        (error) =>
          new S3UploadError({
            message: 'Failed to generate presigned URL',
            cause: error,
          })
      )
    );

    yield* Effect.log(`Presigned URL generated (expires in 3 days)`);

    return presignedUrl;
  }).pipe(Effect.provide(alarikS3Layer));
}

// =============================================================================
// Groq Transcription
// =============================================================================

/**
 * Transcribes audio from a URL using Groq's Whisper API and saves the transcript.
 * 
 * @param options - Configuration options
 * @param options.audioUrl - Presigned URL to the audio file
 * @param options.groqApiKey - Groq API key for authentication
 * @param options.videoId - Video ID for the output filename
 * @param options.videoTitle - Video title for the output filename
 * @param options.language - Language of the audio (defaults to 'en')
 * @returns Effect that resolves to the transcript text and output file path
 */
export function transcribeAudio(options: {
  audioUrl: string;
  groqApiKey: string;
  videoId: string;
  videoTitle: string;
  language?: string;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Transcribing audio from URL...`);

    const fs = yield* FileSystem.FileSystem;

    // Ensure content directory exists
    yield* fs.makeDirectory(CONTENT_DIR, { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new GroqTranscribeError({
            message: `Failed to create content directory: ${CONTENT_DIR}`,
            cause: error,
          })
      )
    );

    // Initialize Groq client
    const groq = new Groq({ apiKey: options.groqApiKey });

    yield* Effect.log('Sending audio URL to Groq for transcription...');

    // Call Groq transcription API with URL
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
    const outputPath = path.join(CONTENT_DIR, outputFilename);

    // Write transcript to file
    yield* fs.writeFileString(outputPath, transcription.text).pipe(
      Effect.mapError(
        (error) =>
          new GroqTranscribeError({
            message: `Failed to write transcript to ${outputPath}`,
            cause: error,
          })
      )
    );

    yield* Effect.log(`Transcript saved to: ${outputPath}`);

    return {
      text: transcription.text,
      outputPath,
    };
  });
}

// =============================================================================
// Full Pipeline
// =============================================================================

/**
 * Downloads audio from YouTube, uploads to S3, transcribes using Groq, and saves the transcript.
 * 
 * This is the main pipeline that combines all steps:
 * 1. Fetch secrets from Infisical (Groq API key + Alarik S3 credentials)
 * 2. Download audio from YouTube using yt-dlp
 * 3. Upload audio to Alarik S3 and get presigned URL
 * 4. Transcribe audio using Groq Whisper (via URL)
 * 5. Save transcript to src/content/
 * 6. Clean up local audio file
 * 
 * @param url - The YouTube video URL
 * @returns Effect that resolves to the transcript result
 */
export function getTranscriptFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    const fs = yield* FileSystem.FileSystem;

    // Step 1: Get secrets from Infisical (in parallel)
    yield* Effect.log('Fetching secrets from Infisical...');
    const [groqApiKey, alarikCredentials] = yield* Effect.all([
      getGroqApiKey(),
      getAlarikCredentials(),
    ]);

    // Step 2: Download audio from YouTube
    const { filePath, videoId, videoTitle } = yield* downloadAudioFromYouTube(url);

    // Step 3: Upload audio to S3 and get presigned URL
    const sanitizedTitle = videoTitle.replace(/[/\\?%*:|"<>]/g, '_');
    const s3Key = `audio/${videoId}_${sanitizedTitle}.mp3`;
    const audioUrl = yield* uploadAudioToS3({
      filePath,
      key: s3Key,
      ...alarikCredentials,
    });

    // Step 4: Clean up local audio file (we have it in S3 now)
    yield* Effect.log(`Cleaning up local audio file: ${filePath}`);
    yield* fs.remove(filePath).pipe(
      Effect.catchAll((error) => {
        // Log warning but don't fail the pipeline if cleanup fails
        return Effect.log(`Warning: Failed to delete local audio file: ${error}`);
      })
    );

    // Step 5: Transcribe audio using URL
    const result = yield* transcribeAudio({
      audioUrl,
      groqApiKey,
      videoId,
      videoTitle,
    });

    yield* Effect.log('Transcript pipeline completed successfully');

    return result;
  }).pipe(Effect.provide(Infisical.Default));
}

const command = Cli.Command.make('get-transcript', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('Getting transcript...');
    const subtitles = yield* Effect.tryPromise({
      try: () =>
        getSubtitles({
          videoID: videoIdFromUrl(videoUrl),
          lang: 'en',
        }),
      catch: (error) => new Error(`Failed to get subtitles: ${String(error)}`),
    });
    yield* Effect.log(subtitles);
  }).pipe(Effect.orDie),
);

const cli = Cli.Command.run(command, {
  name: 'Get Transcript CLI',
  version: 'v0.0.1',
});
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
