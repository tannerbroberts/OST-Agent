import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Tests that deliberately load the machine, and so cannot share it.
 *
 * `test/eval/calibration-ratio-stability.test.ts` forks dozens of CPU spinners
 * on purpose — its subject is what a perf gate reads on a busy box. Run inside
 * the ordinary suite it would be both victim and culprit: its own "idle" level
 * is not idle beside 270 other files, and its spinners would knock over every
 * other timing assertion in the run (ten spinners did exactly that to
 * `test/telemetry/work-units-vs-elapsed.test.ts` once — see the header of
 * `test/telemetry/same-run-baseline-ratio.test.ts`). The tree says where such a
 * check belongs: "Run the timed check under isolation, or do not let it fail
 * the build at all". So these files run only when named on the command line —
 * `npx vitest run test/eval/calibration-ratio-stability.test.ts` — which is
 * the form their instrument takes, and never as a side effect of `npx vitest run`.
 *
 * Why it is decided here rather than with `describe.skipIf` in the file: a
 * skipped file reports green, and a green that never measured anything is the
 * failure mode "A sweep that cannot read its subject reports a clean result"
 * names. A file that is not in the run reports nothing, which is the truth.
 *
 * Why `process.argv` rather than vitest's own filters: vitest applies `exclude`
 * before CLI filters, so an excluded file cannot be reached by naming it. The
 * config is evaluated once, in the process that parsed the command line.
 */
const CONTENDED = ["test/eval/calibration-ratio-stability.test.ts"];

function namedOnCommandLine(file: string): boolean {
  const stem = path.basename(file, ".test.ts");
  return process.argv.slice(2).some((arg) => !arg.startsWith("-") && arg.includes(stem));
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...CONTENDED.filter((f) => !namedOnCommandLine(f))],
    // git-subprocess + init tests are legitimately slow under parallel load
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
