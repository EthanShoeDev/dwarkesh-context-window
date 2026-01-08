#!/usr/bin/env bun
/**
 * LLM Guest CLI
 *
 * Generates a "third guest" markdown post for a podcast episode by feeding the
 * full transcript to an LLM using Effect AI.
 *
 * Run with:
 *   infisical run -- ./scripts/llm-guest.ts <command> [options]
 *
 * Commands:
 *   generate <videoId>   - Generate LLM content for a single videoId
 *     --models "claude-sonnet-4-20250514,openrouter/openai/gpt-4o,openrouter/zhipu/glm-4-plus"
 *   generate --all       - Generate LLM content for all videos (skip if exists)
 *     --models "claude-sonnet-4-20250514,openrouter/openai/gpt-4o,openrouter/zhipu/glm-4-plus"
 *   list                 - List tracked videos and whether LLM content exists
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { FileSystem, Path, FetchHttpClient } from '@effect/platform';
import * as Cli from '@effect/cli';
import { Config, Data, DateTime, Effect, Exit, Layer, Option, Schema } from 'effect';
import { LanguageModel, Prompt } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import matter from 'gray-matter';

import { getLatestSystemPrompt } from '@/llm-prompts';
import { ModelsDevCacheService } from '@/lib/models-dev-cache';
import { ModelsDevApi, ModelsDevModelFrontmatter } from '@/lib/schemas/models-dev';
import { PodcastMetadataSchema } from '@/lib/schemas/podcast-metadata';
import { TranscriptSchema } from '@/lib/schemas/transcript';

// ============================================================================
// Errors
// ============================================================================

class TranscriptNotFoundError extends Data.TaggedError('TranscriptNotFoundError')<{
  readonly videoId: string;
  readonly message: string;
}> {}

class LlmGenerationError extends Data.TaggedError('LlmGenerationError')<{
  readonly videoId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

class BatchGenerationError extends Data.TaggedError('BatchGenerationError')<{
  readonly videoId: string;
  readonly model: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Configuration
// ============================================================================

const appConfig = Config.all({
  anthropicApiKey: Config.redacted('ANTHROPIC_API_KEY'),
  llmModel: Config.string('LLM_MODEL').pipe(Config.withDefault('claude-sonnet-4-20250514')),
  openaiApiKey: Config.redacted('OPENAI_API_KEY').pipe(Config.option),
  openrouterApiKey: Config.redacted('OPENROUTER_API_KEY').pipe(Config.option),
  openrouterBaseUrl: Config.string('OPENROUTER_BASE_URL').pipe(
    Config.withDefault('https://openrouter.ai/api/v1'),
  ),
  groqApiKey: Config.redacted('GROQ_API_KEY').pipe(Config.option),
  googleApiKey: Config.redacted('GOOGLE_API_KEY').pipe(Config.option),
  modelsDevCacheFile: Config.string('MODELS_DEV_CACHE_FILE').pipe(
    Config.withDefault('node_modules/.cache/models.dev/api.json'),
  ),
  podcastsMetadataDir: Config.string('PODCASTS_METADATA_DIR').pipe(
    Config.withDefault('src/content/podcasts-metadata'),
  ),
  transcriptsDir: Config.string('TRANSCRIPTS_DIR').pipe(
    Config.withDefault('src/content/transcripts'),
  ),
  llmGeneratedDir: Config.string('LLM_GENERATED_DIR').pipe(
    Config.withDefault('src/content/llm-generated'),
  ),
});

function estimateCostCentsFromModelsDev(options: {
  model: ModelsDevModelFrontmatter | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}) {
  const m = options.model;
  if (!m) return 0;

  const inputPerM = m.cost?.input ?? 0;
  const outputPerM = m.cost?.output ?? 0;
  const reasoningPerM = m.cost?.reasoning ?? outputPerM;

  const usd =
    (options.inputTokens / 1_000_000) * inputPerM +
    (options.outputTokens / 1_000_000) * outputPerM +
    (options.reasoningTokens / 1_000_000) * reasoningPerM;

  return Math.round(usd * 100);
}

function getModelsDevModelFrontmatter(options: {
  api: ModelsDevApi;
  modelId: string;
  preferredProviderId?: string;
}): ModelsDevModelFrontmatter | null {
  // models.dev api.json is: providerId -> { id, name, models: { modelKey -> modelSpec } }
  const requested = options.modelId;

  // Fast path: provider-qualified IDs like "openrouter/gpt-4o" or "zai/glm-4.6"
  if (requested.includes('/')) {
    const [providerId, ...rest] = requested.split('/');
    const provider = options.api[providerId];
    if (provider) {
      const key = rest.join('/');
      const model = provider.models[key] ?? provider.models[requested];
      if (model) {
        return {
          id: requested,
          name: model.name,
          providerId,
          providerName: provider.name ?? providerId,
          attachment: !!model.attachment,
          reasoning: !!model.reasoning,
          tool_call: !!model.tool_call,
          cost: model.cost,
          limit: model.limit,
          modalities: model.modalities,
          release_date: model.release_date,
          last_updated: model.last_updated,
          open_weights: !!model.open_weights,
        };
      }
    }
  }

  // If the caller knows which provider it intends to use, prefer that provider's definition.
  if (options.preferredProviderId) {
    const provider = options.api[options.preferredProviderId];
    const m = provider?.models[requested];
    if (provider && m) {
      const fullId = `${options.preferredProviderId}/${requested}`;
      return {
        id: fullId,
        name: m.name,
        providerId: options.preferredProviderId,
        providerName: provider.name ?? options.preferredProviderId,
        attachment: !!m.attachment,
        reasoning: !!m.reasoning,
        tool_call: !!m.tool_call,
        cost: m.cost,
        limit: m.limit,
        modalities: m.modalities,
        release_date: m.release_date,
        last_updated: m.last_updated,
        open_weights: !!m.open_weights,
      };
    }
  }

  // Slow path: search for an unqualified ID like "gpt-4o" or "claude-sonnet-4-20250514"
  for (const [providerId, provider] of Object.entries(options.api)) {
    const m = provider.models[requested];
    if (!m) continue;

    const fullId = `${providerId}/${requested}`;
    return {
      id: fullId,
      name: m.name,
      providerId,
      providerName: provider.name ?? providerId,
      attachment: !!m.attachment,
      reasoning: !!m.reasoning,
      tool_call: !!m.tool_call,
      cost: m.cost,
      limit: m.limit,
      modalities: m.modalities,
      release_date: m.release_date,
      last_updated: m.last_updated,
      open_weights: !!m.open_weights,
    };
  }

  return null;
}

// ============================================================================
// Prompt
// ============================================================================

const { revision: systemPromptRevision, prompt: systemPrompt } = getLatestSystemPrompt();

function extractGuestFromTitle(title: string) {
  // Common Dwarkesh format: "<Guest> – <Episode title>"
  const enDashSplit = title.split('–').map((s) => s.trim());
  if (enDashSplit.length >= 2 && enDashSplit[0]) return enDashSplit[0];

  const hyphenSplit = title.split('-').map((s) => s.trim());
  if (hyphenSplit.length >= 2 && hyphenSplit[0]) return hyphenSplit[0];

  return null;
}

function buildUserPrompt(options: {
  title: string;
  description: string | null;
  transcriptText: string;
}) {
  const guest = extractGuestFromTitle(options.title);
  return `Here is the podcast episode:

**Title:** ${options.title}
**Guest:** ${guest ?? ''}
**Description:** ${options.description ?? ''}

---

## Full Transcript

${options.transcriptText}

---

Now, as a third guest joining this conversation, what would you add? What research directions would you propose? What did the guests miss or get wrong?
`;
}

function normalizeModelsArg(
  modelsRaw: string | undefined,
  defaultModel: string,
): ReadonlyArray<string> {
  const raw = (modelsRaw ?? defaultModel).trim();
  if (!raw) return [defaultModel];
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return Array.from(new Set(models));
}

function encodeModelForFilename(model: string) {
  // Ensure models like `zhipu/glm-4-plus` can be written safely as a single file.
  return encodeURIComponent(model);
}

function countWords(text: string) {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function classifyModel(model: string): {
  provider: 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'google';
  model: string;
} {
  if (model.startsWith('anthropic/')) {
    return { provider: 'anthropic', model: model.slice('anthropic/'.length) };
  }
  if (model.startsWith('openrouter/')) {
    return { provider: 'openrouter', model: model.slice('openrouter/'.length) };
  }
  if (model.startsWith('openai/')) {
    return { provider: 'openai', model: model.slice('openai/'.length) };
  }
  if (model.startsWith('groq/')) {
    return { provider: 'groq', model: model.slice('groq/'.length) };
  }
  if (model.startsWith('google/')) {
    return { provider: 'google', model: model.slice('google/'.length) };
  }
  if (model.startsWith('claude-')) {
    return { provider: 'anthropic', model };
  }
  // Default GPT-family usage should go through OpenRouter in this project.
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
    return { provider: 'openrouter', model };
  }
  // Treat provider-qualified IDs (e.g. "zhipu/glm-4-plus", "openai/gpt-4o") as OpenRouter models.
  if (model.includes('/')) {
    return { provider: 'openrouter', model };
  }
  // Default: OpenAI-compatible model id (e.g. gpt-4o, o1-mini, etc.)
  return { provider: 'openai', model };
}

function normalizeOpenRouterModelId(model: string) {
  // Allow user to pass `gpt-4o` and have it resolve to `openai/gpt-4o` on OpenRouter.
  if (
    !model.includes('/') &&
    (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3'))
  ) {
    return `openai/${model}`;
  }
  return model;
}

class BatchGenerationFailuresError extends Data.TaggedError('BatchGenerationFailuresError')<{
  readonly failures: ReadonlyArray<BatchGenerationError>;
}> {}

// ============================================================================
// Services
// ============================================================================

class FileService extends Effect.Service<FileService>()('app/FileService', {
  effect: Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readPodcastMetadata = (videoId: string) =>
      Effect.gen(function* () {
        const metadataPath = path.join(config.podcastsMetadataDir, `${videoId}.json`);
        const content = yield* fs.readFileString(metadataPath);
        const rawJson = yield* Effect.sync(() => JSON.parse(content));
        return yield* Schema.decodeUnknown(PodcastMetadataSchema)(rawJson);
      });

    const readTranscript = (videoId: string) =>
      Effect.gen(function* () {
        const transcriptPath = path.join(config.transcriptsDir, `${videoId}.json`);
        const exists = yield* fs.exists(transcriptPath);
        if (!exists) {
          return yield* Effect.fail(
            new TranscriptNotFoundError({
              videoId,
              message: `Transcript not found at: ${transcriptPath}`,
            }),
          );
        }

        const content = yield* fs.readFileString(transcriptPath);
        const rawJson = yield* Effect.sync(() => JSON.parse(content));
        return yield* Schema.decodeUnknown(TranscriptSchema)(rawJson);
      });

    const listAllVideoIds = () =>
      Effect.gen(function* () {
        const files = yield* fs.readDirectory(config.podcastsMetadataDir);
        return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
      });

    const llmOutputPath = (videoId: string, model: string) =>
      path.join(config.llmGeneratedDir, `${videoId}--${encodeModelForFilename(model)}.md`);

    const checkLlmContentExists = (videoId: string, model: string) =>
      Effect.gen(function* () {
        const outPath = llmOutputPath(videoId, model);
        return yield* fs.exists(outPath);
      });

    const writeLlmContent = (content: {
      schemaVersion: '0.0.1';
      youtubeVideoId: string;
      llmModel: string;
      createdAt: string;
      responseTimeMs: number;
      systemPromptRevision: number;
      transcriptWordCount?: number;
      model?: ModelsDevModelFrontmatter;
      usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        totalTokens: number;
      };
      estimatedCostCents: number;
      markdownContent: string;
    }) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(config.llmGeneratedDir, { recursive: true });
        const outPath = llmOutputPath(content.youtubeVideoId, content.llmModel);
        const frontmatter: Record<string, unknown> = {
          schemaVersion: content.schemaVersion,
          youtubeVideoId: content.youtubeVideoId,
          llmModel: content.llmModel,
          createdAt: content.createdAt,
          responseTimeMs: content.responseTimeMs,
          inputTokens: content.usage.inputTokens,
          outputTokens: content.usage.outputTokens,
          totalTokens: content.usage.totalTokens,
          estimatedCostCents: content.estimatedCostCents,
          systemPromptRevision: content.systemPromptRevision,
        };

        // IMPORTANT: gray-matter/js-yaml cannot serialize `undefined`.
        if (typeof content.usage.reasoningTokens === 'number') {
          frontmatter.reasoningTokens = content.usage.reasoningTokens;
        }
        if (typeof content.transcriptWordCount === 'number') {
          frontmatter.transcriptWordCount = content.transcriptWordCount;
        }
        if (content.model) {
          frontmatter.model = content.model;
        }

        const md = yield* Effect.sync(() =>
          matter.stringify(content.markdownContent.trim() + '\n', frontmatter),
        );
        yield* fs.writeFileString(outPath, md);
        yield* Effect.log(`LLM markdown saved to: ${outPath}`);
        return outPath;
      });

    return {
      readPodcastMetadata,
      readTranscript,
      listAllVideoIds,
      checkLlmContentExists,
      writeLlmContent,
    } as const;
  }),
  dependencies: [],
}) {}

class LlmGuestService extends Effect.Service<LlmGuestService>()('app/LlmGuestService', {
  sync: () => {
    const generateMarkdown = (options: {
      videoId: string;
      llmModel: string;
      title: string;
      description: string | null;
      transcriptText: string;
    }) =>
      Effect.gen(function* () {
        const prompt = Prompt.make([
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: buildUserPrompt({
              title: options.title,
              description: options.description,
              transcriptText: options.transcriptText,
            }),
          },
        ]);

        const start = yield* DateTime.now;

        const response = yield* LanguageModel.generateText({
          prompt,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new LlmGenerationError({
                videoId: options.videoId,
                message: 'Failed to generate LLM guest markdown',
                cause,
              }),
          ),
        );

        const end = yield* DateTime.now;
        const responseTimeMs = end.epochMillis - start.epochMillis;

        const inputTokens = response.usage.inputTokens ?? 0;
        const outputTokens = response.usage.outputTokens ?? 0;
        const totalTokens = response.usage.totalTokens ?? inputTokens + outputTokens;
        const reasoningTokens = response.usage.reasoningTokens;

        return {
          llmModel: options.llmModel,
          responseTimeMs,
          usage: {
            inputTokens,
            outputTokens,
            reasoningTokens,
            totalTokens,
          },
          markdownContent: response.text,
        } as const;
      });

    return { generateMarkdown } as const;
  },
  dependencies: [],
}) {}

// ============================================================================
// Main pipeline
// ============================================================================

function transcriptToText(transcript: typeof TranscriptSchema.Type) {
  return transcript.groqResponses
    .map((r) => r.text)
    .join('\n\n')
    .trim();
}

function generateForVideoId(videoId: string, options: { skipIfExists: boolean; model: string }) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fileService = yield* FileService;
    const llmGuest = yield* LlmGuestService;
    const modelsDev = yield* ModelsDevCacheService;

    const exists = yield* fileService.checkLlmContentExists(videoId, options.model);
    if (exists && options.skipIfExists) {
      yield* Effect.log(`Skipping ${videoId} (LLM output exists for model ${options.model})`);
      return { skipped: true, videoId, model: options.model } as const;
    }

    const metadata = yield* fileService.readPodcastMetadata(videoId);
    const transcript = yield* fileService.readTranscript(videoId);
    const transcriptText = transcriptToText(transcript);
    const transcriptWordCount = countWords(transcriptText);

    yield* Effect.log(`Generating LLM guest post for: ${metadata.title}`);
    const modelsDevApi = yield* modelsDev.loadApi({ cacheFile: config.modelsDevCacheFile });
    const modelSpec = classifyModel(options.model);
    const preferredProviderId =
      modelSpec.provider === 'anthropic'
        ? 'anthropic'
        : modelSpec.provider === 'openai'
          ? 'openai'
          : modelSpec.provider === 'openrouter'
            ? 'openrouter'
            : modelSpec.provider === 'groq'
              ? 'groq'
              : modelSpec.provider === 'google'
                ? 'google'
                : undefined;

    const model = getModelsDevModelFrontmatter({
      api: modelsDevApi,
      modelId: options.model,
      preferredProviderId,
    });
    if (!model) {
      yield* Effect.log(
        `models.dev: no metadata found for model "${options.model}" (continuing without pricing/capabilities)`,
      );
    } else {
      yield* Effect.log(
        `models.dev: ${model.name} (${model.providerName}) — context ${model.limit.context.toLocaleString()} tokens`,
      );
    }

    const createdAt = yield* Effect.sync(() => new Date().toISOString());
    const providerModelId =
      modelSpec.provider === 'openrouter'
        ? normalizeOpenRouterModelId(modelSpec.model)
        : modelSpec.model;

    const generated =
      modelSpec.provider === 'anthropic'
        ? yield* llmGuest
            .generateMarkdown({
              videoId,
              llmModel: options.model,
              title: metadata.title,
              description: metadata.description,
              transcriptText,
            })
            .pipe(
              Effect.provide(
                AnthropicLanguageModel.model(modelSpec.model).pipe(
                  Layer.provide(AnthropicClient.layer({ apiKey: config.anthropicApiKey })),
                ),
              ),
            )
        : modelSpec.provider === 'groq'
          ? yield* llmGuest
              .generateMarkdown({
                videoId,
                llmModel: options.model,
                title: metadata.title,
                description: metadata.description,
                transcriptText,
              })
              .pipe(
                Effect.provide(
                  OpenAiLanguageModel.model(modelSpec.model).pipe(
                    Layer.provide(
                      OpenAiClient.layer({
                        apiKey: Option.getOrUndefined(config.groqApiKey),
                        apiUrl: 'https://api.groq.com/openai/v1',
                      }),
                    ),
                  ),
                ),
              )
          : modelSpec.provider === 'google'
            ? yield* llmGuest
                .generateMarkdown({
                  videoId,
                  llmModel: options.model,
                  title: metadata.title,
                  description: metadata.description,
                  transcriptText,
                })
                .pipe(
                  Effect.provide(
                    GoogleLanguageModel.model(modelSpec.model).pipe(
                      Layer.provide(
                        GoogleClient.layer({ apiKey: Option.getOrUndefined(config.googleApiKey) }),
                      ),
                    ),
                  ),
                )
            : yield* llmGuest
                .generateMarkdown({
                  videoId,
                  llmModel: options.model,
                  title: metadata.title,
                  description: metadata.description,
                  transcriptText,
                })
                .pipe(
                  Effect.provide(
                    OpenAiLanguageModel.model(providerModelId).pipe(
                      Layer.provide(
                        OpenAiClient.layer({
                          apiKey: Option.getOrUndefined(
                            modelSpec.provider === 'openrouter'
                              ? config.openrouterApiKey
                              : config.openaiApiKey,
                          ),
                          apiUrl:
                            modelSpec.provider === 'openrouter'
                              ? config.openrouterBaseUrl
                              : undefined,
                        }),
                      ),
                    ),
                  ),
                );

    const payload = {
      schemaVersion: '0.0.1' as const,
      youtubeVideoId: videoId,
      llmModel: model?.id ?? generated.llmModel,
      createdAt,
      responseTimeMs: generated.responseTimeMs,
      systemPromptRevision,
      transcriptWordCount,
      usage: generated.usage,
      estimatedCostCents: estimateCostCentsFromModelsDev({
        model,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        reasoningTokens: generated.usage.reasoningTokens ?? 0,
      }),
      model: model ?? undefined,
      markdownContent: generated.markdownContent,
    };

    yield* fileService.writeLlmContent(payload);

    yield* Effect.log(
      `Done: ${videoId} (tokens: ${payload.usage.totalTokens}, est cost: ${payload.estimatedCostCents} cents)`,
    );

    return { skipped: false, videoId, model: options.model } as const;
  }).pipe(Effect.withLogSpan('generateForVideoId'));
}

// ============================================================================
// CLI
// ============================================================================

const videoIdArg = Cli.Args.text({ name: 'videoId' }).pipe(
  Cli.Args.withDescription('YouTube video ID to generate LLM content for'),
  Cli.Args.optional,
);

const allOption = Cli.Options.boolean('all').pipe(
  Cli.Options.withAlias('a'),
  Cli.Options.withDescription('Generate for all videos in podcasts-metadata'),
  Cli.Options.withDefault(false),
);

const concurrencyOption = Cli.Options.integer('concurrency').pipe(
  Cli.Options.withAlias('c'),
  Cli.Options.withDescription('How many generation jobs to run concurrently'),
  Cli.Options.withDefault(1),
);

const modelsOption = Cli.Options.text('models').pipe(
  Cli.Options.withDescription('Comma-separated list of model ids to generate (default: LLM_MODEL)'),
  Cli.Options.optional,
);

const generateCommand = Cli.Command.make(
  'generate',
  { videoId: videoIdArg, all: allOption, models: modelsOption, concurrency: concurrencyOption },
  ({ videoId, all, models, concurrency }) =>
    Effect.gen(function* () {
      const config = yield* appConfig;
      const fileService = yield* FileService;
      const modelList = normalizeModelsArg(
        Option.isSome(models) ? models.value : undefined,
        config.llmModel,
      );

      const runOne = (id: string, model: string, skipIfExists: boolean) =>
        Effect.exit(generateForVideoId(id, { skipIfExists, model })).pipe(
          Effect.map((exit) => ({ id, model, exit }) as const),
        );

      if (all) {
        const ids = yield* fileService.listAllVideoIds();
        if (ids.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        const jobs = ids.flatMap((id) => modelList.map((model) => runOne(id, model, true)));
        const results = yield* Effect.all(jobs, { concurrency });
        const failures = results.flatMap((r) => {
          if (Exit.isSuccess(r.exit)) return [];
          const msg = r.exit.cause ? String(r.exit.cause) : 'Unknown error';
          return [
            new BatchGenerationError({
              videoId: r.id,
              model: r.model,
              message: msg,
              cause: r.exit.cause,
            }),
          ];
        });
        if (failures.length) {
          for (const f of failures) {
            yield* Effect.log(`Failed for ${f.videoId} (${f.model}): ${f.message}`);
          }
          return yield* Effect.fail(new BatchGenerationFailuresError({ failures }));
        }
        return;
      }

      if (Option.isSome(videoId)) {
        const jobs = modelList.map((model) => runOne(videoId.value, model, false));
        const results = yield* Effect.all(jobs, { concurrency });
        const failures = results.flatMap((r) => {
          if (Exit.isSuccess(r.exit)) return [];
          const msg = r.exit.cause ? String(r.exit.cause) : 'Unknown error';
          return [
            new BatchGenerationError({
              videoId: r.id,
              model: r.model,
              message: msg,
              cause: r.exit.cause,
            }),
          ];
        });
        if (failures.length) {
          for (const f of failures) {
            yield* Effect.log(`Failed for ${f.videoId} (${f.model}): ${f.message}`);
          }
          return yield* Effect.fail(new BatchGenerationFailuresError({ failures }));
        }
      } else {
        yield* Effect.log('Please provide a videoId or use --all');
      }
    }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Generate a "third guest" markdown post using the transcript'));

const listCommand = Cli.Command.make('list', {}, () =>
  Effect.gen(function* () {
    const config = yield* appConfig;
    const fileService = yield* FileService;
    const ids = yield* fileService.listAllVideoIds();

    if (ids.length === 0) {
      yield* Effect.log('No videos found');
      return;
    }

    yield* Effect.log(`Found ${ids.length} video(s):\n`);
    for (const id of ids) {
      const meta = yield* fileService.readPodcastMetadata(id);
      const has = yield* fileService.checkLlmContentExists(id, config.llmModel);
      yield* Effect.log(`  ${has ? '✓' : '✗'} ${id} - ${meta.title}`);
    }
  }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('List tracked videos and whether LLM content exists'));

const rootCommand = Cli.Command.make('llm-guest', {}).pipe(
  Cli.Command.withSubcommands([generateCommand, listCommand]),
  Cli.Command.withDescription('Generate LLM "third guest" markdown posts'),
);

// ============================================================================
// Layers / Main
// ============================================================================

const baseLayers = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer);
const serviceLayers = Layer.mergeAll(
  FileService.Default,
  LlmGuestService.Default,
  ModelsDevCacheService.Default,
).pipe(Layer.provide(baseLayers));
const AppLayer = Layer.mergeAll(baseLayers, serviceLayers);

const cli = Cli.Command.run(rootCommand, {
  name: 'LLM Guest CLI',
  version: 'v1.0.0',
});

cli(process.argv).pipe(Effect.scoped, Effect.provide(AppLayer), BunRuntime.runMain);
