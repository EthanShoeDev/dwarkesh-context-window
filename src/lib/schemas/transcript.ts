import { Schema } from 'effect';

/**
 * Audio processing metadata captured during transcription
 */
export const AudioMetadataSchema = Schema.Struct({
  originalFileSizeBytes: Schema.BigInt,
  preprocessedFileSizeBytes: Schema.BigInt,
  duration: Schema.Duration,
  chunkCount: Schema.Number,
});

/**
 * Raw Groq transcription response for a single chunk
 */
export const GroqTranscriptionResponseSchema = Schema.Struct({
  task: Schema.String,
  language: Schema.String,
  duration: Schema.Number,
  text: Schema.String,
  segments: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      seek: Schema.Number,
      start: Schema.Number,
      end: Schema.Number,
      text: Schema.String,
      tokens: Schema.Array(Schema.Number),
      temperature: Schema.Number,
      avg_logprob: Schema.Number,
      compression_ratio: Schema.Number,
      no_speech_prob: Schema.Number,
    }),
  ),
}).annotations({
  parseOptions: {
    onExcessProperty: 'preserve',
  },
});

/**
 * Full transcript dump stored in the private submodule.
 * One file per video in src/content/transcripts/<videoId>.json
 *
 * Contains the raw transcript content that may have copyright concerns.
 */
export const TranscriptSchema = Schema.Struct({
  schemaVersion: Schema.Literal('0.0.1'),

  youtubeVideoId: Schema.String,
  estimatedCostCents: Schema.Number,
  createdAt: Schema.DateTimeUtc,

  audioMetadata: AudioMetadataSchema,
  groqResponses: Schema.Array(GroqTranscriptionResponseSchema),
});
