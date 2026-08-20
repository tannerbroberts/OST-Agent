/**
 * Which of the standing resource questions does the vault already answer?
 *
 * The candidate is a set of resource questions put to the operator on a
 * cadence, each answer expiring. The assumption underneath it — the one this
 * file exists to settle the mechanical half of — is that asking is worth its
 * price: that the questions are quick, and that they return facts nothing
 * cheaper could have produced. A question the vault can answer by reading a
 * file is a tax on the operator every period it is asked.
 *
 * The bar was pre-committed on the assumption test before anything was
 * measured: **the full set answered in under ten minutes AND at least two
 * answers being facts not already recoverable from the vault; otherwise the
 * cadence is killed in favour of a one-time manifest.** The timing half needs a
 * person and is not here. The recoverability half is what this file labels,
 * and the count it produces is the most a cadence could learn per sitting.
 *
 * The file is in four parts, and the order matters:
 *
 *   1. **Every question is labelled, always.** A vault with nothing in it gets
 *      five labels, not zero; the count of what is still to ask must never
 *      depend on what the vault happened to contain.
 *   2. **The readers, with their controls.** Each reader is held to an input
 *      built to carry nothing, so a reader that fired on everything would fail
 *      here rather than report every question as already answered.
 *   3. **This vault, as cut on 2026-08-20**, against the bar — and the same
 *      vault with the manifest a human filled for it, which answers every
 *      question and leaves the cadence resting on decay alone.
 *   4. **The rendered report** says which direction its count errs in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";
import { MANIFEST_FILENAME, RESOURCES, type ResourceId } from "../../src/product/manifest.js";
import {
  computeFromConfig,
  credentialsFromConfigAndEnv,
  credentialsNeeded,
  formatRecoverability,
  labelResourceQuestions,
} from "../../src/product/recoverability.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** The `ost-agent-meta` vault's config, verbatim, 2026-08-20 (see the fixture's PROVENANCE.md). */
const META_CONFIG = fs.readFileSync(path.join(FIXTURES, "resource-questions", "ost.config.yaml"), "utf8");
/** The manifest a human filled for that vault on 2026-08-04, from facts recorded in its prose. */
const HAND_FILLED = fs.readFileSync(path.join(FIXTURES, "manifest-planner", "hand-filled.ost.resources.yaml"), "utf8");

/** The pre-committed bar, transcribed from the assumption test's `threshold:` field. */
const MIN_NOT_RECOVERABLE = 2;

const ALL: ResourceId[] = RESOURCES.map((r) => r.id);

/** No HOME and no tokens: the credential probe reads nothing off the machine running this. */
const NO_ENV: NodeJS.ProcessEnv = {};
const HOLDING_GITHUB: NodeJS.ProcessEnv = { GITHUB_TOKEN: `ghp_${"x".repeat(36)}` };

/** A throwaway vault holding exactly the files named, and nothing else. */
function withVault<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ost-resource-q-"));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text, "utf8");
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A config with the one required field supplied, so each control states only what it is about. */
const config = (raw: Record<string, unknown>) => ConfigSchema.parse({ outcome: "x", ...raw });
const MINIMAL = "outcome: x\n";

describe("every standing question is labelled, always", () => {
  test("an empty directory yields one label per question, each still to ask, and says why", () => {
    withVault({}, (dir) => {
      const report = labelResourceQuestions(dir, { env: NO_ENV });
      expect(report.labels.map((l) => l.resource)).toEqual(ALL);
      expect(report.labels.every((l) => l.standing === "only-the-operator")).toBe(true);
      expect(report.stillToAsk).toEqual(ALL);
      expect(report.problems).toEqual([expect.stringMatching(/no ost\.config\.yaml/)]);
    });
  });

  test("each label carries the question in the manifest's own words", () => {
    withVault({}, (dir) => {
      const report = labelResourceQuestions(dir);
      for (const def of RESOURCES) {
        expect(report.labels.find((l) => l.resource === def.id)?.question).toBe(def.declares);
      }
    });
  });

  test("a broken file answers nothing, and is reported rather than read around", () => {
    withVault(
      { "ost.config.yaml": "loop: [not a mapping\n", [MANIFEST_FILENAME]: "hours:\n  perWeek: lots\n" },
      (dir) => {
        const report = labelResourceQuestions(dir, { env: NO_ENV });
        expect(report.problems).toHaveLength(2);
        expect(report.problems.join("\n")).toMatch(/ost\.config\.yaml is not valid YAML/);
        expect(report.problems.join("\n")).toMatch(/invalid ost\.resources\.yaml/);
        // A half-written manifest is not a source; nor is a config that did not parse.
        expect(report.stillToAsk).toEqual(ALL);
        expect(report.labels.every((l) => l.standing === "only-the-operator")).toBe(true);
      },
    );
  });
});

describe("the readers find nothing when there is nothing", () => {
  test("compute needs both the ceiling and the window — either alone is not a budget per window", () => {
    expect(computeFromConfig(config({}))).toBeUndefined();
    expect(computeFromConfig(config({ loop: { spend: { ceilingWeightedTokens: 1000 } } }))).toBeUndefined();
    expect(computeFromConfig(config({ loop: { spend: { windowHours: 24 } } }))).toBeUndefined();
    const both = computeFromConfig(config({ loop: { spend: { ceilingWeightedTokens: 1000, windowHours: 24 } } }));
    expect(both?.file).toBe("ost.config.yaml (loop.spend)");
    expect(both?.value).toMatch(/1000 weighted token\(s\) per rolling 24h window/);
  });

  test("a credential is needed only by an adapter the config actually enables", () => {
    expect(credentialsNeeded(config({}))).toEqual([]);
    expect(credentialsNeeded(config({ adapters: { slack: { enabled: true } } }))).toEqual(["slack"]);
    expect(
      credentialsNeeded(
        config({ adapters: { slack: { enabled: true }, atlassian: { enabled: true }, actions: { enabled: true } } }),
      ),
    ).toEqual(["slack", "atlassian", "github"]);
  });

  test("the environment half is probed only when an environment is given, and never names a value", () => {
    const none = credentialsFromConfigAndEnv(config({}), undefined);
    expect(none.value).toMatch(/no enabled adapter needs one; no environment was probed/);

    const empty = credentialsFromConfigAndEnv(config({}), NO_ENV);
    expect(empty.value).toMatch(/the environment holds none/);

    const github = credentialsFromConfigAndEnv(config({}), HOLDING_GITHUB);
    expect(github.value).toMatch(/the environment holds: github \(GITHUB_TOKEN\)/);
    expect(github.value).not.toContain("ghp_");
  });

  test("the credential question is never better than partly answered without a manifest", () => {
    withVault({ "ost.config.yaml": `${MINIMAL}adapters:\n  slack:\n    enabled: true\n` }, (dir) => {
      const label = labelResourceQuestions(dir, { env: NO_ENV }).labels.find((l) => l.resource === "credentials")!;
      expect(label.standing).toBe("partly");
      expect(label.from?.value).toMatch(/enabled adapters need: slack/);
      // The half the planner actually defers work on is the half no file holds.
      expect(label.missing).toMatch(/withholds/);
    });
  });

  test("a declared manifest field is recoverable from the manifest, dated, and outranks the config", () => {
    const files = {
      "ost.config.yaml": `${MINIMAL}loop:\n  spend:\n    ceilingWeightedTokens: 1000\n    windowHours: 24\n`,
      [MANIFEST_FILENAME]: "declaredOn: '2026-08-04'\ncompute:\n  tokensPerWindow: 5\n  resetEvery: 5h\nhours:\n  perWeek: 0\n",
    };
    withVault(files, (dir) => {
      const by = new Map(labelResourceQuestions(dir, { env: NO_ENV }).labels.map((l) => [l.resource, l]));
      expect(by.get("hours")).toMatchObject({
        standing: "recoverable",
        from: { file: "ost.resources.yaml, declared on 2026-08-04", value: "0 human hour(s) per week" },
      });
      // The operator's declaration is the answer; the loop ceiling is what they
      // would otherwise have been told.
      expect(by.get("compute")?.from?.file).toBe("ost.resources.yaml, declared on 2026-08-04");
      expect(by.get("compute")?.from?.value).toMatch(/5 token\(s\) per window, resetting every 5h/);
      expect(by.get("capital")?.standing).toBe("only-the-operator");
    });
  });
});

describe("this vault, as cut on 2026-08-20 — the pre-committed bar", () => {
  test("the fixture is the one the provenance describes", () => {
    // Through YAML and then the schema — the same two steps `readConfig` takes.
    const cfg = config(parseYaml(META_CONFIG));
    expect(cfg.loop?.spend?.ceilingWeightedTokens).toBe(96_000_000);
    expect(cfg.loop?.spend?.windowHours).toBe(24);
    expect(credentialsNeeded(cfg)).toEqual([]);
  });

  test("one question is already answered on disk, one by half, and three by nobody but the operator", () => {
    withVault({ "ost.config.yaml": META_CONFIG }, (dir) => {
      const report = labelResourceQuestions(dir, { env: NO_ENV });
      expect(report.problems).toEqual([]);
      const by = new Map(report.labels.map((l) => [l.resource, l.standing]));
      expect(by.get("compute")).toBe("recoverable");
      expect(by.get("credentials")).toBe("partly");
      expect(by.get("capital")).toBe("only-the-operator");
      expect(by.get("hours")).toBe("only-the-operator");
      expect(by.get("social-reach")).toBe("only-the-operator");

      const compute = report.labels.find((l) => l.resource === "compute")!;
      expect(compute.from?.file).toBe("ost.config.yaml (loop.spend)");
      expect(compute.from?.value).toMatch(/96000000 weighted token\(s\) per rolling 24h window/);
    });
  });

  test("at least two answers are facts the vault cannot already recover", () => {
    withVault({ "ost.config.yaml": META_CONFIG }, (dir) => {
      const report = labelResourceQuestions(dir, { env: NO_ENV });
      // The bar, exactly as the assumption test pre-committed it — for the half
      // of it a file can settle. The timing half needs a person.
      expect(report.stillToAsk.length).toBeGreaterThanOrEqual(MIN_NOT_RECOVERABLE);
      // What actually happened, pinned so a regression to "it barely clears"
      // is visible rather than absorbed by the inequality.
      expect(report.stillToAsk).toEqual(["capital", "hours", "social-reach", "credentials"]);
    });
  });

  test("with the manifest a human filled for it, the vault answers every question", () => {
    withVault({ "ost.config.yaml": META_CONFIG, [MANIFEST_FILENAME]: HAND_FILLED }, (dir) => {
      const report = labelResourceQuestions(dir, { env: NO_ENV });
      expect(report.problems).toEqual([]);
      expect(report.stillToAsk).toEqual([]);
      // Every one of those five was lifted out of this vault's PROSE by a person
      // on 2026-08-04 (see the fixture's provenance). Read as files, the same
      // vault answers one and a half. So the count above is the gap between
      // what a file states and what a careful reader can recover — and once
      // the manifest is written, the cadence's only remaining case is decay,
      // which nothing in this file measures.
      expect(report.labels.every((l) => l.from?.file.startsWith(MANIFEST_FILENAME))).toBe(true);
    });
  });
});

describe("the rendered report", () => {
  test("leads with the count and says which way it errs", () => {
    withVault({ "ost.config.yaml": META_CONFIG }, (dir) => {
      const rendered = formatRecoverability(labelResourceQuestions(dir, { env: NO_ENV }));
      expect(rendered).toMatch(/^Resource questions: 5 standing, 1 already answered by the vault, 4 a cadence would still have to ask/);
      expect(rendered).toMatch(/compute — .*\n  RECOVERABLE from ost\.config\.yaml \(loop\.spend\)/);
      expect(rendered).toMatch(/credentials — .*\n  PARTLY — /);
      expect(rendered).toMatch(/hours — .*\n  ONLY THE OPERATOR/);
      expect(rendered).toMatch(/can learn at most 4 of these 5 answers per sitting/);
      // It refuses to be read as a verdict on timing, or as a reading of prose.
      expect(rendered).toMatch(/This reads files, not prose/);
      expect(rendered).toMatch(/How fast an answer goes stale is not measured here/);
    });
  });

  test("a problem is printed above the labels, and the labels are still all there", () => {
    withVault({ "ost.config.yaml": "loop: [broken\n" }, (dir) => {
      const rendered = formatRecoverability(labelResourceQuestions(dir, { env: NO_ENV }));
      expect(rendered).toMatch(/⚠ ost\.config\.yaml is not valid YAML/);
      expect(rendered.match(/ONLY THE OPERATOR/g)).toHaveLength(5);
    });
  });
});
