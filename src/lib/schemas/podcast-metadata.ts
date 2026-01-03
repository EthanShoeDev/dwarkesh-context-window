import { Schema } from 'effect';

/**
 * Schema for podcast metadata stored in the public repo.
 * One file per video in src/content/podcasts-metadata/<videoId>.json
 *
 * This serves as the "registry" of processed podcasts and contains
 * all metadata that can be publicly shared (no transcript content).
 */
export const PodcastMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Literal('1.0.0'),

  // Identifiers
  videoId: Schema.String,
  url: Schema.String,

  // Timestamps for tracking
  metadataCreatedAt: Schema.String, // ISO timestamp - when first added
  metadataLastSyncedAt: Schema.String, // ISO timestamp - when metadata was last updated from YouTube
  transcriptCreatedAt: Schema.NullOr(Schema.String), // ISO timestamp - when transcript was created (null if not yet)

  // Video info
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  uploadDate: Schema.NullOr(Schema.String), // YYYY-MM-DD format
  duration: Schema.Number, // seconds

  // Engagement stats (can be updated frequently via update-metadata command)
  viewCount: Schema.NullOr(Schema.Number),
  likeCount: Schema.NullOr(Schema.Number),
  commentCount: Schema.NullOr(Schema.Number),

  // Channel info
  channel: Schema.String,
  channelId: Schema.String,
  channelUrl: Schema.String,
  channelFollowerCount: Schema.NullOr(Schema.Number),

  // Additional metadata
  thumbnail: Schema.NullOr(Schema.String),
  categories: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  availability: Schema.NullOr(Schema.String),
});

export type PodcastMetadata = typeof PodcastMetadataSchema.Type;

/**
 * Encode a PodcastMetadata object to JSON-compatible format
 */
export const encodePodcastMetadata = Schema.encodeSync(PodcastMetadataSchema);

/**
 * Decode and validate a PodcastMetadata object from unknown input
 */
export const decodePodcastMetadata = Schema.decodeUnknownSync(PodcastMetadataSchema);
