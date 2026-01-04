import { Schema } from 'effect';

/**
 * Schema for the LLM-generated markdown files in `src/content/llm-generated/*.md`.
 *
 * These files are consumed by `content-collections` via YAML frontmatter.
 * The markdown body is stored in the `content` field (provided by the frontmatter parser).
 */
export const LlmGeneratedFrontmatterSchema = Schema.Struct({
  schemaVersion: Schema.Literal('0.0.1'),
  youtubeVideoId: Schema.String,
  llmModel: Schema.String,
  createdAt: Schema.String, // ISO string
  responseTimeMs: Schema.Number,

  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.Number,

  estimatedCostCents: Schema.Number,
  systemPromptRevision: Schema.optional(Schema.Number),
  systemPrompt: Schema.optional(Schema.String),

  // NOTE: This is the markdown body (no frontmatter)
  content: Schema.String,
});

export type LlmGeneratedFrontmatter = typeof LlmGeneratedFrontmatterSchema.Type;
