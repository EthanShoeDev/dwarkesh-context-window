#!/usr/bin/env bun
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem } from '@effect/platform';
import * as Cli from '@effect/cli';
import { Effect, Data } from 'effect';
import { getSubtitles } from 'youtube-captions-scraper';
import { InfisicalSDK } from '@infisical/sdk';
import Groq from 'groq-sdk';
import * as path from 'node:path';
import * as nodeFs from 'node:fs';

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

// =============================================================================
// Configuration
// =============================================================================

const INFISICAL_SITE_URL = 'https://infisical.ethanshoe.dev';
const INFISICAL_PROJECT_ID = 'a7f3ac80-8dce-488c-8e53-2f002832d237';
const INFISICAL_ENVIRONMENT = 'dev';
const GROQ_SECRET_NAME = 'GROQ_API_KEY';
const CACHE_DIR = 'node_modules/.cache/audio';
const CONTENT_DIR = 'src/content';

// =============================================================================
// Infisical
// =============================================================================

/**
 * Fetches the Groq API key from Infisical using Universal Auth.
 * 
 * Requires environment variables:
 * - INFISICAL_CLIENT_ID: Machine Identity client ID
 * - INFISICAL_CLIENT_SECRET: Machine Identity client secret
 * 
 * @returns Effect that resolves to the Groq API key
 */
export function getGroqApiKey() {
  return Effect.gen(function* () {
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

    yield* Effect.log('Fetching Groq API key from Infisical...');

    // Fetch the secret
    const secret = yield* Effect.tryPromise({
      try: () =>
        client.secrets().getSecret({
          projectId: INFISICAL_PROJECT_ID,
          environment: INFISICAL_ENVIRONMENT,
          secretName: GROQ_SECRET_NAME,
        }),
      catch: (error) =>
        new InfisicalError({
          message: `Failed to fetch secret '${GROQ_SECRET_NAME}' from Infisical`,
          cause: error,
        }),
    });

    yield* Effect.log('Successfully retrieved Groq API key');

    return secret.secretValue;
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
// Groq Transcription
// =============================================================================

/**
 * Transcribes an audio file using Groq's Whisper API and saves the transcript.
 * 
 * @param options - Configuration options
 * @param options.audioFilePath - Path to the audio file to transcribe
 * @param options.groqApiKey - Groq API key for authentication
 * @param options.videoId - Video ID for the output filename
 * @param options.videoTitle - Video title for the output filename
 * @param options.language - Language of the audio (defaults to 'en')
 * @returns Effect that resolves to the transcript text and output file path
 */
export function transcribeAudio(options: {
  audioFilePath: string;
  groqApiKey: string;
  videoId: string;
  videoTitle: string;
  language?: string;
}) {
  return Effect.gen(function* () {
    yield* Effect.log(`Transcribing audio: ${options.audioFilePath}`);

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

    // Create a read stream for the audio file (Groq SDK accepts FsReadStream)
    const audioFile = nodeFs.createReadStream(options.audioFilePath);

    yield* Effect.log('Sending audio to Groq for transcription...');

    // Call Groq transcription API
    const transcription = yield* Effect.tryPromise({
      try: () =>
        groq.audio.transcriptions.create({
          file: audioFile,
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
 * Downloads audio from YouTube, transcribes it using Groq, and saves the transcript.
 * 
 * This is the main pipeline that combines all steps:
 * 1. Fetch Groq API key from Infisical
 * 2. Download audio from YouTube using yt-dlp
 * 3. Transcribe audio using Groq Whisper
 * 4. Save transcript to src/content/
 * 
 * @param url - The YouTube video URL
 * @returns Effect that resolves to the transcript result
 */
export function getTranscriptFromYouTube(url: string) {
  return Effect.gen(function* () {
    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    // Step 1: Get Groq API key from Infisical
    const groqApiKey = yield* getGroqApiKey();

    // Step 2: Download audio from YouTube
    const { filePath, videoId, videoTitle } = yield* downloadAudioFromYouTube(url);

    // Step 3: Transcribe audio
    const result = yield* transcribeAudio({
      audioFilePath: filePath,
      groqApiKey,
      videoId,
      videoTitle,
    });

    yield* Effect.log('Transcript pipeline completed successfully');

    return result;
  });
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
