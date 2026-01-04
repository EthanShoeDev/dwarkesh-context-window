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
 *     --models "claude-sonnet-4-20250514,gpt-4o,zhipu/glm-4-plus"
 *   generate --all       - Generate LLM content for all videos (skip if exists)
 *     --models "claude-sonnet-4-20250514,gpt-4o,zhipu/glm-4-plus"
 *   list                 - List tracked videos and whether LLM content exists
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { FileSystem, Path, FetchHttpClient } from '@effect/platform';
import * as Cli from '@effect/cli';
import { Config, Data, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { LanguageModel, Prompt, Response } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import matter from 'gray-matter';

import { getLatestSystemPrompt } from '@/llm-prompts';
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

function extractCostCentsFromResponse(response: LanguageModel.GenerateTextResponse<{}>): number {
  // Effect AI responses always contain a finish part for non-streaming calls.
  // Cost is provider-specific; we try a few common locations and fall back to 0.
  const finish = response.content.find((p): p is Response.FinishPart => p.type === 'finish');
  if (!finish) return 0;

  const metadata = finish.metadata;
  if (!metadata || typeof metadata !== 'object') return 0;

  // Try direct costCents property
  if ('costCents' in metadata) {
    const directCents = metadata.costCents;
    if (typeof directCents === 'number' && Number.isFinite(directCents))
      return Math.round(directCents);
  }

  // Try provider-specific costCents (openai.costCents, anthropic.costCents, groq.costCents)
  const checkProviderCents = (provider: string) => {
    if (provider in metadata) {
      const providerObj = metadata[provider];
      if (
        providerObj &&
        typeof providerObj === 'object' &&
        'costCents' in providerObj &&
        typeof providerObj.costCents === 'number' &&
        Number.isFinite(providerObj.costCents)
      ) {
        return Math.round(providerObj.costCents);
      }
    }
    return null;
  };

  const openaiCents = checkProviderCents('openai');
  if (openaiCents !== null) return openaiCents;

  const anthropicCents = checkProviderCents('anthropic');
  if (anthropicCents !== null) return anthropicCents;

  const groqCents = checkProviderCents('groq');
  if (groqCents !== null) return groqCents;

  // Try costUsd and convert to cents
  const checkCostUsd = (obj: unknown): number | null => {
    if (obj && typeof obj === 'object' && 'costUsd' in obj) {
      const cost = obj.costUsd;
      if (typeof cost === 'number' && Number.isFinite(cost)) {
        return Math.round(cost * 100);
      }
    }
    return null;
  };

  const directUsd = checkCostUsd(metadata);
  if (directUsd !== null) return directUsd;

  if ('openai' in metadata) {
    const openaiUsd = checkCostUsd(metadata.openai);
    if (openaiUsd !== null) return openaiUsd;
  }

  if ('anthropic' in metadata) {
    const anthropicUsd = checkCostUsd(metadata.anthropic);
    if (anthropicUsd !== null) return anthropicUsd;
  }

  return 0;
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
  provider: 'anthropic' | 'openai' | 'openrouter';
  model: string;
} {
  if (model.startsWith('anthropic/')) {
    return { provider: 'anthropic', model: model.slice('anthropic/'.length) };
  }
  if (model.startsWith('claude-')) {
    return { provider: 'anthropic', model };
  }
  // Treat provider-qualified IDs (e.g. "zhipu/glm-4-plus", "openai/gpt-4o") as OpenRouter models.
  if (model.includes('/')) {
    return { provider: 'openrouter', model };
  }
  // Default: OpenAI-compatible model id (e.g. gpt-4o, o1-mini, etc.)
  return { provider: 'openai', model };
}

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
        const md = yield* Effect.sync(() =>
          matter.stringify(content.markdownContent.trim() + '\n', {
            schemaVersion: content.schemaVersion,
            youtubeVideoId: content.youtubeVideoId,
            llmModel: content.llmModel,
            createdAt: content.createdAt,
            responseTimeMs: content.responseTimeMs,
            inputTokens: content.usage.inputTokens,
            outputTokens: content.usage.outputTokens,
            reasoningTokens: content.usage.reasoningTokens,
            totalTokens: content.usage.totalTokens,
            estimatedCostCents: content.estimatedCostCents,
            systemPromptRevision: content.systemPromptRevision,
            transcriptWordCount: content.transcriptWordCount,
          }),
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

        const estimatedCostCents = extractCostCentsFromResponse(response);

        return {
          llmModel: options.llmModel,
          responseTimeMs,
          usage: {
            inputTokens,
            outputTokens,
            reasoningTokens,
            totalTokens,
          },
          estimatedCostCents,
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

    const createdAt = yield* Effect.sync(() => new Date().toISOString());
    const modelSpec = classifyModel(options.model);

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
                OpenAiLanguageModel.model(modelSpec.model).pipe(
                  Layer.provide(
                    OpenAiClient.layer({
                      apiKey: Option.getOrUndefined(
                        modelSpec.provider === 'openrouter'
                          ? config.openrouterApiKey
                          : config.openaiApiKey,
                      ),
                      apiUrl:
                        modelSpec.provider === 'openrouter' ? config.openrouterBaseUrl : undefined,
                    }),
                  ),
                ),
              ),
            );

    const payload = {
      schemaVersion: '0.0.1' as const,
      youtubeVideoId: videoId,
      llmModel: generated.llmModel,
      createdAt,
      responseTimeMs: generated.responseTimeMs,
      systemPromptRevision,
      transcriptWordCount,
      usage: generated.usage,
      estimatedCostCents: generated.estimatedCostCents,
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

const modelsOption = Cli.Options.text('models').pipe(
  Cli.Options.withDescription('Comma-separated list of model ids to generate (default: LLM_MODEL)'),
  Cli.Options.optional,
);

const generateCommand = Cli.Command.make(
  'generate',
  { videoId: videoIdArg, all: allOption, models: modelsOption },
  ({ videoId, all, models }) =>
    Effect.gen(function* () {
      const config = yield* appConfig;
      const fileService = yield* FileService;
      const modelList = normalizeModelsArg(
        Option.isSome(models) ? models.value : undefined,
        config.llmModel,
      );

      if (all) {
        const ids = yield* fileService.listAllVideoIds();
        if (ids.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        for (const id of ids) {
          for (const model of modelList) {
            yield* generateForVideoId(id, { skipIfExists: true, model }).pipe(
              Effect.catchAll((err) => {
                const msg = err instanceof Error ? err.message : JSON.stringify(err);
                return Effect.log(`Failed for ${id} (${model}): ${msg}`);
              }),
            );
          }
        }
        return;
      }

      if (Option.isSome(videoId)) {
        for (const model of modelList) {
          yield* generateForVideoId(videoId.value, { skipIfExists: false, model }).pipe(
            Effect.catchAll((err) => {
              const msg = err instanceof Error ? err.message : JSON.stringify(err);
              return Effect.log(`Failed for ${videoId.value} (${model}): ${msg}`);
            }),
          );
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
const serviceLayers = Layer.mergeAll(FileService.Default, LlmGuestService.Default).pipe(
  Layer.provide(baseLayers),
);
const AppLayer = Layer.mergeAll(baseLayers, serviceLayers);

const cli = Cli.Command.run(rootCommand, {
  name: 'LLM Guest CLI',
  version: 'v1.0.0',
});

cli(process.argv).pipe(Effect.scoped, Effect.provide(AppLayer), BunRuntime.runMain);
