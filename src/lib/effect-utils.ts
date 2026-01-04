import { Effect, Option, pipe, Stream, String } from 'effect';
import { Command, Path } from '@effect/platform';

export const CommandUtils = {
  withLog: <A, E, R>(
    cmd: Command.Command,
    runner: (cmd: Command.Command) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const flattenedCmd = Command.flatten(cmd);
      const [firstCmd] = flattenedCmd;
      yield* Effect.logDebug(
        `Running: '${flattenedCmd
          .map((c) => `${c.command} ${c.args.join(' ')}`)
          .join(' | ')}' in ${Option.getOrElse(firstCmd.cwd, () => '.')}`,
      );
      return yield* runner(cmd);
    }),
  /**
   * P4 reads from the PWD env var and
   * Command.workingDirectory does not set the PWD env var.
   */
  withCwd: (cwd: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const absoluteCwd = path.resolve(path.join(process.cwd(), cwd));
      return (cmd: Command.Command) =>
        cmd.pipe(Command.workingDirectory(absoluteCwd), Command.env({ PWD: absoluteCwd }));
    }),
  bufferStringStream: <E, R, TapE = never, TapR = never>(
    stream: Stream.Stream<Uint8Array, E, R>,
    tap?: (value: string) => Effect.Effect<void, TapE, TapR>,
  ): Effect.Effect<string, E | TapE, R | TapR> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.tap(tap ?? Effect.succeed),
      Stream.runFold(String.empty, String.concat),
    ),
  runCommandBuffered:
    <E, R, E2, R2>(options?: {
      stdoutTap?: (value: string) => Effect.Effect<void, E2, R2>;
      stderrTap?: (value: string) => Effect.Effect<void, E, R>;
    }) =>
    (command: Command.Command) =>
      pipe(
        Command.start(command),
        Effect.flatMap((process) =>
          Effect.all(
            [
              process.exitCode,
              CommandUtils.bufferStringStream(process.stdout, options?.stdoutTap),
              CommandUtils.bufferStringStream(process.stderr, options?.stderrTap),
            ],
            { concurrency: 3 },
          ),
        ),
        Effect.map(([exitCode, stdout, stderr]) => ({
          exitCode,
          stdout,
          stderr,
        })),
      ),
  runCommandBufferedWithLog: (command: Command.Command) =>
    CommandUtils.withLog(
      command,
      CommandUtils.runCommandBuffered({
        stdoutTap: (value) => Effect.logDebug(`stdout: ${value}`),
        stderrTap: (value) => Effect.logDebug(`stderr: ${value}`),
      }),
    ),
};
