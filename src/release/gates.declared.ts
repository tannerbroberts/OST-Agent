/**
 * What the gates cover — and nothing else in this file.
 *
 * These declarations used to live in the middle of {@link ./ship.ts}, beside the
 * runner, the refusal text and the summary line. That made "the scope of a gate"
 * and "the machinery that runs a gate" the same file, and a rule of the form
 * *a coverage change lands as its own commit* unenforceable: every ordinary edit
 * to the shipping sequence touched the gate definition too, so a narrowing rode
 * in beside a refactor with nothing able to tell them apart.
 *
 * So the declarations are here, alone. A commit that changes what a gate covers
 * touches this file and nothing else, which is what makes narrowings **countable
 * from git** (`git log -- src/release/gates.declared.ts`) rather than
 * reconstructed by reading diffs. {@link ./gate-coverage.ts} enforces that and
 * explains the rest of the rule.
 *
 * The corollary is the cost, and it is real rather than theoretical: an edit to
 * this file that has nothing to do with coverage — renaming a field, rewording a
 * `why` — also has to be its own commit. That is the price of the property, and
 * the tree records the argument ("Only a human may change what a gate covers,
 * and the change is a separate commit": *it blocks it and blocks some legitimate
 * work with it*).
 */

/** A command whose exit code decides whether the branch may merge. */
export interface Gate {
  /** Short name, used in the report line. */
  readonly name: string;
  /** The command as argv. Never a shell string — see the note in `ship.ts`. */
  readonly argv: readonly string[];
  /** Why this gate exists, for the refusal message when it goes red. */
  readonly why: string;
}

/**
 * The always-run gates, in the order a human would want them to fail.
 *
 * `tsc` first because a type error makes every test failure downstream of it
 * noise, and a builder reading one line of report should see the cause rather
 * than its consequences.
 */
export const CORE_GATES: readonly Gate[] = [
  {
    name: "tsc",
    argv: ["npx", "tsc", "--noEmit"],
    why: "the tree must type-check before anything else is worth reading",
  },
  {
    name: "vitest",
    argv: ["npx", "vitest", "run"],
    why: "the suite is the definition of done for everything already shipped",
  },
];

/**
 * The conditional gates, which exist because their subject is a COMMITTED
 * ARTIFACT that can drift from the source it is generated out of.
 *
 * Neither is covered by the suite in the way it needs to be: `dist/ost-agent.mjs`
 * is what the plugin actually launches, so if it may drift, what users run is
 * whatever was last remembered to be rebuilt.
 */
export const CONDITIONAL_GATES: readonly (Gate & { readonly when: (changed: readonly string[]) => boolean })[] = [
  {
    name: "bundle-drift",
    argv: ["npm", "run", "bundle"],
    why: "the plugin launches the committed bundle, so a stale one ships code nobody reviewed",
    when: (changed) => changed.some((p) => p.startsWith("src/")),
  },
  {
    name: "skill-drift",
    argv: ["npm", "run", "gen:skill"],
    why: "SKILL.md is generated from the ruleset and is what an agent actually reads",
    when: (changed) => changed.includes("src/knowledge/ruleset.ts"),
  },
];

/** The artifact each conditional gate regenerates, checked for drift afterwards. */
export const GENERATED_ARTIFACT: Readonly<Record<string, string>> = {
  "bundle-drift": "dist/ost-agent.mjs",
  "skill-drift": "SKILL.md",
};

/**
 * Test files `npx vitest run` does not run, and the reason each is out.
 *
 * This is the suite gate's coverage stated as data, and it lives here rather
 * than in `vitest.config.ts` for one reason: an exclusion is the cheapest
 * narrowing there is — one line, in a config file every refactor touches — and
 * the tree's whole argument is that such a line should be visible as its own
 * commit. `vitest.config.ts` imports this list; adding an entry there instead
 * fails `test/security/gate-coverage-human-only.test.ts`.
 *
 * `test/eval/calibration-ratio-stability.test.ts` forks dozens of CPU spinners
 * on purpose — its subject is what a perf gate reads on a busy box — so inside
 * the ordinary suite it would be both victim and culprit. It is reachable by
 * naming it on the command line, which is the form its instrument takes.
 */
export const SUITE_EXCLUSIONS: readonly string[] = ["test/eval/calibration-ratio-stability.test.ts"];
