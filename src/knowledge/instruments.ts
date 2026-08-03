/**
 * Instruments — the shapes a test's runnable half is allowed to take.
 *
 * An assumption test states a threshold in prose. That is enough for a person
 * who is going to go and run it, and it is not enough for anything else: prose
 * cannot be executed, cannot go red, and cannot tell a builder when it is done.
 * Every one of the 243 tests in this product's own vault was of that kind, and
 * the build half of the loop consequently had nothing it could act on — not
 * because the tests were bad, but because none of them named an instrument.
 *
 * An instrument is the executable half: one command, run by the repository's own
 * runner, whose exit code answers the test's question. It makes a test valid in
 * both senses at once — falsifiable for discovery (reality gets to answer), and
 * well-defined for the builder (red now, green when built, and theirs to fix
 * when it breaks).
 *
 * **The allowlist is the anti-fabrication argument, and it is why this is a
 * closed vocabulary rather than a string.** The agent authors the instrument, so
 * an agent that could write any shell string could write one that exits 0 and
 * hand itself a passing test — the tree's credibility spent on `true`. A form
 * here has to be a *spec file in the repository's own suite*: `true` is not
 * expressible, nor is `echo`, nor is anything whose result is not produced by
 * code that had to get through the same gates as the rest of the repo.
 *
 * Two further properties do the rest of the work, and neither lives here:
 * {@link ../ost/instrument.ts} never runs a form through a shell (argv only, so
 * there is no interpreter for a metacharacter to reach), and an instrument that
 * is green before anything was built is refused rather than recorded, because a
 * test that passes against the current repo proves nothing about a solution that
 * does not exist yet.
 *
 * Adding a form is a real decision: it widens what an unattended pass can put
 * its name to. The bar is that the form's verdict is produced by committed code,
 * reviewed under the repo's own gates, and reproducible by anyone who runs it.
 */

export interface InstrumentForm {
  id: string;
  label: string;
  /** What this form measures, and why its verdict can be trusted. */
  definition: string;
  /**
   * The whole command, anchored. A named `target` group is the file the form
   * points at, which the reader checks separately for traversal.
   */
  pattern: RegExp;
  /** The argv this form runs as — never a shell string. */
  argv: (target: string) => string[];
}

export const INSTRUMENT_FORMS = [
  {
    id: "vitest-spec",
    label: "Vitest spec",
    definition:
      "One spec file in the repository's own suite, run by the repository's own runner. Its verdict comes from committed code that passed the same review as everything else in the repo, so an agent cannot author the outcome — only name the file.",
    pattern: /^npx vitest run (?<target>[A-Za-z0-9][A-Za-z0-9._/-]*\.test\.ts)$/,
    argv: (target: string) => ["vitest", "run", target],
  },
] as const satisfies readonly InstrumentForm[];

export type InstrumentFormId = (typeof INSTRUMENT_FORMS)[number]["id"];

/**
 * Characters that mean a string was written to be interpreted rather than run.
 *
 * Nothing downstream uses a shell, so a hit here is not an exploit — it is a
 * sign the author expected one, and a command whose author expected a shell is a
 * command whose meaning nobody can predict from reading it. Refused on sight.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\\\n\r*?!#~'"]/;

export interface ParsedInstrument {
  form: InstrumentForm;
  /** The command exactly as the node declared it. */
  command: string;
  /** The spec file the command points at, repo-relative. */
  target: string;
  argv: string[];
}

export interface InstrumentRejection {
  /** Why this string is not an instrument, addressed to whoever wrote it. */
  reason: string;
}

/**
 * Read a declared instrument, or say why it is not one.
 *
 * Fails closed in every direction: an unrecognised form, a shell-shaped string,
 * a path that climbs out of the repository, and an absent declaration all answer
 * with a rejection rather than a command. Silence is never permission.
 */
export function parseInstrument(raw: string | undefined): ParsedInstrument | InstrumentRejection {
  const command = (raw ?? "").trim();
  if (!command) {
    return { reason: "no instrument declared" };
  }
  if (SHELL_METACHARACTERS.test(command)) {
    return {
      reason:
        `"${command}" contains shell punctuation. Instruments are run as argv with no shell, so ` +
        `a command written to be interpreted would not mean what it looks like. Name one spec file.`,
    };
  }
  for (const form of INSTRUMENT_FORMS) {
    const hit = form.pattern.exec(command);
    if (!hit) continue;
    const target = hit.groups?.target ?? "";
    if (target.startsWith("/") || target.split("/").includes("..")) {
      return {
        reason: `"${target}" leaves the repository. An instrument names a spec file inside the repo it is measuring.`,
      };
    }
    return { form, command, target, argv: form.argv(target) };
  }
  return {
    reason:
      `"${command}" is not an instrument form. The allowed forms are: ` +
      INSTRUMENT_FORMS.map((f) => `${f.id} (\`npx vitest run <path>.test.ts\`)`).join("; ") +
      `. The point of the restriction is that a verdict has to come from committed code rather than from a string an agent chose.`,
  };
}

/** True when `parseInstrument` returned a usable instrument. */
export function isInstrument(r: ParsedInstrument | InstrumentRejection): r is ParsedInstrument {
  return (r as ParsedInstrument).form !== undefined;
}
