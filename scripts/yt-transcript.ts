#!/usr/bin/env bun
/**
 * YouTube Transcript CLI
 *
 * Commands:
 *   add <youtube-url>              - Add a new video (fetches metadata + creates transcript)
 *   update-metadata <videoId>      - Update metadata for existing video without re-transcribing
 *   update-metadata --all          - Update metadata for all videos
 *   reprocess-transcript <videoId> - Re-download audio and re-transcribe a video
 *   reprocess-transcript --all     - Reprocess all videos
 *   rebuild [--video-id <id>]      - Rebuild transcripts from metadata (for self-hosting)
 *
 * Run with: infisical run -- ./scripts/yt-transcript.ts <command> [options]
 *
 * Optional chunking config (both can be set, audio splits to satisfy both):
 *   MAX_CHUNK_SIZE_MB=24             # Split if file exceeds this size (Groq limit: 25MB)
 *   MAX_CHUNK_DURATION_SECONDS=600   # Split if duration exceeds this (recommended: 600s = 10min)
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem, Path } from '@effect/platform';
import { S3 } from '@effect-aws/client-s3';
import * as Cli from '@effect/cli';
import { Effect, Data, Config, Redacted, Layer, Duration, Option, Schema, DateTime } from 'effect';
import Groq from 'groq-sdk';
import { CommandUtils } from '../src/lib/effect-utils';
import { PodcastMetadataSchema } from '@/lib/schemas/podcast-metadata';
import {
  AudioMetadataSchema,
  GroqTranscriptionResponseSchema,
  TranscriptSchema,
} from '@/lib/schemas/transcript';

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

// ============================================================================
// Configuration
// ============================================================================

const GroqTranscriptionModels = {
  'whisper-large-v3': { ratePerHourCents: 11.1 },
  'whisper-large-v3-turbo': { ratePerHourCents: 4.0 },
} as const;

type GroqTranscriptionModel = keyof typeof GroqTranscriptionModels;
const groqTranscriptionModelNames = Object.keys(GroqTranscriptionModels) as [
  GroqTranscriptionModel,
  ...GroqTranscriptionModel[],
];

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
  presignedUrlExpirySeconds: Config.number('PRESIGNED_URL_EXPIRY_SECONDS').pipe(
    Config.withDefault(3600),
    Config.option,
  ),
  maxChunkSizeMB: Config.number('MAX_CHUNK_SIZE_MB').pipe(Config.option),
  maxChunkDurationSeconds: Config.number('MAX_CHUNK_DURATION_SECONDS').pipe(Config.option),
  chunkOverlapSeconds: Config.number('CHUNK_OVERLAP_SECONDS').pipe(Config.withDefault(5)),
  transcriptionModel: Config.literal(...groqTranscriptionModelNames)('TRANSCRIPTION_MODEL').pipe(
    Config.withDefault('whisper-large-v3' satisfies GroqTranscriptionModel),
  ),
});

const logFmt = {
  bytesSize: (bytes: number | bigint) => `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB`,
  duration: (duration: Duration.Duration) => `${duration.pipe(Duration.toSeconds).toFixed(0)}s`,
};

// ============================================================================
// Services
// ============================================================================

class YtDlpService extends Effect.Service<YtDlpService>()('app/YtDlpService', {
  effect: Effect.gen(function* () {
    yield* Effect.logDebug('Initializing YtDlpService');
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return {
      dumpJsonSkipDownload: (url: string) =>
        Effect.gen(function* () {
          const result = yield* CommandUtils.withLog(
            Command.make(
              'yt-dlp',
              '-j', // -j, --dump-json Quiet, but print JSON information for each
              '--skip-download', // --skip-download Do not download the video but write all
              url,
            ),
            CommandUtils.runCommandBufferedWithLog,
          );

          if (result.exitCode !== 0)
            return yield* Effect.fail(
              new YtDlpError({
                message: 'Failed to fetch video metadata',
                cause: { exitCode: result.exitCode, stderr: result.stderr },
              }),
            );

          const rawMetadata = JSON.parse(result.stdout);
          const metadata = yield* Schema.decodeUnknown(YtDlpService.YtDlpMetadataSchema)(
            rawMetadata,
          );

          return metadata;
        }).pipe(Effect.withLogSpan('getFullVideoMetadata')),
      downloadAudioFromYoutube: (url: string, videoId: string) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(config.audioCacheDir, { recursive: true });
          const expectedFilePath = path.join(config.audioCacheDir, `${videoId}.mp3`);
          const fileExists = yield* fs.exists(expectedFilePath);
          if (fileExists) {
            yield* Effect.log(`Using cached audio file: ${expectedFilePath}`);
            return expectedFilePath;
          }

          yield* Effect.log(`Downloading audio from: ${url}`);

          const result = yield* CommandUtils.withLog(
            Command.make(
              'yt-dlp',
              '-x', //  -x, --extract-audio Convert video files to audio-only files
              '--audio-format', // --audio-format FORMAT Format to convert the audio to when -x is
              'mp3',
              '-o',
              expectedFilePath,
              url,
            ),
            CommandUtils.runCommandBufferedWithLog,
          );

          if (result.exitCode !== 0)
            return yield* Effect.fail(
              new YtDlpError({
                message: 'Failed to download audio from YouTube',
                cause: { exitCode: result.exitCode, stderr: result.stderr },
              }),
            );

          yield* Effect.log(`Audio download completed: ${expectedFilePath}`);
          return expectedFilePath;
        }).pipe(Effect.withLogSpan('downloadAudioFromYoutube')),
    };
  }),
  dependencies: [],
}) {
  static readonly YtDlpMetadataSchema = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    upload_date: Schema.NullOr(Schema.String),
    duration: Schema.Number,
    view_count: Schema.NullOr(Schema.Number),
    like_count: Schema.NullOr(Schema.Number),
    comment_count: Schema.NullOr(Schema.Number),
    channel: Schema.String,
    channel_id: Schema.String,
    channel_url: Schema.String,
    channel_follower_count: Schema.NullOr(Schema.Number),
    thumbnail: Schema.NullOr(Schema.String),
    categories: Schema.Array(Schema.String),
    tags: Schema.Array(Schema.String),
    webpage_url: Schema.String,
    availability: Schema.NullOr(Schema.String),
  });
}

interface AudioChunk {
  filePath: string;
  chunkIndex: number;
  startTime: Duration.Duration;
  endTime: Duration.Duration;
}

class FfmpegService extends Effect.Service<FfmpegService>()('app/FfmpegService', {
  effect: Effect.gen(function* () {
    yield* Effect.logDebug('Initializing FfmpegService');

    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const getAudioFileInfo = (filePath: string) =>
      Effect.gen(function* () {
        const fileStat = yield* fs.stat(filePath);

        const result = yield* CommandUtils.withLog(
          Command.make(
            'ffprobe',
            '-v',
            'error', // only print errors, suppress warnings/info
            '-show_entries', // specify which metadata fields to output
            'format=duration', // extract only the file's total duration
            '-of', // set the output printing format (writer)
            'default=noprint_wrappers=1:nokey=1', // output raw value without tags or keys
            filePath,
          ),
          CommandUtils.runCommandBufferedWithLog,
        );

        const durationSeconds = parseFloat(result.stdout.trim());
        const duration = Duration.seconds(durationSeconds);

        return {
          fileStat,
          duration,
        };
      });

    return {
      getAudioFileInfo,
      preprocessAudio: (filePath: string) =>
        Effect.gen(function* () {
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

          const result = yield* CommandUtils.withLog(
            Command.make(
              'ffmpeg',
              '-y', // -y Overwrite output files without asking
              '-i', // -i <input file>  input file name
              filePath,
              '-ar', // -ar <frequency>  set audio sampling frequency (in Hz)
              '16000', // 16000 Hz
              '-ac', // -ac <channels>  set number of audio channels
              '1', // 1 channel (mono)
              '-map', // -map <input_file_number>  select a stream from input file
              '0:a', // select the audio stream from the input file
              '-b:a', // -b:a <bitrate>  set audio bitrate
              '32k', // 32kbps
              preprocessedPath, // output file name
            ),
            CommandUtils.runCommandBufferedWithLog,
          );

          if (result.exitCode !== 0)
            return yield* Effect.fail(
              new FfmpegError({
                message: 'Failed to preprocess audio',
                cause: { exitCode: result.exitCode, stderr: result.stderr },
              }),
            );

          yield* Effect.log(`Audio preprocessing completed: ${preprocessedPath}`);
          return preprocessedPath;
        }),
      splitAudio: (filePath: string) =>
        Effect.gen(function* () {
          const fileInfo = yield* getAudioFileInfo(filePath);
          let chunksForSize = 1;
          let chunksForDuration = 1;

          if (Option.isSome(config.maxChunkSizeMB)) {
            const maxChunkBytes = config.maxChunkSizeMB.value * 1024 * 1024;
            chunksForSize = Math.ceil(Number(fileInfo.fileStat.size) / maxChunkBytes);
            yield* Effect.logDebug(
              `Size constraint: ${config.maxChunkSizeMB.value}MB -> ${chunksForSize} chunks needed`,
            );
          }

          if (Option.isSome(config.maxChunkDurationSeconds)) {
            chunksForDuration = Math.ceil(
              fileInfo.duration.pipe(Duration.toSeconds) / config.maxChunkDurationSeconds.value,
            );
            yield* Effect.logDebug(
              `Duration constraint: ${config.maxChunkDurationSeconds.value}s -> ${chunksForDuration} chunks needed`,
            );
          }

          const numChunks = Math.max(chunksForSize, chunksForDuration);

          if (numChunks <= 1) {
            yield* Effect.log(
              `No splitting needed (size: ${logFmt.bytesSize(fileInfo.fileStat.size)}, duration: ${logFmt.duration(fileInfo.duration)})`,
            );
            return [
              {
                filePath,
                chunkIndex: 0,
                startTime: Duration.zero,
                endTime: fileInfo.duration,
              },
            ] as AudioChunk[];
          }

          const chunkDuration = fileInfo.duration.pipe(
            Duration.divide(numChunks),
            Option.getOrThrowWith(
              () => new FfmpegError({ message: 'Failed to calculate chunk duration' }),
            ),
          );

          yield* Effect.log(
            `Splitting ${logFmt.bytesSize(fileInfo.fileStat.size)} audio (${logFmt.duration(fileInfo.duration)}) into ${numChunks} chunks (~${logFmt.duration(chunkDuration)} each)`,
          );

          const dir = path.dirname(filePath);
          const baseName = path.basename(filePath, path.extname(filePath));
          const ext = path.extname(filePath);

          const chunks: AudioChunk[] = [];

          for (let i = 0; i < numChunks; i++) {
            const clampTime = (time: Duration.Duration) =>
              Duration.clamp({
                minimum: Duration.zero,
                maximum: fileInfo.duration,
              })(time);
            const startTime = clampTime(
              chunkDuration.pipe(
                Duration.times(i),
                Duration.subtract(Duration.seconds(config.chunkOverlapSeconds)),
              ),
            );
            // // const endTime = Math.min(
            // //   fileInfo.duration.pipe(Duration.toSeconds),
            // //   (i + 1) * chunkDuration.pipe(Duration.toSeconds) +
            // //     (i < numChunks - 1 ? config.chunkOverlapSeconds : 0),
            // // );
            // const endTime = Duration.min(
            //   fileInfo.duration,
            //   chunkDuration.pipe(
            //     Duration.times(i + 1),
            //     Duration.sum(Duration.seconds(config.chunkOverlapSeconds)),
            //   ),
            // );
            const endTime = clampTime(
              chunkDuration.pipe(
                Duration.times(i + 1),
                Duration.sum(Duration.seconds(config.chunkOverlapSeconds)),
              ),
            );
            const duration = clampTime(Duration.subtract(endTime, startTime));
            const chunkPath = path.join(dir, `${baseName}_chunk${i}${ext}`);

            const chunkExists = yield* fs.exists(chunkPath);
            if (chunkExists) {
              yield* Effect.log(`Using cached chunk ${i}: ${chunkPath}`);
              chunks.push({ filePath: chunkPath, chunkIndex: i, startTime, endTime });
              continue;
            }

            yield* Effect.log(
              `Creating chunk ${i + 1}/${numChunks}: ${logFmt.duration(startTime)} - ${logFmt.duration(endTime)}`,
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
              startTime.pipe(Duration.toSeconds).toString(),
              '-t',
              duration.pipe(Duration.toSeconds).toString(),
              '-c',
              'copy',
              chunkPath,
            ] as const;

            const result = yield* CommandUtils.withLog(
              Command.make(...cmdParts),
              CommandUtils.runCommandBufferedWithLog,
            );

            if (result.exitCode !== 0)
              return yield* Effect.fail(
                new FfmpegError({
                  message: `Failed to create chunk ${i}`,
                  cause: { exitCode: result.exitCode, stderr: result.stderr },
                }),
              );

            chunks.push({ filePath: chunkPath, chunkIndex: i, startTime, endTime });
          }

          yield* Effect.log(`Created ${chunks.length} audio chunks`);
          return chunks;
        }),
    };
  }),
  dependencies: [],
}) {
  static readonly FfmpegFileInfoSchema = Schema.Struct({
    fileSizeBytes: Schema.Number,
    fileSizeMB: Schema.Number,
    durationSeconds: Schema.Number,
    duration: Schema.Duration,
    formattedDuration: Schema.String,
    formattedSize: Schema.String,
  });
}

class BucketStorageService extends Effect.Service<BucketStorageService>()(
  'app/BucketStorageService',
  {
    effect: Effect.gen(function* () {
      yield* Effect.logDebug('Initializing BucketStorageService');
      const config = yield* appConfig;
      const s3 = yield* S3;
      const fs = yield* FileSystem.FileSystem;

      const checkS3Exists = (options: { bucket: string; key: string }) =>
        s3
          .headObject({
            Bucket: options.bucket,
            Key: options.key,
          })
          .pipe(
            Effect.map(() => true),
            Effect.catchTag('NotFound', () => Effect.succeed(false)),
            Effect.catchAll(() => Effect.succeed(false)),
          );

      const generatePresignedUrl = (options: { bucket: string; key: string; expiresIn: number }) =>
        s3.getObject(
          {
            Bucket: options.bucket,
            Key: options.key,
          },
          { presigned: true, expiresIn: options.expiresIn },
        );
      return {
        checkS3Exists,
        generatePresignedUrl,
        uploadAudioToS3: (options: { filePath: string; key: string; bucket: string }) =>
          Effect.gen(function* () {
            const exists = yield* checkS3Exists({ bucket: options.bucket, key: options.key });
            if (exists) {
              yield* Effect.log(`Audio already exists in S3: ${options.key}`);

              if (Option.isSome(config.presignedUrlExpirySeconds)) {
                const presignedUrl = yield* generatePresignedUrl({
                  bucket: options.bucket,
                  key: options.key,
                  expiresIn: config.presignedUrlExpirySeconds.value,
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

            if (Option.isSome(config.presignedUrlExpirySeconds)) {
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
                expiresIn: config.presignedUrlExpirySeconds.value,
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
          }),
      };
    }),
    dependencies: [],
  },
) {}

interface ChunkTranscription {
  chunkIndex: number;
  text: string;
  response: typeof GroqTranscriptionResponseSchema.Type;
}
class TranscriptionService extends Effect.Service<TranscriptionService>()(
  'app/TranscriptionService',
  {
    effect: Effect.gen(function* () {
      yield* Effect.logDebug('Initializing TranscriptionService');
      const config = yield* appConfig;
      const groq = new Groq({ apiKey: Redacted.value(config.groqApiKey) });
      return {
        transcribeChunk: (options: {
          audioUrl: string;
          chunkIndex: number;
          totalChunks: number;
          language?: string;
        }) =>
          Effect.gen(function* () {
            yield* Effect.log(
              `Transcribing chunk ${options.chunkIndex + 1}/${options.totalChunks}...`,
            );

            const rawGroqResponse = yield* Effect.tryPromise({
              try: () =>
                groq.audio.transcriptions.create({
                  url: options.audioUrl,
                  model: config.transcriptionModel,
                  language: options.language ?? 'en',
                  response_format: 'verbose_json',
                }),
              catch: (error) =>
                new GroqTranscribeError({
                  message: `Failed to transcribe chunk ${options.chunkIndex}`,
                  cause: error,
                }),
            });

            const safeGroqResponse = yield* Schema.decodeUnknown(GroqTranscriptionResponseSchema)(
              rawGroqResponse,
            );

            yield* Effect.log(
              `Chunk ${options.chunkIndex + 1}/${options.totalChunks} transcribed (${safeGroqResponse.text.length} chars)`,
            );

            return {
              chunkIndex: options.chunkIndex,
              text: safeGroqResponse.text,
              response: safeGroqResponse,
            } satisfies ChunkTranscription;
          }),
        mergeTranscripts: (chunks: ChunkTranscription[]) => {
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
        },
      };
    }),
    dependencies: [],
  },
) {}

class FileService extends Effect.Service<FileService>()('app/FileService', {
  effect: Effect.gen(function* () {
    yield* Effect.logDebug('Initializing FileService');
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* appConfig;

    return {
      readPodcastMetadata: (videoId: string) =>
        Effect.gen(function* () {
          const metadataPath = path.join(config.podcastsMetadataDir, `${videoId}.json`);

          const content = yield* fs.readFileString(metadataPath);
          const rawJson = yield* Effect.sync(() => JSON.parse(content));
          return yield* Schema.decodeUnknown(PodcastMetadataSchema)(rawJson);
        }),
      writePodcastMetadata: (metadata: typeof PodcastMetadataSchema.Type) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(config.podcastsMetadataDir, { recursive: true });

          const metadataPath = path.join(
            config.podcastsMetadataDir,
            `${metadata.youtubeVideoId}.json`,
          );
          const metadataObj = yield* Schema.encodeUnknown(PodcastMetadataSchema)(metadata);
          const metadataJson = yield* Effect.sync(() => JSON.stringify(metadataObj, null, 2));
          yield* fs.writeFileString(metadataPath, metadataJson);
          yield* Effect.log(`Metadata saved to: ${metadataPath}`);
        }),
      writeTranscript: (transcript: typeof TranscriptSchema.Type) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(config.transcriptsDir, { recursive: true });

          const transcriptPath = path.join(
            config.transcriptsDir,
            `${transcript.youtubeVideoId}.json`,
          );
          const transcriptObj = yield* Schema.encodeUnknown(TranscriptSchema)(transcript);
          const transcriptJson = yield* Effect.sync(() => JSON.stringify(transcriptObj, null, 2));
          yield* fs.writeFileString(transcriptPath, transcriptJson);

          yield* Effect.log(`Transcript saved to: ${transcriptPath}`);
        }),
      listAllVideoIds: () =>
        Effect.gen(function* () {
          const files = yield* fs.readDirectory(config.podcastsMetadataDir);
          return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
        }),
      checkTranscriptExists: (videoId: string) =>
        Effect.gen(function* () {
          const transcriptPath = path.join(config.transcriptsDir, `${videoId}.json`);
          return yield* fs.exists(transcriptPath);
        }),
    };
  }),
  dependencies: [],
}) {}

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
    const path = yield* Path.Path;
    const ytDlpService = yield* YtDlpService;
    const ffmpegService = yield* FfmpegService;
    const transcriptionService = yield* TranscriptionService;
    const bucketService = yield* BucketStorageService;

    const now = yield* DateTime.now;

    yield* Effect.log(`Starting transcript pipeline for: ${url}`);

    const videoMeta = yield* ytDlpService.dumpJsonSkipDownload(url);

    const metadataPath = path.join(config.podcastsMetadataDir, `${videoMeta.id}.json`);
    const metadataExists = yield* fs.exists(metadataPath);

    if (metadataExists && options.skipIfExists) {
      yield* Effect.log(`Video ${videoMeta.id} already exists, skipping`);
      return { skipped: true, videoMeta };
    }

    const audioPath = yield* ytDlpService.downloadAudioFromYoutube(url, videoMeta.id);
    const originalFileInfo = yield* ffmpegService.getAudioFileInfo(audioPath);

    const preprocessedPath = yield* ffmpegService.preprocessAudio(audioPath);
    const preprocessedInfo = yield* ffmpegService.getAudioFileInfo(preprocessedPath);

    yield* Effect.log(`Audio file size: ${logFmt.bytesSize(preprocessedInfo.fileStat.size)}`);
    yield* Effect.log(`Audio duration: ${logFmt.duration(preprocessedInfo.duration)}`);

    const chunks = yield* ffmpegService.splitAudio(preprocessedPath);

    yield* Effect.log(`Uploading ${chunks.length} chunk(s) to S3...`);
    const chunkUrls = yield* Effect.all(
      chunks.map((chunk) => {
        const s3Key = `audio/${videoMeta.id}_chunk${chunk.chunkIndex}.mp3`;
        return bucketService.uploadAudioToS3({
          filePath: chunk.filePath,
          key: s3Key,
          bucket: config.s3Bucket,
        });
      }),
      { concurrency: 3 },
    );

    yield* Effect.log(`Transcribing ${chunkUrls.length} audio chunk(s)...`);

    const chunkResults = yield* Effect.all(
      chunkUrls.map((audioUrl, i) =>
        transcriptionService.transcribeChunk({
          audioUrl,
          chunkIndex: i,
          totalChunks: chunkUrls.length,
        }),
      ),
      { concurrency: 3 },
    );

    yield* Effect.log(`All ${chunkResults.length} chunks transcribed, merging...`);
    const mergedText = transcriptionService.mergeTranscripts(chunkResults);

    const metadataDuration = Duration.seconds(videoMeta.duration);
    const metadata = new PodcastMetadataSchema({
      schemaVersion: '0.0.1',
      youtubeVideoId: videoMeta.id,
      metadataCreatedAt: now,
      metadataLastSyncedAt: now,
      title: videoMeta.title,
      description: videoMeta.description,
      uploadedAt: videoMeta.upload_date
        ? DateTime.unsafeMake({
            year: parseInt(videoMeta.upload_date.slice(0, 4)),
            month: parseInt(videoMeta.upload_date.slice(4, 6)),
            day: parseInt(videoMeta.upload_date.slice(6, 8)),
          })
        : null,
      duration: metadataDuration,
      viewCount: videoMeta.view_count,
      likeCount: videoMeta.like_count,
      commentCount: videoMeta.comment_count,
      channel: videoMeta.channel,
      channelId: videoMeta.channel_id,
      channelUrl: videoMeta.channel_url,
      channelFollowerCount: videoMeta.channel_follower_count,
      thumbnail: videoMeta.thumbnail,
      categories: videoMeta.categories,
      tags: videoMeta.tags,
      availability: videoMeta.availability,
    });

    const fileService = yield* FileService;
    yield* fileService.writePodcastMetadata(metadata);

    // 7. Build and save transcript
    const audioMetadata: typeof AudioMetadataSchema.Type = {
      originalFileSizeBytes: originalFileInfo.fileStat.size,
      preprocessedFileSizeBytes: preprocessedInfo.fileStat.size,
      duration: preprocessedInfo.duration,
      chunkCount: chunks.length,
    };

    const transcript: typeof TranscriptSchema.Type = {
      schemaVersion: '0.0.1',
      youtubeVideoId: videoMeta.id,

      estimatedCostCents:
        metadataDuration.pipe(Duration.toHours) *
        GroqTranscriptionModels[config.transcriptionModel].ratePerHourCents,

      createdAt: now,
      audioMetadata,
      groqResponses: chunkResults.map((r) => r.response),
    };

    yield* fileService.writeTranscript(transcript);

    // // 8. Clean up local audio files
    // yield* Effect.log('Cleaning up local audio files...');
    // yield* fs.remove(audioPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    // yield* fs.remove(preprocessedPath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    // for (const chunk of chunks) {
    //   if (chunk.filePath !== preprocessedPath) {
    //     yield* fs.remove(chunk.filePath).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    //   }
    // }

    yield* Effect.log(`Transcript pipeline completed for: ${videoMeta.id}`);

    return {
      skipped: false,
      videoId: videoMeta.id,
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
    const fileService = yield* FileService;
    const ytDlpService = yield* YtDlpService;

    const now = yield* DateTime.now;

    const existingMetadata = yield* fileService.readPodcastMetadata(videoId);

    yield* Effect.log(`Updating metadata for: ${existingMetadata.title}`);

    const freshMeta = yield* ytDlpService.dumpJsonSkipDownload(existingMetadata.youtubeUrl);

    const updatedMetadata = new PodcastMetadataSchema({
      schemaVersion: existingMetadata.schemaVersion,
      youtubeVideoId: existingMetadata.youtubeVideoId,
      metadataCreatedAt: existingMetadata.metadataCreatedAt,
      metadataLastSyncedAt: now,
      title: freshMeta.title,
      description: freshMeta.description,
      uploadedAt: existingMetadata.uploadedAt,
      duration: Duration.seconds(freshMeta.duration),
      viewCount: freshMeta.view_count,
      likeCount: freshMeta.like_count,
      commentCount: freshMeta.comment_count,
      channel: freshMeta.channel,
      channelId: freshMeta.channel_id,
      channelUrl: freshMeta.channel_url,
      channelFollowerCount: freshMeta.channel_follower_count,
      thumbnail: freshMeta.thumbnail,
      categories: freshMeta.categories,
      tags: freshMeta.tags,
      availability: freshMeta.availability,
    });

    yield* fileService.writePodcastMetadata(updatedMetadata);

    // If transcript exists, update its metadata section too
    const transcriptExists = yield* fileService.checkTranscriptExists(videoId);
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
      const fileService = yield* FileService;

      if (all) {
        yield* Effect.log('Updating metadata for all videos...');
        const videoIds = yield* fileService.listAllVideoIds();

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
      const fileService = yield* FileService;
      if (all) {
        yield* Effect.log('Reprocessing transcripts for all videos...');
        const videoIds = yield* fileService.listAllVideoIds();

        if (videoIds.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        yield* Effect.log(`Found ${videoIds.length} videos to reprocess`);

        for (const id of videoIds) {
          const metadata = yield* fileService.readPodcastMetadata(id);
          yield* processVideo(metadata.youtubeUrl).pipe(
            Effect.catchAll((error: unknown) => {
              const message = error instanceof Error ? error.message : JSON.stringify(error);
              return Effect.log(`Failed to reprocess ${id}: ${message}`);
            }),
          );
        }

        yield* Effect.log(`Reprocessed transcripts for ${videoIds.length} videos`);
      } else if (Option.isSome(videoId)) {
        const metadata = yield* fileService.readPodcastMetadata(videoId.value);
        yield* processVideo(metadata.youtubeUrl);
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
      const fileService = yield* FileService;

      yield* Effect.log('Rebuilding transcripts from metadata...');
      yield* Effect.log('This command is for self-hosters to generate their own transcripts.');

      const videoIds = Option.isSome(videoId)
        ? [videoId.value]
        : yield* fileService.listAllVideoIds();

      if (videoIds.length === 0) {
        yield* Effect.log('No videos found in metadata directory');
        return;
      }

      yield* Effect.log(`Found ${videoIds.length} video(s) to rebuild`);

      let processed = 0;
      let skipped = 0;

      for (const id of videoIds) {
        const transcriptExists = yield* fileService.checkTranscriptExists(id);

        if (transcriptExists && !force) {
          yield* Effect.log(`Skipping ${id} (transcript exists, use --force to override)`);
          skipped++;
          continue;
        }

        const metadata = yield* fileService.readPodcastMetadata(id);
        yield* Effect.log(`Rebuilding transcript for: ${metadata.title}`);

        yield* processVideo(metadata.youtubeUrl).pipe(
          Effect.catchAll((error: unknown) => {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
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

// Validation commands
const validateMetadataCommand = Cli.Command.make('validate-metadata', {}, () =>
  Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* fs.readDirectory(config.podcastsMetadataDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      yield* Effect.log('No metadata files to validate');
      return;
    }

    yield* Effect.log(`Validating ${jsonFiles.length} metadata file(s)...`);

    let validCount = 0;
    let invalidCount = 0;

    for (const file of jsonFiles) {
      const filePath = path.join(config.podcastsMetadataDir, file);
      const content = yield* fs.readFileString(filePath);
      const rawJson = yield* Effect.sync(() => JSON.parse(content));
      const validation = Schema.decodeUnknown(PodcastMetadataSchema)(rawJson);
      const decoded = yield* Effect.either(validation);

      if (decoded._tag === 'Right') {
        validCount++;
        yield* Effect.logDebug(`✓ ${file} - Valid`);
      } else {
        invalidCount++;
        yield* Effect.log(`✗ ${file} - ${decoded.left.message ?? JSON.stringify(decoded.left)}`);
      }
    }

    yield* Effect.log(`Validation complete: ${validCount} valid, ${invalidCount} invalid`);
  }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Validate all metadata files against schema'));

const validateTranscriptsCommand = Cli.Command.make('validate-transcripts', {}, () =>
  Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* fs.readDirectory(config.transcriptsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      yield* Effect.log('No transcript files to validate');
      return;
    }

    yield* Effect.log(`Validating ${jsonFiles.length} transcript file(s)...`);

    let validCount = 0;
    let invalidCount = 0;

    for (const file of jsonFiles) {
      const filePath = path.join(config.transcriptsDir, file);
      const content = yield* fs.readFileString(filePath);
      const rawJson = yield* Effect.sync(() => JSON.parse(content));
      const validation = Schema.decodeUnknown(TranscriptSchema)(rawJson);
      const decoded = yield* Effect.either(validation);

      if (decoded._tag === 'Right') {
        validCount++;
        yield* Effect.logDebug(`✓ ${file} - Valid`);
      } else {
        invalidCount++;
        yield* Effect.log(`✗ ${file} - ${decoded.left.message ?? JSON.stringify(decoded.left)}`);
      }
    }

    yield* Effect.log(`Validation complete: ${validCount} valid, ${invalidCount} invalid`);
  }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Validate all transcript files against schema'));

// Root command with subcommands
const rootCommand = Cli.Command.make('yt-transcript', {}).pipe(
  Cli.Command.withSubcommands([
    addCommand,
    updateMetadataCommand,
    reprocessTranscriptCommand,
    rebuildCommand,
    validateMetadataCommand,
    validateTranscriptsCommand,
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
    return S3.layer({
      endpoint: config.s3Endpoint,
      credentials: {
        accessKeyId: Redacted.value(config.s3AccessKey),
        secretAccessKey: Redacted.value(config.s3SecretKey),
      },
      forcePathStyle: true,
      region: 'us-east-1',
    });
  }).pipe(
    Effect.catchAll(() =>
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

const BaseLayers = Layer.mergeAll(BunContext.layer, s3Layer);

const ServiceLayers = Layer.mergeAll(
  YtDlpService.Default,
  FfmpegService.Default,
  TranscriptionService.Default,
  FileService.Default,
  BucketStorageService.Default,
).pipe(Layer.provide(BaseLayers));

const AppLayer = Layer.mergeAll(BaseLayers, ServiceLayers);

const cli = Cli.Command.run(rootCommand, {
  name: 'YouTube Transcript CLI',
  version: 'v1.0.0',
});

cli(process.argv).pipe(Effect.scoped, Effect.provide(AppLayer), BunRuntime.runMain);
