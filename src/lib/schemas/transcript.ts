import { Schema } from 'effect';

/**
 * Audio processing metadata captured during transcription
 */
export const AudioMetadataSchema = Schema.Struct({
  // Original downloaded file size
  originalFileSizeBytes: Schema.Number,
  // Size after preprocessing (16kHz mono MP3)
  preprocessedFileSizeBytes: Schema.Number,
  // Duration from ffprobe
  durationSeconds: Schema.Number,
  // Human-readable duration (e.g., "1h 49m 53s")
  formattedDuration: Schema.String,
});

export type AudioMetadata = typeof AudioMetadataSchema.Type;

/**
 * Whisper segment from Groq API response.
 * Preserves word-level timing and confidence data.
 */
export const WhisperSegmentSchema = Schema.Struct({
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
});

export type WhisperSegment = typeof WhisperSegmentSchema.Type;

/**
 * Raw Groq transcription response for a single chunk
 */
export const GroqTranscriptionResponseSchema = Schema.Struct({
  task: Schema.String,
  language: Schema.String,
  duration: Schema.Number,
  text: Schema.String,
  segments: Schema.Array(WhisperSegmentSchema),
});

export type GroqTranscriptionResponse = typeof GroqTranscriptionResponseSchema.Type;

/**
 * Full transcript dump stored in the private submodule.
 * One file per video in src/content/transcripts/<videoId>.json
 *
 * Contains the raw transcript content that may have copyright concerns.
 */
export const TranscriptSchema = Schema.Struct({
  schemaVersion: Schema.Literal('1.0.0'),

  // Reference to video (matches metadata file)
  videoId: Schema.String,

  // Timestamp when transcript was created
  createdAt: Schema.String, // ISO timestamp

  // Audio processing metadata
  audioMetadata: AudioMetadataSchema,

  // The merged transcript text (all chunks combined)
  transcript: Schema.String,

  // Raw Groq API responses (preserves segments, tokens, timing, etc.)
  // Using Unknown to be flexible with API changes, but typed version available above
  rawResponses: Schema.Array(Schema.Unknown),
});

export type Transcript = typeof TranscriptSchema.Type;

/**
 * Encode a Transcript object to JSON-compatible format
 */
export const encodeTranscript = Schema.encodeSync(TranscriptSchema);

/**
 * Decode and validate a Transcript object from unknown input
 */
export const decodeTranscript = Schema.decodeUnknownSync(TranscriptSchema);
