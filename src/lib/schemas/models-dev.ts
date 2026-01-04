import { Schema } from 'effect';

/**
 * Effect Schema for models.dev `api.json`.
 *
 * Source: https://models.dev/api.json
 *
 * The README documents a TOML schema; the API is a JSON projection of that schema:
 * - Top-level is a map of providerId -> provider
 * - provider.models is a map of modelId -> model spec
 *
 * We keep a few fields optional to be resilient to upstream changes.
 */

export const ModelsDevInterleavedSchema = Schema.Union(
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literal('reasoning_content', 'reasoning_details'),
  }),
);

export const ModelsDevCostSchema = Schema.Struct({
  input: Schema.Number, // USD per 1M tokens
  output: Schema.Number, // USD per 1M tokens
  reasoning: Schema.optional(Schema.Number),
  cache_read: Schema.optional(Schema.Number),
  cache_write: Schema.optional(Schema.Number),
  input_audio: Schema.optional(Schema.Number),
  output_audio: Schema.optional(Schema.Number),
});

export const ModelsDevLimitSchema = Schema.Struct({
  context: Schema.Number,
  input: Schema.optional(Schema.Number),
  output: Schema.Number,
});

export const ModelsDevModalitiesSchema = Schema.Struct({
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
});

export const ModelsDevModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  tool_call: Schema.Boolean,
  structured_output: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  knowledge: Schema.optional(Schema.String),
  release_date: Schema.String,
  last_updated: Schema.String,
  open_weights: Schema.Boolean,
  interleaved: Schema.optional(ModelsDevInterleavedSchema),
  status: Schema.optional(Schema.Literal('alpha', 'beta', 'deprecated')),
  // Not all providers publish pricing for all models.
  cost: Schema.optional(ModelsDevCostSchema),
  limit: ModelsDevLimitSchema,
  modalities: ModelsDevModalitiesSchema,
});

export const ModelsDevProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  npm: Schema.String,
  env: Schema.optional(Schema.Array(Schema.String)),
  doc: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  models: Schema.Record({ key: Schema.String, value: ModelsDevModelSchema }),
});

export const ModelsDevApiSchema = Schema.Record({
  key: Schema.String,
  value: ModelsDevProviderSchema,
});

export type ModelsDevApi = typeof ModelsDevApiSchema.Type;
export type ModelsDevProvider = typeof ModelsDevProviderSchema.Type;
export type ModelsDevModel = typeof ModelsDevModelSchema.Type;

/**
 * Subset we embed into our markdown frontmatter for static-site rendering.
 * Must be YAML-friendly: plain objects/arrays/numbers/strings/booleans only.
 */
export const ModelsDevModelFrontmatterSchema = Schema.Struct({
  id: Schema.String, // provider-qualified if available
  name: Schema.String,
  providerId: Schema.String,
  providerName: Schema.String,

  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  tool_call: Schema.Boolean,

  // Pricing (USD per 1M tokens)
  cost: Schema.optional(ModelsDevCostSchema),
  // Limits (tokens)
  limit: ModelsDevLimitSchema,
  // Modalities
  modalities: ModelsDevModalitiesSchema,

  release_date: Schema.String,
  last_updated: Schema.String,
  open_weights: Schema.Boolean,
});

export type ModelsDevModelFrontmatter = typeof ModelsDevModelFrontmatterSchema.Type;
