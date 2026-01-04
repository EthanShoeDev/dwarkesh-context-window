import { Schema } from 'effect';

/**
 * Schema for podcast metadata stored in the public repo.
 * One file per video in src/content/podcasts-metadata/<videoId>.json
 *
 * This serves as the "registry" of processed podcasts and contains
 * all metadata that can be publicly shared (no transcript content).
 */
// export const PodcastMetadataSchema = Schema.Struct({
export class PodcastMetadataSchema extends Schema.Class<PodcastMetadataSchema>(
  'PodcastMetadataSchema',
)({
  schemaVersion: Schema.Literal('0.0.1'),

  // Identifiers
  youtubeVideoId: Schema.String,

  // Timestamps
  metadataCreatedAt: Schema.DateTimeUtc,
  metadataLastSyncedAt: Schema.DateTimeUtc,

  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  uploadedAt: Schema.NullOr(Schema.DateTimeUtc),
  duration: Schema.Duration,

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
}) {
  get youtubeUrl() {
    return `https://www.youtube.com/watch?v=${this.youtubeVideoId}`;
  }
}
