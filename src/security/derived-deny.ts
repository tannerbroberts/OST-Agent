/**
 * Turn a correction this workspace has already paid for into a standing
 * constraint on the workspace — and refuse, at every step, to let the constraint
 * be wider than the refusal it came from.
 *
 * **The disease, and where the other two answers stop.** Eight times across
 * seven sessions this machine wrote some form of `sleep 45; gh pr checks 17` and
 * was refused (`test/fixtures/corrections/PROVENANCE.md`). `corrections.ts`
 * answers the memory half — the refusal now reaches the next session. `wait.ts`
 * answers the economy half — the permitted form is now shorter to write than the
 * reflex. Both still route through a composer choosing to comply. This module is
 * the third sibling and it removes the composer from the loop: the eighth
 * sleep-then-poll is not resisted by a better-informed session, it is a call this
 * workspace does not accept.
 *
 * **Which makes it the dangerous one, and the asymmetry is the whole design.** A
 * ledger entry that is wrong costs a confused reader. A deny rule that is wrong
 * costs every future session a capability, silently, and its refusal looks
 * exactly like the correct guard it was derived from. So almost everything below
 * is narrowing, attribution, or a refusal to act:
 *
 *   1. **The class is read off the refusal, never inferred from the command.**
 *      The guard states its own class — `Blocked: sleep 240 followed by: git
 *      status …` — and {@link readRefusedShape} parses exactly that sentence. A
 *      refusal that names no class yields no rule ({@link deriveDenyRule}
 *      declines), because a generalisation nobody stated is a guess, and a guess
 *      here is the failure mode the node warned about.
 *   2. **Two conditions, both from the evidence, and the verb alone is neither.**
 *      A `sleep` is refused only when it is a *fixed wait before a look* — a
 *      total of at least {@link DerivedDenyRule.minTotalSeconds} seconds, in
 *      command position, outside a loop body, with a command after it. Every
 *      other use of the same verb passes: a bare delay, a short grace period, an
 *      interval inside the until-loop the guard itself recommends, the word
 *      `sleep` inside a quoted string or an argument.
 *   3. **A derived rule is inert until a human says otherwise.**
 *      {@link deriveDenyRule} produces `status: "proposed"`, which denies
 *      nothing. {@link activateDenyRule} refuses inside an agent session, on the
 *      precedent `allowlist-generator.ts` sets for the mirror-image act: a
 *      session that could write its own grant would be granting itself a permit,
 *      and a session that can write its own constraint is doing the same trick
 *      in the direction the tree already names as a worry ("The agent narrows
 *      its own capability to get past a gate I set").
 *   4. **Reversal is one action and it is printed on every refusal.**
 *      {@link revokeDenyRule} needs no confirmation and no human check, because
 *      loosening is the safe direction; the id it takes is quoted in the denial
 *      message itself, so the person who hits a wrong rule is told how to remove
 *      it by the wall they hit.
 *
 * **What a workspace constraint can actually be expressed as here.** Claude
 * Code's `permissions.deny` list matches on a command *prefix* — `Bash(sleep:*)`
 * — and that grammar cannot state either of this rule's two conditions. Writing
 * this class into `permissions.deny` would necessarily deny every `sleep` in the
 * workspace, including the one inside the guard's own recommended until-loop.
 * So the constraint is carried as a `PreToolUse` hook instead
 * ({@link renderHookSettings}), which is the only place in the settings grammar
 * where a predicate this narrow can live. That is a finding about the surface,
 * not a preference: the obvious place to put a derived deny rule is the one
 * place it cannot be made narrow enough to be safe.
 *
 * Everything here is a pure decision over strings, with an IO shell at the
 * bottom that reads and writes one JSON file and executes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import type { Correction, RefusalSighting } from "../loop/corrections.js";
import { agentSessionMarker } from "./allowlist-generator.js";

/** Filename of the derived-rule file inside the state directory. */
const RULES_FILE = "derived-deny.json";

/** Schema stamp, so a future shape change is detected rather than mis-parsed. */
const RULES_VERSION = 1;

/**
 * The sentence a guard uses to state the class it refused.
 *
 * Uniform across all eight sightings in `test/fixtures/corrections/`:
 * `Blocked: sleep 45 followed by: gh pr checks 13 head -20.` Three things are in
 * it and all three are load-bearing — the verb, the argument it was given, and
 * the relation ("followed by") that made the call wrong. A rule derived from
 * this sentence is a rule the refusing guard already wrote down; a rule derived
 * from the command string alone would be this module inventing the
 * generalisation, which is precisely the act the solution node says needs a
 * human.
 */
const STATED_CLASS = /\bBlocked:\s*([a-z][a-z0-9_.-]*)\s+([^\s;&|]+)\s+followed by:\s*(\S[\s\S]*)$/i;

/** The class a refusal stated about itself, as parsed out of its verdict half. */
export interface RefusedShape {
  /** The verb in command position that was refused. */
  verb: string;
  /** The argument the refusal quoted, as a number, or `null` when it was not one. */
  seconds: number | null;
  /** What the refusal says the verb was followed by. Kept for the message, not matched on. */
  followedBy: string;
}

/**
 * The class a refusal named, or `null` when it named none.
 *
 * `null` is the common case and it is the right default: most refusals in the
 * ledger — "Use one of the available tools instead.", "Retry with valid JSON" —
 * describe a call that failed rather than a shape that is forbidden, and there is
 * nothing in them to constrain a workspace with.
 */
export function readRefusedShape(attempted: string): RefusedShape | null {
  const m = STATED_CLASS.exec(attempted);
  if (!m) return null;
  const seconds = Number(m[2]);
  return {
    verb: m[1].toLowerCase(),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    followedBy: m[3].trim(),
  };
}

/** The one human action that reverses a rule. Quoted in every refusal the rule issues. */
export function revokeCommand(id: string): string {
  return `ost-agent deny --revoke ${id}`;
}

/** A standing constraint on this workspace, derived from a refusal it already paid for. */
export interface DerivedDenyRule {
  /** Stable id: the class, not the wording of the refusal that produced it. */
  id: string;
  /** The tool the constraint applies to. */
  tool: "Bash";
  /** The verb in command position the rule is about. */
  verb: string;
  /**
   * Total fixed seconds, at or above which the shape is refused.
   *
   * The **smallest** duration any recorded refusal of this class quoted — 25s,
   * over eight sightings. Not a round number and deliberately not a chosen one:
   * below it this workspace has no evidence that the reflex exists, and a
   * `sleep 2` before a `kill` is a grace period rather than a guess at how long
   * a thing takes. Totalled across the whole invocation rather than checked per
   * command, because the refusal's own remedy anticipates the evasion: "Do not
   * chain shorter sleeps to work around this block."
   */
  minTotalSeconds: number;
  /** Proposed rules deny nothing. Only a human moves one to `active`. */
  status: "proposed" | "active";
  /** Where the rule came from — the refusal, quoted, and every session that paid for it. */
  derivedFrom: {
    /** The corrections-ledger id of the correction this was derived from. */
    correctionId: string;
    /** The permitted form the guard named. This is the correction's identity, and the remedy. */
    permitted: string;
    /**
     * Every **distinct** refusal that contributed, verbatim, with the sessions it
     * was issued in.
     *
     * Keyed on the refusal text rather than on the session, and that is not
     * cosmetic. Derived from raw transcripts this holds eight different commands
     * from seven sessions; derived from the corrections ledger it holds *one*,
     * because the ledger keeps a single example call per correction and repeating
     * that example once per session would present one refusal as ten. A rule whose
     * provenance inflates is a rule that reads better-evidenced than it is, and
     * provenance is the only thing standing between a derived refusal and an
     * authored one.
     */
    refusals: { sessions: string[]; attempted: string; at: string }[];
  };
  /** The single command that reverses this rule, rendered once so it cannot drift. */
  revokeWith: string;
}

/** A derivation that produced nothing, and the reason, which is the interesting half. */
export interface DeclinedDerivation {
  declined: true;
  reason: "no-stated-class" | "no-duration" | "mixed-verbs";
  message: string;
}

export type Derivation = { declined: false; rule: DerivedDenyRule } | DeclinedDerivation;

/**
 * Derive one deny rule from one correction and the refusals that produced it.
 *
 * Pure, and it fails closed three ways. Every decline leaves the workspace
 * exactly as constrained as it was — which is the outcome to prefer, because the
 * cost of a missing rule is the status quo and the cost of a wrong one is a
 * capability nobody notices losing.
 */
export function deriveDenyRule(input: {
  correction: Pick<Correction, "id" | "permitted">;
  sightings: readonly RefusalSighting[];
}): Derivation {
  const shapes: { shape: RefusedShape; sighting: RefusalSighting }[] = [];
  for (const s of input.sightings) {
    if (s.permitted !== input.correction.permitted) continue;
    const shape = readRefusedShape(s.attempted);
    if (shape) shapes.push({ shape, sighting: s });
  }

  if (shapes.length === 0) {
    return {
      declined: true,
      reason: "no-stated-class",
      message:
        `no rule derived from "${input.correction.id}": none of its refusals states the class it refused. ` +
        `A guard that says what to do instead but not what it blocked leaves the generalisation to be guessed, ` +
        `and a guessed class is the failure this rule shape cannot survive.`,
    };
  }

  const verbs = [...new Set(shapes.map((s) => s.shape.verb))];
  if (verbs.length > 1) {
    return {
      declined: true,
      reason: "mixed-verbs",
      message:
        `no rule derived from "${input.correction.id}": its refusals name ${verbs.length} different verbs ` +
        `(${verbs.join(", ")}). One correction covering several verbs is a correction about something wider ` +
        `than a command shape, and widening is the direction this must never take on its own.`,
    };
  }

  const durations = shapes.map((s) => s.shape.seconds).filter((n): n is number => n !== null);
  if (durations.length === 0) {
    return {
      declined: true,
      reason: "no-duration",
      message:
        `no rule derived from "${input.correction.id}": no refusal of this class quoted a duration, so there is ` +
        `no bound below which the verb is untouched — and a rule with no bound is a rule about the verb itself.`,
    };
  }

  // Folded on the refusal text, so a caller that can only offer one example call
  // records one refusal seen in N sessions rather than N refusals.
  const byText = new Map<string, { sessions: Set<string>; attempted: string; at: string }>();
  for (const { sighting } of shapes) {
    const existing = byText.get(sighting.attempted);
    if (existing) {
      existing.sessions.add(sighting.session);
      if (sighting.at > existing.at) existing.at = sighting.at;
      continue;
    }
    byText.set(sighting.attempted, {
      sessions: new Set([sighting.session]),
      attempted: sighting.attempted,
      at: sighting.at,
    });
  }

  const verb = verbs[0];
  const id = `${verb}-then-command`;
  return {
    declined: false,
    rule: {
      id,
      tool: "Bash",
      verb,
      minTotalSeconds: Math.min(...durations),
      status: "proposed",
      derivedFrom: {
        correctionId: input.correction.id,
        permitted: input.correction.permitted,
        refusals: [...byText.values()]
          .map((r) => ({ sessions: [...r.sessions].sort(), attempted: r.attempted, at: r.at }))
          .sort((a, b) => a.sessions[0].localeCompare(b.sessions[0]) || a.attempted.localeCompare(b.attempted)),
      },
      revokeWith: revokeCommand(id),
    },
  };
}

/**
 * Shell keywords that can stand in front of a command without being the command.
 *
 * Deliberately short. Each entry widens what the rule can see, and `exec`,
 * `nohup` and `command` are left out on purpose: including them would let the
 * rule reach one wrapper further, and a rule that reaches further is a rule that
 * refuses more. Evasion is not the threat model here — the composer being
 * constrained is the same one the constraint is for.
 */
const LEADING_KEYWORDS = new Set(["do", "then", "else", "elif", "!", "time"]);

/** Segment openers that are shell structure rather than a command being run. */
const STRUCTURE = new Set(["done", "fi", "esac", "}", ";;"]);

/**
 * Split a command into the pieces the shell would run in sequence.
 *
 * Quoted material is passed through whole and never split, which is most of what
 * makes the rule narrow: `git commit -m "drop the sleep and poll"` and
 * `grep -rn "sleep 45; gh pr checks" src/` contain the refused string and are not
 * the refused shape. Command substitutions and subshells are stepped over for the
 * same reason — the inside of a `$( … )` is an argument to the segment it sits in.
 */
export function topLevelSegments(command: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote !== null) {
      buf += c;
      if (c === "\\" && quote === '"') buf += command[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      buf += c + (command[++i] ?? "");
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") {
      depth++;
      buf += c;
      continue;
    }
    if (c === ")") {
      if (depth > 0) depth--;
      buf += c;
      continue;
    }
    if (depth > 0) {
      buf += c;
      continue;
    }
    if (c === ";" || c === "\n") {
      out.push(buf);
      buf = "";
      continue;
    }
    if (c === "&" || c === "|") {
      if (command[i + 1] === c) i++;
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** How a command uses the verb the rule is about. */
export interface VerbUse {
  /** Segment index of the last fixed use outside a loop body, or `-1` for none. */
  lastFixedUse: number;
  /** Fixed seconds spent across every such use, summed. */
  totalSeconds: number;
  /** Is there a command after that last use? */
  followed: boolean;
}

/**
 * Read a command for the shape the rule refuses: fixed waits, and whether a look
 * comes after them.
 *
 * Two exemptions are structural rather than listed, and each is a class of
 * legitimate use the verb alone would have eaten:
 *
 *   - **Inside a loop body the verb is an interval, not a wait.**
 *     `until gh pr checks 17; do sleep 30; done` is the form the guard's own
 *     message recommends, and a rule that refused it would refuse compliance
 *     with the correction it was derived from.
 *   - **A use with a non-numeric argument is not counted.** `sleep "$backoff"`
 *     spends an unknown amount of time, and a rule cannot say an unknown number
 *     is at least twenty-five. It under-refuses, which is the direction to be
 *     wrong in.
 */
export function readVerbUse(command: string, verb: string): VerbUse {
  const segments = topLevelSegments(command);
  let loopDepth = 0;
  let lastFixedUse = -1;
  let totalSeconds = 0;
  const isCommand: boolean[] = [];

  segments.forEach((segment, index) => {
    let tokens = segment.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && LEADING_KEYWORDS.has(tokens[0])) {
      if (tokens[0] === "do") loopDepth++;
      tokens = tokens.slice(1);
    }
    if (tokens.length > 0 && tokens[0] === "done") {
      if (loopDepth > 0) loopDepth--;
      tokens = tokens.slice(1);
    }
    isCommand[index] = tokens.length > 0 && !STRUCTURE.has(tokens[0]);
    if (!isCommand[index] || tokens[0] !== verb || loopDepth > 0) return;
    const seconds = Number(tokens[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    totalSeconds += seconds;
    lastFixedUse = index;
  });

  const followed = lastFixedUse >= 0 && isCommand.slice(lastFixedUse + 1).some(Boolean);
  return { lastFixedUse, totalSeconds, followed };
}

/** A refusal this workspace issues on its own authority, and everything a reader needs to overturn it. */
export interface Denial {
  denied: true;
  rule: DerivedDenyRule;
  /** Seconds of fixed wait the command asked for, so the reader can see what was measured. */
  totalSeconds: number;
  message: string;
}

export type CallVerdict = { denied: false } | Denial;

/**
 * Judge one `Bash` command against the active rules.
 *
 * Proposed rules are skipped: a rule nobody has confirmed is a record of what
 * this workspace could constrain, not a constraint.
 */
export function judgeCommand(rules: readonly DerivedDenyRule[], command: string): CallVerdict {
  for (const rule of rules) {
    if (rule.status !== "active") continue;
    const use = readVerbUse(command, rule.verb);
    if (!use.followed || use.totalSeconds < rule.minTotalSeconds) continue;
    return { denied: true, rule, totalSeconds: use.totalSeconds, message: renderDenial(rule, use.totalSeconds) };
  }
  return { denied: false };
}

/**
 * What a session is told when a derived rule refuses it.
 *
 * Three things, and each closes one of the ways this mechanism goes wrong. It
 * names the remedy, because a refusal that only says no reproduces the reflex it
 * blocked. It says the constraint was **derived**, and from which refusals in
 * which sessions — the node's stated danger is that "the refusal looks exactly
 * like the correct guard it was derived from", and a refusal that cites its own
 * provenance does not. And it prints the reversal, so the cost of a rule that
 * turns out to be too wide is one command rather than an archaeology.
 */
export function renderDenial(rule: DerivedDenyRule, totalSeconds: number): string {
  const unique = [...new Set(rule.derivedFrom.refusals.flatMap((r) => r.sessions.map((s) => s.slice(0, 8))))];
  return [
    `Blocked by a derived workspace rule (${rule.id}): ${totalSeconds}s of fixed \`${rule.verb}\` followed by ` +
      `another command, at or above this workspace's threshold of ${rule.minTotalSeconds}s.`,
    rule.derivedFrom.permitted,
    `This rule was DERIVED, not authored: it generalises ${rule.derivedFrom.refusals.length} distinct refusal(s) ` +
      `already issued here across ${unique.length} session(s) (${unique.join(", ")}). It does not apply to a bare ` +
      `\`${rule.verb}\`, to a shorter one, or to one inside an until-loop.`,
    `If it is refusing legitimate work, that is the rule being wrong and not you: ${rule.revokeWith}`,
  ].join("\n");
}

/** The rule file as it sits on disk. */
export interface DenyRuleFile {
  version: number;
  rules: DerivedDenyRule[];
}

export function denyRulesPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), RULES_FILE);
}

export function emptyDenyRuleFile(): DenyRuleFile {
  return { version: RULES_VERSION, rules: [] };
}

/**
 * The rules on disk, or none.
 *
 * A file that will not parse yields **no rules**, which is the fail-open
 * direction and the opposite of what `health.ts` does with a record it decides
 * on. The asymmetry is deliberate: an unreadable constraint file that still
 * refused calls would be a workspace narrowed by a corrupted byte, and nothing
 * in it could be read to say why.
 */
export function readDenyRules(stateDir: string): DenyRuleFile {
  const p = denyRulesPath(stateDir);
  if (!fs.existsSync(p)) return emptyDenyRuleFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<DenyRuleFile>;
    if (parsed.version !== RULES_VERSION) return emptyDenyRuleFile();
    return { version: RULES_VERSION, rules: Array.isArray(parsed.rules) ? parsed.rules : [] };
  } catch {
    return emptyDenyRuleFile();
  }
}

function writeDenyRules(stateDir: string, file: DenyRuleFile): void {
  const dir = path.resolve(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(denyRulesPath(dir), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export type RuleOp =
  | { ok: true; message: string; file: DenyRuleFile }
  | { ok: false; reason: "agent-session" | "unknown-rule"; message: string };

/**
 * Record a derived rule, inert.
 *
 * An agent session may do this, and that is the whole division of labour: a
 * session may *notice* that a class of call keeps being refused here, and may
 * not decide that the class stops being expressible. Re-proposing an existing
 * rule refreshes its provenance and never changes its status — a proposal cannot
 * launder itself into an active rule by being derived a second time.
 */
export function proposeDenyRule(stateDir: string, rule: DerivedDenyRule): RuleOp {
  const file = readDenyRules(stateDir);
  const existing = file.rules.find((r) => r.id === rule.id);
  const next = existing
    ? file.rules.map((r) => (r.id === rule.id ? { ...rule, status: r.status } : r))
    : [...file.rules, rule];
  const written = { version: RULES_VERSION, rules: next };
  writeDenyRules(stateDir, written);
  return {
    ok: true,
    message: existing
      ? `refreshed the provenance of ${rule.id} (still ${existing.status}); ${rule.revokeWith} removes it`
      : `proposed ${rule.id} — inert until a human runs \`ost-agent deny --activate ${rule.id}\``,
    file: written,
  };
}

/**
 * Make a proposed rule bind. Humans only.
 *
 * The refusal is `allowlist-generator.ts`'s, for the mirror-image reason. That
 * module refuses to let a session widen its own grant; this one refuses to let a
 * session narrow its own capability, and the tree names the second worry
 * explicitly ("The agent narrows its own capability to get past a gate I set").
 * A pass that could activate its own constraints could make any inconvenient
 * call unavailable to the pass that follows it, and every such removal would
 * read as this workspace's settled policy.
 */
export function activateDenyRule(
  stateDir: string,
  id: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): RuleOp {
  const marker = agentSessionMarker(env);
  if (marker) {
    return {
      ok: false,
      reason: "agent-session",
      message: [
        `REFUSED: this ran inside an agent session (${marker} is set), and only a human may activate a derived`,
        "deny rule. A derived rule removes a capability from every session that follows it, and the session that",
        "derived it is the one party with an interest in the removal. Proposing is compute's half of this; the",
        "generalisation is a human's, which is what the assumption test beneath this candidate requires.",
        `Who may run it: the operator, from a plain terminal, as \`ost-agent deny --activate ${id}\`.`,
        "Nothing was written.",
      ].join("\n"),
    };
  }
  const file = readDenyRules(stateDir);
  const rule = file.rules.find((r) => r.id === id);
  if (!rule) {
    return { ok: false, reason: "unknown-rule", message: `no derived rule ${id} in ${denyRulesPath(stateDir)}` };
  }
  const written = { version: RULES_VERSION, rules: file.rules.map((r) => (r.id === id ? { ...r, status: "active" as const } : r)) };
  writeDenyRules(stateDir, written);
  return { ok: true, message: `${id} is now active; ${rule.revokeWith} removes it`, file: written };
}

/**
 * Remove a rule. One action, no confirmation, no environment check.
 *
 * The asymmetry with {@link activateDenyRule} is the point. Narrowing needs a
 * human because a wrong narrowing is invisible; widening back needs nothing
 * because a wrong widening leaves the workspace exactly where it was before any
 * of this existed. The threshold this module is measured against says
 * "reversible by one human action", and an action that can be refused by the
 * environment it is run in is not one.
 */
export function revokeDenyRule(stateDir: string, id: string): RuleOp {
  const file = readDenyRules(stateDir);
  if (!file.rules.some((r) => r.id === id)) {
    return { ok: false, reason: "unknown-rule", message: `no derived rule ${id} in ${denyRulesPath(stateDir)}` };
  }
  const written = { version: RULES_VERSION, rules: file.rules.filter((r) => r.id !== id) };
  writeDenyRules(stateDir, written);
  return { ok: true, message: `removed ${id}; the calls it refused are expressible again`, file: written };
}

/**
 * The settings fragment that makes an active rule bind on a real session.
 *
 * A `PreToolUse` hook rather than a `permissions.deny` entry, and the reason is
 * the grammar rather than taste. `permissions.deny` matches a command prefix, so
 * the narrowest thing it can say about this class is `Bash(sleep:*)` — which
 * refuses a bare `sleep 2` in a fixture and refuses the `sleep 5` inside the
 * until-loop the correction itself recommends. Both of those are in the corpus
 * this rule is measured against as legitimate uses, so the settings key that
 * looks purpose-built for a derived deny rule is the one place the rule cannot
 * be stated without being wrong.
 *
 * `--check` exits 2 on a denial, which is the status Claude Code reads as "block
 * this call and show the reason to the model".
 */
export function renderHookSettings(cliInvocation: string, stateDir: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `${cliInvocation} deny --state ${stateDir} --check-stdin` }],
        },
      ],
    },
  };
}

/** The rules, rendered for a person deciding whether to keep them. */
export function renderDenyRules(file: DenyRuleFile, stateDir: string): string {
  if (file.rules.length === 0) {
    return `No derived deny rules in ${denyRulesPath(stateDir)} — nothing in this workspace is refused on its own authority.`;
  }
  const lines = [`Derived deny rules in ${denyRulesPath(stateDir)}:`, ""];
  for (const r of file.rules) {
    lines.push(`- ${r.id} [${r.status}] — ${r.tool}: ${r.minTotalSeconds}s+ of fixed \`${r.verb}\` followed by a command`);
    const sessions = new Set(r.derivedFrom.refusals.flatMap((refusal) => refusal.sessions));
    lines.push(
      `    derived from "${r.derivedFrom.correctionId}" — ${r.derivedFrom.refusals.length} distinct refusal(s) ` +
        `across ${sessions.size} session(s):`,
    );
    for (const refusal of r.derivedFrom.refusals) {
      lines.push(`      ${refusal.sessions.join(", ")}: ${refusal.attempted}`);
    }
    lines.push(`    reverse with: ${r.revokeWith}`);
  }
  return lines.join("\n");
}
