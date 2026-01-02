import { BunContext, BunRuntime } from "@effect/platform-bun";
import * as Cli from "@effect/cli";
import { Effect } from "effect";
import { getSubtitles } from "youtube-captions-scraper";

const videoUrl = "https://www.youtube.com/watch?v=_9V_Hbe-N1A";

function videoIdFromUrl(url: string): string {
  const urlObj = new URL(url);
  const videoId = urlObj.searchParams.get("v");
  if (!videoId) {
    throw new Error("No video ID found in URL");
  }
  return videoId;
}

const command = Cli.Command.make("get-transcript", {}, () =>
  Effect.gen(function* () {
    yield* Effect.log("Getting transcript...");
    const subtitles = yield* Effect.tryPromise({
      try: () =>
        getSubtitles({
          videoID: videoIdFromUrl(videoUrl),
          lang: "en",
        }),
      catch: (error) => new Error(`Failed to get subtitles: ${error}`),
    });
    yield* Effect.log(subtitles);
  }),
).pipe(Effect.orDie);

const cli = Cli.Command.run(command, {
  name: "Get Transcript CLI",
  version: "v0.0.1",
});
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
