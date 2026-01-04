import { Schema } from 'effect';

/**
 * Token usage statistics for the LLM request
 */
export const LlmUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.Number,
});

/**
 * Schema for LLM-generated content stored in src/content/llm-generated/<videoId>--<model>.json
 */
export class LlmGeneratedContentSchema extends Schema.Class<LlmGeneratedContentSchema>(
  'LlmGeneratedContentSchema',
)({
  schemaVersion: Schema.Literal('0.0.1'),

  youtubeVideoId: Schema.String,
  llmModel: Schema.String,
  createdAt: Schema.DateTimeUtc,
  responseTime: Schema.Duration,

  usage: LlmUsageSchema,
  estimatedCostCents: Schema.Number,

  markdownContent: Schema.String,
}) {}
