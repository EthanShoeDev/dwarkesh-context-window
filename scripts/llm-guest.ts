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
 *   generate --all       - Generate LLM content for all videos (skip if exists)
 *   list                 - List tracked videos and whether LLM content exists
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { FileSystem, Path, FetchHttpClient } from '@effect/platform';
import * as Cli from '@effect/cli';
import { Config, Data, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { LanguageModel, Prompt } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
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
  const finish = response.content.find((p) => p.type === 'finish') as
    | { metadata?: unknown }
    | undefined;

  const metadata = finish && 'metadata' in finish ? (finish as any).metadata : undefined;
  if (!metadata || typeof metadata !== 'object') return 0;

  // Common patterns:
  // - metadata.costCents
  // - metadata.openai.costCents / metadata.anthropic.costCents
  // - metadata.costUsd (convert)
  const anyMeta = metadata as any;

  const directCents = anyMeta.costCents;
  if (typeof directCents === 'number' && Number.isFinite(directCents))
    return Math.round(directCents);

  const providerCents =
    anyMeta.openai?.costCents ?? anyMeta.anthropic?.costCents ?? anyMeta.groq?.costCents;
  if (typeof providerCents === 'number' && Number.isFinite(providerCents))
    return Math.round(providerCents);

  const costUsd = anyMeta.costUsd ?? anyMeta.openai?.costUsd ?? anyMeta.anthropic?.costUsd;
  if (typeof costUsd === 'number' && Number.isFinite(costUsd)) return Math.round(costUsd * 100);

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
      path.join(config.llmGeneratedDir, `${videoId}--${model}.md`);

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
  effect: Effect.gen(function* () {
    const config = yield* appConfig;

    const generateMarkdown = (options: {
      videoId: string;
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
          llmModel: config.llmModel,
          responseTimeMs,
          usage: {
            inputTokens,
            outputTokens,
            reasoningTokens,
            totalTokens,
          },
          estimatedCostCents,
          markdownContent: (response as any).text as string,
        } as const;
      });

    return { generateMarkdown } as const;
  }),
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

function generateForVideoId(videoId: string, options: { skipIfExists: boolean }) {
  return Effect.gen(function* () {
    const config = yield* appConfig;
    const fileService = yield* FileService;
    const llmGuest = yield* LlmGuestService;

    const exists = yield* fileService.checkLlmContentExists(videoId, config.llmModel);
    if (exists && options.skipIfExists) {
      yield* Effect.log(`Skipping ${videoId} (LLM output exists for model ${config.llmModel})`);
      return { skipped: true, videoId } as const;
    }

    const metadata = yield* fileService.readPodcastMetadata(videoId);
    const transcript = yield* fileService.readTranscript(videoId);
    const transcriptText = transcriptToText(transcript);

    yield* Effect.log(`Generating LLM guest post for: ${metadata.title}`);

    const createdAt = yield* Effect.sync(() => new Date().toISOString());
    const generated = yield* llmGuest.generateMarkdown({
      videoId,
      title: metadata.title,
      description: metadata.description,
      transcriptText,
    });

    const payload = {
      schemaVersion: '0.0.1' as const,
      youtubeVideoId: videoId,
      llmModel: generated.llmModel,
      createdAt,
      responseTimeMs: generated.responseTimeMs,
      systemPromptRevision,
      usage: generated.usage,
      estimatedCostCents: generated.estimatedCostCents,
      markdownContent: generated.markdownContent,
    };

    yield* fileService.writeLlmContent(payload);

    yield* Effect.log(
      `Done: ${videoId} (tokens: ${payload.usage.totalTokens}, est cost: ${payload.estimatedCostCents} cents)`,
    );

    return { skipped: false, videoId } as const;
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

const generateCommand = Cli.Command.make(
  'generate',
  { videoId: videoIdArg, all: allOption },
  ({ videoId, all }) =>
    Effect.gen(function* () {
      const fileService = yield* FileService;

      if (all) {
        const ids = yield* fileService.listAllVideoIds();
        if (ids.length === 0) {
          yield* Effect.log('No videos found in metadata directory');
          return;
        }

        for (const id of ids) {
          yield* generateForVideoId(id, { skipIfExists: true }).pipe(
            Effect.catchAll((err) => {
              const msg = err instanceof Error ? err.message : JSON.stringify(err);
              return Effect.log(`Failed for ${id}: ${msg}`);
            }),
          );
        }
        return;
      }

      if (Option.isSome(videoId)) {
        yield* generateForVideoId(videoId.value, { skipIfExists: false });
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

const providerLayers = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* appConfig;
    return Layer.mergeAll(AnthropicClient.layer({ apiKey: config.anthropicApiKey }));
  }),
).pipe(Layer.provide(baseLayers));

const serviceLayers = Layer.mergeAll(FileService.Default, LlmGuestService.Default).pipe(
  Layer.provide(Layer.mergeAll(baseLayers, providerLayers)),
);

const AppLayer = Layer.mergeAll(baseLayers, providerLayers, serviceLayers);

const cli = Cli.Command.run(rootCommand, {
  name: 'LLM Guest CLI',
  version: 'v1.0.0',
});

Effect.gen(function* () {
  const config = yield* appConfig;
  const model = AnthropicLanguageModel.model(config.llmModel);
  return yield* cli(process.argv).pipe(Effect.provide(model));
}).pipe(Effect.scoped, Effect.provide(AppLayer), BunRuntime.runMain);
