/**
 * Which of the standing resource questions the vault can already answer
 * without asking the operator.
 *
 * The candidate this serves puts the five resource questions to the operator on
 * a cadence, with every answer expiring. The assumption underneath it is that
 * asking is worth its price — and the price is human minutes, the resource this
 * operator has already declared they do not have. A question the vault could
 * answer itself is a tax on the operator, and a cadence made of such questions
 * bills them every period for what is already on disk.
 *
 * So this file does one thing: for each of {@link RESOURCES} it says whether
 * something already on disk holds the answer, and names the file. The count of
 * questions that nothing on disk answers is the most a cadence could learn per
 * sitting; the assumption test's pre-committed bar is that this count be at
 * least two. Below it, a one-time manifest dominates the cadence on cost.
 *
 * **What counts as "on disk", and what deliberately does not.** A reader here
 * looks only at structured files — `ost.resources.yaml`, the `loop.spend` and
 * adapter blocks of `ost.config.yaml`, and the credential probe the run itself
 * uses. It never mines node prose. The manifest's own provenance shows a
 * careful human lifted all five answers out of this vault's prose on
 * 2026-08-04 ("my hours don't exist" from a bucket title, "that isn't going to
 * fly" from an annotation); a reader that did the same would be manifest.ts
 * inferring, which is the one thing that file refuses to do, and its misreads
 * would be laundered into "already known, no need to ask". So a fact only a
 * reader could lift from prose is counted as NOT recoverable here, and the
 * rendered report says so, because that is the direction in which the count
 * errs — it overstates what the cadence could learn, never understates it.
 *
 * **What it cannot settle.** Whether an answer is still true. A `loop.spend`
 * ceiling in the config is the budget the loop fires under today; the
 * cadence's whole case is that such facts go stale, and staleness is a property
 * of the operator's world that no read of the vault can measure. This file
 * labels; it does not time.
 */
import fs from "node:fs";
import { configPath, readConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { detectAuthentication } from "../security/auth-detection-report.js";
import {
  MANIFEST_FILENAME,
  RESOURCES,
  declaredValue,
  readResourceManifest,
  summarizeDeclared,
  type ResourceId,
  type ResourceManifest,
} from "./manifest.js";

/**
 * How much of one question the vault already answers.
 *
 * - `recoverable` — a file on disk states the answer; asking would bill the
 *   operator for it twice.
 * - `partly` — a file states one half and nothing states the other; the
 *   cadence still has to ask, and the label names which half.
 * - `only-the-operator` — nothing on disk states it.
 *
 * Three values rather than a boolean because a cadence that drops `partly`
 * questions on the strength of the half it has would be dropping the half it
 * does not — and the half it lacks (which credentials are *withheld*) is the
 * one the planner defers work on.
 */
export type Standing = "recoverable" | "partly" | "only-the-operator";

export interface QuestionLabel {
  resource: ResourceId;
  /** The question as the manifest puts it to the operator. */
  question: string;
  standing: Standing;
  /** Where on disk, and what it says. Present for `recoverable` and `partly`. */
  from?: { file: string; value: string };
  /** For `partly`: the half of the question no file answers. */
  missing?: string;
}

export interface RecoverabilityReport {
  /** One label per standing question, in {@link RESOURCES} order, always all five. */
  labels: QuestionLabel[];
  /**
   * The questions a cadence would still have to put to the operator — anything
   * short of `recoverable`. Its length is the count the assumption test's bar
   * is stated against.
   */
  stillToAsk: ResourceId[];
  /** Files that exist and could not be read. A broken file answers nothing. */
  problems: string[];
}

export interface RecoverabilityOptions {
  /**
   * The environment an unattended run would hold its credentials in. Passed in
   * rather than reached for, so the reading is not global state; omitted, no
   * environment is probed and the credential label says so.
   */
  env?: NodeJS.ProcessEnv;
}

/** The answer the operator already declared, if they did. */
function fromManifest(m: ResourceManifest, id: ResourceId): QuestionLabel["from"] | undefined {
  if (declaredValue(m, id) === undefined) return undefined;
  const when = m.declaredOn ? `, declared on ${m.declaredOn}` : "";
  return { file: `${MANIFEST_FILENAME}${when}`, value: summarizeDeclared(m, id)! };
}

/**
 * The token budget and its window, read off the loop's own spend ceiling.
 *
 * Both numbers or nothing: a ceiling with no window is not a budget per
 * window, and the config schema allows either half alone.
 */
export function computeFromConfig(config: Config): QuestionLabel["from"] | undefined {
  const spend = config.loop?.spend;
  if (!spend?.ceilingWeightedTokens || !spend.windowHours) return undefined;
  return {
    file: "ost.config.yaml (loop.spend)",
    value:
      `${spend.ceilingWeightedTokens} weighted token(s) per rolling ${spend.windowHours}h window — ` +
      "the ceiling the unattended loop fires under",
  };
}

/** Credential names the enabled adapters will ask the broker for, in `ost-agent auth` order. */
export function credentialsNeeded(config: Config): string[] {
  const needed: string[] = [];
  if (config.adapters.slack.enabled) needed.push("slack");
  if (config.adapters.atlassian.enabled) needed.push("atlassian");
  if (config.adapters.actions.enabled) needed.push("github");
  return needed;
}

/**
 * The credential question, which the vault answers by half.
 *
 * The config says which credentials a run of this vault NEEDS; the environment
 * says which it HOLDS right now (the same probe `ost-agent auth` prints, never
 * a value). Neither says which the operator WITHHOLDS — that is a decision,
 * and the manifest is the only place it is written down. So without a manifest
 * this is `partly` at best, and the missing half is named.
 */
export function credentialsFromConfigAndEnv(config: Config, env: NodeJS.ProcessEnv | undefined): QuestionLabel["from"] {
  const needed = credentialsNeeded(config);
  const needs = needed.length ? `enabled adapters need: ${needed.join(", ")}` : "no enabled adapter needs one";
  if (!env) return { file: "ost.config.yaml (adapters)", value: `${needs}; no environment was probed` };
  const held = detectAuthentication(env)
    .entries.filter((e) => e.status === "will-use")
    .map((e) => (e.status === "will-use" ? `${e.name} (${e.source})` : e.name));
  const holds = held.length ? `the environment holds: ${held.join(", ")}` : "the environment holds none";
  return { file: "ost.config.yaml (adapters) + the credential probe", value: `${needs}; ${holds}` };
}

const WITHHELD_IS_A_DECISION =
  "which credentials the operator withholds from an unattended run — a decision, recorded nowhere but the manifest";

/**
 * Label every standing resource question by whether the vault already holds
 * its answer.
 *
 * Always returns all five labels. A vault with no config and no manifest gets
 * five `only-the-operator` labels and a problem naming the missing config —
 * never fewer labels, because "which questions does the cadence still have to
 * ask?" must not depend on what the vault happened to contain.
 */
export function labelResourceQuestions(vaultDir: string, opts: RecoverabilityOptions = {}): RecoverabilityReport {
  const problems: string[] = [];

  const manifestLoad = readResourceManifest(vaultDir);
  if (manifestLoad.problem) problems.push(manifestLoad.problem);
  const manifest = manifestLoad.manifest;

  // `readConfig` throws on a MISSING file, which is the right answer for a tool
  // that needs one and the wrong answer here: a directory with no config is a
  // vault that answers no question, which is a labelling, not an error.
  let config: Config | undefined;
  if (fs.existsSync(configPath(vaultDir))) {
    const load = readConfig(vaultDir);
    if (load.problem) problems.push(load.problem);
    else config = load.config;
  } else {
    problems.push("no ost.config.yaml — the vault's loop ceiling and adapters cannot answer anything");
  }

  const labels: QuestionLabel[] = RESOURCES.map((def) => {
    const base = { resource: def.id, question: def.declares };
    const declared = fromManifest(manifest, def.id);
    if (declared) return { ...base, standing: "recoverable", from: declared };

    if (def.id === "compute" && config) {
      const from = computeFromConfig(config);
      if (from) return { ...base, standing: "recoverable", from };
    }
    if (def.id === "credentials" && config) {
      return { ...base, standing: "partly", from: credentialsFromConfigAndEnv(config, opts.env), missing: WITHHELD_IS_A_DECISION };
    }
    return { ...base, standing: "only-the-operator" };
  });

  return {
    labels,
    stillToAsk: labels.filter((l) => l.standing !== "recoverable").map((l) => l.resource),
    problems,
  };
}

/** The report `ost-agent resources` prints. */
export function formatRecoverability(report: RecoverabilityReport): string {
  const answered = report.labels.length - report.stillToAsk.length;
  const lines: string[] = [
    `Resource questions: ${report.labels.length} standing, ${answered} already answered by the vault, ` +
      `${report.stillToAsk.length} a cadence would still have to ask`,
  ];
  for (const p of report.problems) lines.push(`  ⚠ ${p}`);
  for (const l of report.labels) {
    lines.push("");
    lines.push(`${l.resource} — ${l.question}`);
    switch (l.standing) {
      case "recoverable":
        lines.push(`  RECOVERABLE from ${l.from!.file}: ${l.from!.value}`);
        break;
      case "partly":
        lines.push(`  PARTLY — ${l.from!.file}: ${l.from!.value}`);
        lines.push(`  still to ask: ${l.missing}`);
        break;
      case "only-the-operator":
        lines.push("  ONLY THE OPERATOR — nothing on disk states it");
        break;
    }
  }
  lines.push("");
  lines.push(
    `Asking on a cadence can learn at most ${report.stillToAsk.length} of these ${report.labels.length} answers per sitting; ` +
      `the other ${answered} would bill the operator for what is already on disk.`,
  );
  lines.push(
    "This reads files, not prose: a fact a careful reader could lift from a node body is not counted as recoverable, " +
      "so the count errs toward overstating what a cadence could learn. How fast an answer goes stale is not measured here.",
  );
  return lines.join("\n");
}
