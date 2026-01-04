import { FileSystem, Path, FetchHttpClient, HttpClient } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';

import { ModelsDevApiSchema } from '@/lib/schemas/models-dev';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

class ModelsDevCacheJsonParseError extends Data.TaggedError('ModelsDevCacheJsonParseError')<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ModelsDevCacheService extends Effect.Service<ModelsDevCacheService>()(
  'app/ModelsDevCacheService',
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const http = yield* HttpClient.HttpClient;

      const loadApi = (options?: { cacheFile?: string }) =>
        Effect.gen(function* () {
          const cacheFile = options?.cacheFile ?? 'node_modules/.cache/models.dev/api.json';
          const abs = path.isAbsolute(cacheFile) ? cacheFile : path.join(process.cwd(), cacheFile);
          const dir = path.dirname(abs);

          const exists = yield* fs.exists(abs);
          if (!exists) {
            yield* fs.makeDirectory(dir, { recursive: true });

            const res = yield* http.get(MODELS_DEV_API_URL);
            const text = yield* res.text;
            yield* fs.writeFileString(abs, text);
          }

          const rawText = yield* fs.readFileString(abs);
          const json = yield* Effect.try({
            try: () => JSON.parse(rawText),
            catch: (cause) =>
              new ModelsDevCacheJsonParseError({
                path: abs,
                message: 'Failed to parse models.dev cache JSON',
                cause,
              }),
          });

          return yield* Schema.decodeUnknown(ModelsDevApiSchema)(json);
        });

      return { loadApi } as const;
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    dependencies: [],
  },
) {}
