#!/usr/bin/env bun
/**
 * Preview Script
 *
 * Builds the TanStack Start app and runs the production server.
 *
 * Run with:
 *   ./scripts/preview.ts [options]
 *
 * Options:
 *   --skip-build    Skip the build step and run existing build
 *   --port <port>   Port to run the server on (default: 3000)
 */
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Command, FileSystem, Path } from '@effect/platform';
import * as Cli from '@effect/cli';
import { Config, Data, Effect, Layer } from 'effect';
import { CommandUtils } from '@/lib/effect-utils';

// ============================================================================
// Errors
// ============================================================================

class BuildError extends Data.TaggedError('BuildError')<{
  readonly message: string;
  readonly exitCode: number;
  readonly stderr: string;
}> {}

class ServerError extends Data.TaggedError('ServerError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ============================================================================
// Configuration
// ============================================================================

const appConfig = Config.all({
  outputDir: Config.string('OUTPUT_DIR').pipe(Config.withDefault('.output')),
  serverEntrypoint: Config.string('SERVER_ENTRYPOINT').pipe(
    Config.withDefault('.output/server/index.mjs'),
  ),
});

// ============================================================================
// Services
// ============================================================================

class PreviewService extends Effect.Service<PreviewService>()('app/PreviewService', {
  effect: Effect.gen(function* () {
    const config = yield* appConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const build = () =>
      Effect.gen(function* () {
        yield* Effect.log('Building application...');

        const result = yield* CommandUtils.withLog(
          Command.make('turbo', 'build'),
          CommandUtils.runCommandBuffered({
            stdoutTap: (value) => Effect.log(value.trim()).pipe(Effect.when(() => !!value.trim())),
            stderrTap: (value) => Effect.log(value.trim()).pipe(Effect.when(() => !!value.trim())),
          }),
        );

        if (result.exitCode !== 0) {
          return yield* Effect.fail(
            new BuildError({
              message: 'Build failed',
              exitCode: result.exitCode,
              stderr: result.stderr,
            }),
          );
        }

        yield* Effect.log('Build completed successfully');
      });

    const checkBuildExists = () =>
      Effect.gen(function* () {
        const serverPath = path.resolve(config.serverEntrypoint);
        const exists = yield* fs.exists(serverPath);

        if (!exists) {
          return yield* Effect.fail(
            new ServerError({
              message: `Server entrypoint not found: ${serverPath}. Run build first.`,
            }),
          );
        }

        yield* Effect.log(`Found server entrypoint: ${serverPath}`);
      });

    const runServer = (port: number) =>
      Effect.gen(function* () {
        yield* Effect.log(`Starting server on port ${port}...`);

        const serverPath = path.resolve(config.serverEntrypoint);

        // Set PORT environment variable for the server
        const result = yield* CommandUtils.withLog(
          Command.make('node', serverPath).pipe(Command.env({ PORT: String(port) })),
          CommandUtils.runCommandBuffered({
            stdoutTap: (value) => Effect.log(value.trim()).pipe(Effect.when(() => !!value.trim())),
            stderrTap: (value) => Effect.log(value.trim()).pipe(Effect.when(() => !!value.trim())),
          }),
        );

        if (result.exitCode !== 0) {
          return yield* Effect.fail(
            new ServerError({
              message: `Server exited with code ${result.exitCode}`,
              cause: result.stderr,
            }),
          );
        }
      });

    return {
      build,
      checkBuildExists,
      runServer,
    } as const;
  }),
  dependencies: [],
}) {}

// ============================================================================
// Main Pipeline
// ============================================================================

function preview(options: { skipBuild: boolean; port: number }) {
  return Effect.gen(function* () {
    const previewService = yield* PreviewService;

    if (options.skipBuild) {
      yield* Effect.log('Skipping build (--skip-build flag set)');
      yield* previewService.checkBuildExists();
    } else {
      yield* previewService.build();
    }

    yield* previewService.runServer(options.port);
  }).pipe(Effect.withLogSpan('preview'));
}

// ============================================================================
// CLI
// ============================================================================

const skipBuildOption = Cli.Options.boolean('skip-build').pipe(
  Cli.Options.withDescription('Skip the build step and run existing build'),
  Cli.Options.withDefault(false),
);

const portOption = Cli.Options.integer('port').pipe(
  Cli.Options.withDescription('Port to run the server on'),
  Cli.Options.withDefault(3000),
);

const previewCommand = Cli.Command.make(
  'preview',
  { skipBuild: skipBuildOption, port: portOption },
  ({ skipBuild, port }) =>
    Effect.gen(function* () {
      yield* Effect.log('TanStack Start Preview');
      yield* preview({ skipBuild, port });
    }).pipe(Effect.orDie),
).pipe(Cli.Command.withDescription('Build and run the production server'));

// ============================================================================
// Layers / Main
// ============================================================================

const BaseLayers = BunContext.layer;
const ServiceLayers = PreviewService.Default.pipe(Layer.provide(BaseLayers));
const AppLayer = Layer.mergeAll(BaseLayers, ServiceLayers);

const cli = Cli.Command.run(previewCommand, {
  name: 'Preview Server',
  version: 'v1.0.0',
});

cli(process.argv).pipe(Effect.scoped, Effect.provide(AppLayer), BunRuntime.runMain);
