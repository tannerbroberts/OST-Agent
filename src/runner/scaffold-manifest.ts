/**
 * The scaffold manifest, and the census that asks whether it could ever have helped.
 *
 * The candidate this serves is "The scaffolder writes a manifest of what it did and did
 * not initialise" — whatever creates a workspace leaves a small machine-readable record
 * of what it set up and, more importantly, what it deliberately did *not*, so a later
 * reader gets the state by reading one file instead of probing for it. Its two siblings
 * under the same opportunity make the reader pay every time
 * (`src/runner/workspace-state-probe.ts`) or remove the variance so nobody pays
 * (`src/runner/scaffold-init.ts`); this one claims **the writer pays once and every
 * reader benefits**.
 *
 * Two things live here, and they answer different questions:
 *
 *   1. **The mechanism** — {@link buildScaffoldManifest}, {@link writeScaffoldManifest},
 *      {@link readScaffoldManifest}. `initVault` already computes every fact a manifest
 *      would carry and then prints it to a console, so the writing half of this candidate
 *      is a serialisation, not a discovery. The node's own stated blocker is staleness,
 *      so every claim carries a {@link Witness}: the reader is told `fresh`, `stale` or
 *      `unverifiable` per claim rather than being handed a belief.
 *   2. **The census** — {@link scaffoldManifestCoverage}. The assumption test asks how
 *      many of the captured exit-128 failures happened in a directory this tool actually
 *      scaffolded, because a manifest can only exist where the scaffolder ran.
 *
 * ## Two things a reader of the exit code has to be told
 *
 * **The census came out refuted on the bar, and the command is green anyway.** That is
 * this repository's convention for a census — `test/runner/workspace-state-probe-coverage.test.ts`,
 * `test/runner/workspace-map-coverage.test.ts` and `test/runner/unconditional-scaffold-init.test.ts`
 * all pin a refuted count the same way. The exit code says the count has been taken and
 * has not moved; it does not say the assumption held.
 * {@link ScaffoldManifestCensus.headline}`.meetsBar` is the verdict and the spec asserts
 * it `false` by name so it cannot be skimmed past.
 *
 * **One reading does clear the threshold, and it is the reading under which the
 * mechanism cannot exist.** Read "a directory this tool actually scaffolded" as "any
 * directory a tool call in the record brought into being", and 3 of the node's own 4
 * cited failures clear — all three in `/Users/tanner/dev/apple-epoch-primes`, a directory
 * that came into existence because a coding agent wrote `index.mjs` into it. No
 * scaffolder ran there, so no manifest was ever going to be on disk to read.
 * {@link ScaffoldManifestCensus.clearsWithoutAManifest} carries that, because a bar met
 * by counting directories the mechanism cannot reach is not a bar met.
 *
 * ## What this cannot settle
 *
 * - **Staleness in use.** The witness scheme below detects a stale claim rather than
 *   believing it, but whether claims actually go stale in the field, and how often, needs
 *   a period of real use. The assumption test says so itself.
 * - **One machine, one operator.** Every failure counted here was caused by this
 *   project's own passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  SCAFFOLD_INIT_RULE,
  type CreationEvidence,
  type UninitialisedRepoFailure,
} from "./scaffold-init.js";

// ════════════════════════════════════════════════════════════════════════════
// PART 1 — the mechanism
// ════════════════════════════════════════════════════════════════════════════

/** Bumped when the claim set or the witness scheme changes shape. */
export const SCAFFOLD_MANIFEST_VERSION = 1;

/** Where the manifest lives, relative to the vault root. Under the dot-folder Obsidian ignores. */
export const SCAFFOLD_MANIFEST_FILE = path.join(".ost-agent", "scaffold-manifest.json");

/**
 * The questions the scaffolder can answer about a workspace it made.
 *
 * Fixed, and small on purpose. A manifest whose key set grows per-run is a manifest a
 * reader has to parse defensively, which is the probe again with extra steps.
 */
export type ClaimId =
  | "git-repository"
  | "remote-configured"
  | "dependencies-installed"
  | "config-file"
  | "outcome-node"
  | "drop-folder"
  | "tool-declaration"
  | "tool-enabling";

/**
 * How a reader confirms a claim without trusting it.
 *
 * This is the node's own stated blocker — *"a manifest is a claim about state, not the
 * state itself, and claims go stale"* — answered at the only place it can be answered:
 * the claim says what the world should look like if it still holds, so a reader that
 * checks gets `stale` instead of confident wrongness.
 */
export interface Witness {
  /**
   * Vault-relative wherever the thing is inside the vault, absolute only when it is not.
   *
   * Relative on purpose. The manifest is committed with the vault — `init`'s own commit
   * picks it up — and a vault is meant to be moved, cloned and carried to another
   * machine. An absolute witness in a committed file makes every claim read `stale` the
   * moment the vault lands anywhere else, which is a false alarm dressed as the staleness
   * detection this file exists for.
   */
  path: string;
  /** What the world should look like while the claim holds. */
  expect: "present" | "absent";
  /** For a file whose *contents* carry the claim — a `[remote ` section in `.git/config`. */
  containing?: string;
  /**
   * True when the witness could not be made relative because the thing genuinely lives
   * outside the vault — the drop folder, which W1 puts outside the working tree on
   * purpose.
   *
   * Marked rather than silently absolute, so a reader on a moved vault can tell a claim
   * that went stale from a claim that only looks stale because the machine changed.
   */
  outsideVault?: true;
}

/**
 * What checking this fact costs a reader who has no manifest.
 *
 * Recorded per claim because it is the whole economic argument for this candidate, and
 * the argument does not survive contact with the claim set. A `stat` claim is one a
 * reader can answer for itself in a single syscall — reading the manifest instead saves
 * nothing, it only relabels. The saving is real only for `subprocess` and `unobservable`.
 */
export type ProbeCost =
  /** One `fs.existsSync`. A manifest saves nothing here. */
  | "stat"
  /** A `git`/`npm` invocation, or a parse of a file whose format is not ours. */
  | "subprocess"
  /** Not recoverable from the directory at all after the fact — only the writer knew. */
  | "unobservable";

/** One thing the scaffolder did, or deliberately did not do. */
export interface ScaffoldClaim {
  id: ClaimId;
  /**
   * True when the scaffolder performed the action itself.
   *
   * The `false` rows are the point of the whole candidate: `dependencies-installed:
   * false` and `remote-configured: false` are facts nothing else in the workspace
   * records.
   */
  did: boolean;
  /** What the scaffolder found or left behind, in the operator's terms. */
  detail: string;
  /** How a reader confirms this claim is still true. Null when nothing cheap can. */
  witness: Witness | null;
  /** What answering this without a manifest would have cost. */
  probeCost: ProbeCost;
}

/** A machine-readable record of one scaffolding run. */
export interface ScaffoldManifest {
  version: number;
  /** Who wrote it. A reader that finds a foreign tool's manifest must not read it as ours. */
  tool: "ost-agent";
  toolVersion: string;
  /** ISO-8601. Passed in, never read off the clock, so a manifest is reproducible in a test. */
  scaffoldedAt: string;
  /** The directory this manifest speaks for, absolute. */
  dir: string;
  claims: ScaffoldClaim[];
}

/**
 * The facts `initVault` already has when it returns, in the shape the manifest needs.
 *
 * Declared structurally rather than importing `InitResult`, so `init.ts` can depend on
 * this module without this module depending back on it.
 */
export interface ScaffoldFacts {
  /** True when the scaffolder ran `git init`; false when the directory was already a repo. */
  gitInitialized: boolean;
  outcomeCreated: boolean;
  /** The root node's filename, so the outcome claim has something to witness. */
  outcomeFile: string;
  /** Absolute; may sit outside the vault. */
  inboxDir: string;
  inboxConfined: boolean;
  /** The publication target the vault's own config names, or null when it names none. */
  remoteUrl: string | null;
  toolDeclaration: { status: "written" | "already-declared" | "skipped"; file: string };
  toolEnabling: { status: "enabled" | "already-enabled" | "skipped"; file: string };
}

/**
 * Build the manifest from what the scaffolder already knows.
 *
 * Every value here was computed by `initVault` on the way to its return value and then
 * printed to a console — which is the node's claim that "the information existed and was
 * thrown away", and it is accurate about this repository.
 *
 * Two of the eight claims are constants rather than parameters, and that is itself the
 * finding they carry:
 *
 *   - `git-repository` is always `did: true` or "already a repository", never "not a
 *     repository". `gitInitIfAbsent` runs on every scaffold with no flag to skip it, so
 *     the `git: false` the node names as its motivating example **cannot be produced by
 *     this scaffolder**.
 *   - `dependencies-installed` is always false. The scaffolder has never installed
 *     anything and has no code path that could.
 */
export function buildScaffoldManifest(dir: string, facts: ScaffoldFacts, opts: { at: string; toolVersion: string }): ScaffoldManifest {
  const abs = path.resolve(dir);
  const claims: ScaffoldClaim[] = [
    {
      id: "git-repository",
      did: facts.gitInitialized,
      detail: facts.gitInitialized
        ? "the scaffolder ran `git init` here — this directory was not a repository before it"
        : "already a repository when the scaffolder arrived; it initialised nothing",
      // Present either way: this scaffolder never leaves a directory un-initialised.
      witness: { path: ".git", expect: "present" },
      probeCost: "stat",
    },
    {
      id: "remote-configured",
      did: facts.remoteUrl !== null,
      detail:
        facts.remoteUrl !== null
          ? `publishes to ${facts.remoteUrl}, as the vault's own ost.config.yaml names it`
          : "no remote — the vault's config names no publication target, and nothing here pushes",
      witness: { path: path.join(".git", "config"), expect: facts.remoteUrl !== null ? "present" : "absent", containing: "[remote " },
      probeCost: "subprocess",
    },
    {
      id: "dependencies-installed",
      did: false,
      detail: "the scaffolder installs nothing — a vault has no dependencies and no install step ever ran here",
      witness: { path: "node_modules", expect: "absent" },
      probeCost: "stat",
    },
    {
      id: "config-file",
      did: true,
      detail: "ost.config.yaml written (or found and left alone — the scaffolder never overwrites one)",
      witness: { path: "ost.config.yaml", expect: "present" },
      probeCost: "stat",
    },
    {
      id: "outcome-node",
      did: facts.outcomeCreated,
      detail: facts.outcomeCreated
        ? "the root Outcome node was created by this run"
        : "the root Outcome node was already present and was not re-titled",
      witness: { path: facts.outcomeFile, expect: "present" },
      probeCost: "stat",
    },
    {
      id: "drop-folder",
      did: true,
      detail: facts.inboxConfined
        ? `notes go to ${facts.inboxDir}, deliberately outside the vault — writing notes and writing the tree are different grants`
        : `notes go to ${facts.inboxDir}, INSIDE the vault — writing notes and writing the tree are the same grant`,
      witness: witnessFor(abs, facts.inboxDir, "present"),
      probeCost: "stat",
    },
    {
      id: "tool-declaration",
      did: facts.toolDeclaration.status === "written",
      detail: declarationDetail(facts.toolDeclaration.status),
      witness: witnessFor(abs, facts.toolDeclaration.file, facts.toolDeclaration.status === "skipped" ? "absent" : "present"),
      probeCost: "subprocess",
    },
    {
      id: "tool-enabling",
      did: facts.toolEnabling.status === "enabled",
      detail: enablingDetail(facts.toolEnabling.status),
      witness: witnessFor(abs, facts.toolEnabling.file, facts.toolEnabling.status === "skipped" ? "absent" : "present"),
      probeCost: "subprocess",
    },
  ];
  return { version: SCAFFOLD_MANIFEST_VERSION, tool: "ost-agent", toolVersion: opts.toolVersion, scaffoldedAt: opts.at, dir: abs, claims };
}

/**
 * A witness for something `initVault` knows only as an absolute path, made relative to
 * the vault whenever it actually lives there.
 *
 * The manifest is committed inside the vault and a vault is meant to travel, so an
 * absolute path baked into it is a claim about a machine rather than about a workspace.
 * Anything genuinely outside the vault — the drop folder, which W1 puts outside the
 * working tree deliberately — stays absolute and is flagged, because that claim really is
 * machine-bound and a reader elsewhere is entitled to know which kind it is holding.
 */
function witnessFor(vaultDir: string, target: string, expect: "present" | "absent"): Witness {
  const rel = path.relative(vaultDir, path.resolve(target));
  if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return { path: rel, expect };
  return { path: path.resolve(target), expect, outsideVault: true };
}

function declarationDetail(status: ScaffoldFacts["toolDeclaration"]["status"]): string {
  if (status === "written") return "this run wrote .mcp.json — the vault now declares its own tool server";
  if (status === "already-declared") return "the vault already declared a usable tool server; this run left it alone";
  return "NO declaration was written — this vault does not carry its own tool server";
}

function enablingDetail(status: ScaffoldFacts["toolEnabling"]["status"]): string {
  if (status === "enabled") return "this run wrote the enabling keys — opening this vault launches ost-agent's tools";
  if (status === "already-enabled") return "something above this vault already enables the plugin; this run wrote nothing";
  return "the enabling keys were NOT written — opening this vault does not launch ost-agent's tools on its own";
}

// ── writing and reading it ───────────────────────────────────────────────────

/** Just enough of `fs` to check a witness, so the reader is testable without a disk. */
export interface ManifestFs {
  exists(p: string): boolean;
  read(p: string): string | null;
}

/** The real one. */
export const nodeManifestFs: ManifestFs = {
  exists: (p) => fs.existsSync(p),
  read: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

/** Write the manifest. Overwrites: it speaks for the most recent scaffolding run, not for all of them. */
export function writeScaffoldManifest(dir: string, manifest: ScaffoldManifest): string {
  const file = path.join(path.resolve(dir), SCAFFOLD_MANIFEST_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return file;
}

/**
 * Whether a claim still describes the world.
 *
 * `unverifiable` is not a failure — it is the honest answer for a claim with no witness,
 * and it tells the reader to go and probe rather than to believe.
 */
export type Freshness = "fresh" | "stale" | "unverifiable";

export interface VerifiedClaim {
  claim: ScaffoldClaim;
  freshness: Freshness;
  /** What the witness actually showed, when it disagreed. */
  observed?: string;
}

export interface ManifestReading {
  /**
   * `absent` is the common case and the one the node's own text concedes: a folder a
   * person made, or another tool made, or that was cloned, has no manifest. A reader
   * that handles absence has already built the probe.
   */
  status: "absent" | "unreadable" | "foreign" | "read";
  manifest?: ScaffoldManifest;
  claims: VerifiedClaim[];
  stale: ClaimId[];
  unverifiable: ClaimId[];
  /** True only when a manifest was read AND nothing in it has gone stale. */
  trustworthy: boolean;
  /**
   * True when something went stale and **every** stale claim is one whose witness sits
   * outside the vault.
   *
   * The shape of a vault that was moved or cloned rather than a vault somebody changed.
   * Distinguished because the manifest is committed and a vault is meant to travel: a
   * reader that treats "the drop folder is gone" on a fresh clone as tampering has turned
   * the staleness check into a false alarm, which is worse than not having one.
   */
  movedVaultSuspected: boolean;
  /** What the reader should do next, in one line. Never "trust this". */
  advice: string;
}

/** Check one claim against the world. */
export function verifyClaim(claim: ScaffoldClaim, dir: string, fsLike: ManifestFs): VerifiedClaim {
  if (claim.witness === null) return { claim, freshness: "unverifiable" };
  const w = claim.witness;
  const target = path.isAbsolute(w.path) ? w.path : path.join(dir, w.path);
  const present = fsLike.exists(target);

  if (w.containing !== undefined) {
    // A claim carried by a file's contents. Absence of the file is absence of the
    // section, which is what `expect: "absent"` means for these.
    const body = present ? fsLike.read(target) : null;
    const has = body !== null && body.includes(w.containing);
    if (has === (w.expect === "present")) return { claim, freshness: "fresh" };
    return { claim, freshness: "stale", observed: has ? `${target} now contains ${w.containing}` : `${target} no longer contains ${w.containing}` };
  }

  if (present === (w.expect === "present")) return { claim, freshness: "fresh" };
  return { claim, freshness: "stale", observed: present ? `${target} now exists` : `${target} is gone` };
}

/** Verify a manifest already in hand. */
export function verifyScaffoldManifest(manifest: ScaffoldManifest, dir: string, fsLike: ManifestFs = nodeManifestFs): ManifestReading {
  const claims = manifest.claims.map((c) => verifyClaim(c, dir, fsLike));
  const stale = claims.filter((c) => c.freshness === "stale").map((c) => c.claim.id);
  const unverifiable = claims.filter((c) => c.freshness === "unverifiable").map((c) => c.claim.id);
  const movedVaultSuspected =
    stale.length > 0 && claims.filter((c) => c.freshness === "stale").every((c) => c.claim.witness?.outsideVault === true);
  return {
    status: "read",
    manifest,
    claims,
    stale,
    unverifiable,
    trustworthy: stale.length === 0,
    movedVaultSuspected,
    advice: movedVaultSuspected
      ? `${stale.length} claim(s) fail, and every one of them witnesses a path outside the vault (${stale.join(", ")}) — ` +
        `this looks like a vault that moved rather than a vault that changed; re-run \`ost-agent init\` here to restate them`
      : stale.length > 0
        ? `${stale.length} claim(s) no longer describe this directory (${stale.join(", ")}) — probe those rather than believing the manifest`
        : unverifiable.length > 0
          ? `every witnessed claim still holds; ${unverifiable.length} claim(s) carry no witness (${unverifiable.join(", ")}) and are beliefs, not observations`
          : "every claim in this manifest was checked against the directory and still holds",
  };
}

/**
 * Read the manifest for a directory, verifying every claim on the way out.
 *
 * There is no code path here that returns an unverified claim, deliberately. The failure
 * mode the node names is a reader that believes a stale manifest and proceeds
 * confidently; the way to not build that reader is to make the belief unavailable.
 */
export function readScaffoldManifest(dir: string, fsLike: ManifestFs = nodeManifestFs): ManifestReading {
  const abs = path.resolve(dir);
  const file = path.join(abs, SCAFFOLD_MANIFEST_FILE);
  const nothing = { claims: [], stale: [], unverifiable: [], trustworthy: false, movedVaultSuspected: false };
  if (!fsLike.exists(file)) {
    return {
      status: "absent",
      ...nothing,
      advice: `no manifest at ${file} — this tool did not scaffold this directory, so its state has to be probed`,
    };
  }
  const raw = fsLike.read(file);
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return { status: "unreadable", ...nothing, advice: `${file} exists but is not JSON this tool wrote — probe instead` };
  }
  const m = parsed as Partial<ScaffoldManifest>;
  if (m.tool !== "ost-agent" || m.version !== SCAFFOLD_MANIFEST_VERSION || !Array.isArray(m.claims)) {
    return {
      status: "foreign",
      ...nothing,
      advice: `${file} is a manifest this tool does not recognise (tool=${String(m.tool)}, version=${String(m.version)}) — probe instead`,
    };
  }
  return verifyScaffoldManifest(m as ScaffoldManifest, abs, fsLike);
}

/**
 * The claims a manifest saves a reader anything on — the ones whose probe is not already
 * a single `existsSync`.
 *
 * Published as a function rather than left implicit because it is the candidate's own
 * economic claim, measured: "the writer pays once and every reader benefits" is only true
 * for the claims in this list.
 */
export function claimsWorthReading(manifest: ScaffoldManifest): ClaimId[] {
  return manifest.claims.filter((c) => c.probeCost !== "stat").map((c) => c.id);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 2 — the census
// ════════════════════════════════════════════════════════════════════════════

/**
 * What "a directory this tool actually scaffolded" is allowed to mean.
 *
 * The same two readings `src/runner/scaffold-init.ts` pins, kept identical on purpose:
 * two censuses over the same corpus disagreeing about what "tool-created" means would be
 * a bug in one of them rather than a finding in either.
 */
export type ScaffoldReading = "scaffolder" | "any-agent-tool";

/**
 * Which failures the threshold is taken over.
 *
 * The node says "the four captured exit-128 failures". The record holds six, in four
 * directories, and two of the six are in no node's list. Both cuts are counted because a
 * threshold of "3 of 4" is not even well-formed against a record of 6, and choosing
 * silently would be choosing the answer.
 */
export type FailureCut = "node-cut" | "whole-record";

/** The bar, and every term it turns on, fixed before a row was counted. */
export const SCAFFOLD_MANIFEST_RULE = {
  /** The assumption test's threshold, in its own words: at least 3 of the 4 captured failures. */
  minCovered: 3,
  ofFailures: 4,

  /** The cut the threshold's denominator names. */
  cut: "node-cut" as FailureCut,

  /** The reading the bar is decided on. The generous one is published beside it. */
  bar: "scaffolder" as ScaffoldReading,

  readings: {
    scaffolder:
      "scaffolded by this tool — the record shows `ost-agent init` pointed at this directory. " +
      "This is the only reading under which a manifest would be on disk to read.",
    "any-agent-tool":
      "brought into being by any tool call in the record — a Write to a file inside it, a mkdir, a git worktree add. " +
      "Generous: it credits the candidate with directories no scaffolder has ever run in, and so with directories " +
      "that would carry no manifest.",
  } as Record<ScaffoldReading, string>,

  cuts: {
    "node-cut": "the four sessions the solution node cites, and only those",
    "whole-record": "every uninitialised-repository failure in the record — six, in four directories",
  } as Record<FailureCut, string>,

  /**
   * The constraint a coverage count cannot express on its own, and the reason the
   * generous reading does not rescue this candidate.
   *
   * A manifest is a file the scaffolder writes. Where no scaffolder ran there is no file,
   * whatever else created the directory. So a failure counted as "covered" under
   * `any-agent-tool` but not under `scaffolder` is a failure this mechanism would have
   * been absent for.
   */
  manifestExistsOnlyWhereScaffolderRan: true,

  /** Identical to the sibling census's, and imported rather than restated. */
  failureSignature: SCAFFOLD_INIT_RULE.failureSignature,
} as const;

/** One directory the captured failures happened in. */
export interface ManifestDirectoryRow {
  dir: string;
  /** Failures in this directory, on the whole-record cut. */
  failures: number;
  /** …and on the node's own four cited sessions. */
  failuresInNodeCut: number;
  sessions: string[];
  /** Did this tool's scaffolder make it? Decides the bar. */
  byScaffolder: boolean;
  /** Did anything in the record make it? Decides the generous reading. */
  byAnyTool: boolean;
  /** What the record says created it. */
  evidence: CreationEvidence;
  /** True exactly when a manifest would have been on disk here. Equals `byScaffolder`. */
  manifestWouldExist: boolean;
}

/** One of the four (cut × reading) counts. */
export interface CoverageCount {
  cut: FailureCut;
  reading: ScaffoldReading;
  failures: number;
  covered: number;
  /** Covered failures where a manifest would actually have been on disk. */
  coveredWithAManifest: number;
  meetsThreshold: boolean;
}

export interface ScaffoldManifestCensus {
  headline: {
    cut: FailureCut;
    reading: ScaffoldReading;
    failures: number;
    covered: number;
    threshold: number;
    /** The verdict. Read this with the exit code; the exit code is not the verdict. */
    meetsBar: boolean;
  };
  /** All four counts — both cuts, both readings. */
  counts: CoverageCount[];
  byDirectory: ManifestDirectoryRow[];
  /**
   * The counts that clear the threshold **and** clear it on failures where no manifest
   * would have existed. Non-empty here is the finding, not a partial success.
   */
  clearsWithoutAManifest: CoverageCount[];
  /** The node's cited sessions against the record's. */
  citedVersusFound: { cited: string[]; found: string[]; uncited: string[] };
  /** Failures whose directory the record does not name. */
  directoryUnknown: number;
  /**
   * Directories whose creator cannot be established because the transcript is gone.
   * Counted as not-scaffolded on both readings, and named so the "no" can be priced.
   */
  creatorUnknown: string[];
}

export function scaffoldManifestCoverage(
  failures: UninitialisedRepoFailure[],
  evidence: CreationEvidence[],
  opts: { citedSessions: string[] },
): ScaffoldManifestCensus {
  const cited = new Set(opts.citedSessions);
  const byDir = new Map<string, UninitialisedRepoFailure[]>();
  let directoryUnknown = 0;
  for (const f of failures) {
    if (f.dir === null) {
      directoryUnknown++;
      continue;
    }
    const rows = byDir.get(f.dir) ?? [];
    rows.push(f);
    byDir.set(f.dir, rows);
  }

  const evidenceFor = new Map(evidence.map((e) => [e.dir, e]));
  const byDirectory: ManifestDirectoryRow[] = [...byDir.entries()]
    // Codepoint order, not `localeCompare`: ICU collation folds case and would reorder
    // `/Users/…` against `/tmp/…` depending on the machine's locale, which would make a
    // committed expectation in the spec a fact about the runner rather than about the corpus.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, rows]) => {
      const ev = evidenceFor.get(dir) ?? { dir, creator: null, byScaffolder: false, absent: "no-creating-call-found" as const };
      return {
        dir,
        failures: rows.length,
        failuresInNodeCut: rows.filter((r) => cited.has(r.session)).length,
        sessions: [...new Set(rows.map((r) => r.session))].sort(),
        byScaffolder: ev.byScaffolder,
        byAnyTool: ev.creator !== null,
        evidence: ev,
        // Not a second fact: a manifest exists exactly where the scaffolder ran. Named
        // separately so the report can say it in the reader's terms.
        manifestWouldExist: ev.byScaffolder,
      };
    });

  const nFailures = (cut: FailureCut, pick: (row: ManifestDirectoryRow) => boolean): number =>
    byDirectory.filter(pick).reduce((n, row) => n + (cut === "node-cut" ? row.failuresInNodeCut : row.failures), 0);

  const counts: CoverageCount[] = [];
  for (const cut of ["node-cut", "whole-record"] as FailureCut[]) {
    for (const reading of ["scaffolder", "any-agent-tool"] as ScaffoldReading[]) {
      const covered = nFailures(cut, (r) => (reading === "scaffolder" ? r.byScaffolder : r.byAnyTool));
      counts.push({
        cut,
        reading,
        failures: nFailures(cut, () => true),
        covered,
        coveredWithAManifest: nFailures(cut, (r) => (reading === "scaffolder" ? r.byScaffolder : r.byAnyTool) && r.manifestWouldExist),
        meetsThreshold: covered >= SCAFFOLD_MANIFEST_RULE.minCovered,
      });
    }
  }

  const headlineCount = counts.find((c) => c.cut === SCAFFOLD_MANIFEST_RULE.cut && c.reading === SCAFFOLD_MANIFEST_RULE.bar) as CoverageCount;
  const found = [...new Set(failures.map((f) => f.session))].sort();

  return {
    headline: {
      cut: SCAFFOLD_MANIFEST_RULE.cut,
      reading: SCAFFOLD_MANIFEST_RULE.bar,
      failures: headlineCount.failures,
      covered: headlineCount.covered,
      threshold: SCAFFOLD_MANIFEST_RULE.minCovered,
      meetsBar: headlineCount.meetsThreshold,
    },
    counts,
    byDirectory,
    clearsWithoutAManifest: counts.filter((c) => c.meetsThreshold && c.coveredWithAManifest < SCAFFOLD_MANIFEST_RULE.minCovered),
    citedVersusFound: { cited: [...opts.citedSessions].sort(), found, uncited: found.filter((s) => !cited.has(s)) },
    directoryUnknown,
    creatorUnknown: byDirectory.filter((r) => r.evidence.absent === "transcript-gone").map((r) => r.dir),
  };
}

// ── the report ───────────────────────────────────────────────────────────────

export function formatScaffoldManifestCensus(census: ScaffoldManifestCensus): string {
  const h = census.headline;
  const lines: string[] = [];
  lines.push(
    `Scaffold-manifest coverage: ${h.meetsBar ? "MET" : "REFUTED"} — ${h.covered} of ${h.failures} captured failure(s) ` +
      `happened in a directory this tool scaffolded, against a pre-committed threshold of ${h.threshold}.`,
  );
  lines.push("");
  lines.push("Every cut against every reading, because the node fixed neither:");
  for (const c of census.counts) {
    const bar = c.cut === SCAFFOLD_MANIFEST_RULE.cut && c.reading === SCAFFOLD_MANIFEST_RULE.bar;
    lines.push(
      `  ${bar ? "[bar]     " : "[reading] "} ${c.cut} × ${c.reading}: ${c.covered}/${c.failures} ` +
        `— ${c.meetsThreshold ? "clears" : "does not clear"} ${SCAFFOLD_MANIFEST_RULE.minCovered}` +
        (c.covered > c.coveredWithAManifest ? `, but only ${c.coveredWithAManifest} of those would have carried a manifest` : ""),
    );
  }
  lines.push("");
  for (const row of census.byDirectory) {
    const creator = row.evidence.creator
      ? `${row.evidence.creator.tool}: ${row.evidence.creator.command}`
      : `no creating call in the record (${row.evidence.absent})`;
    lines.push(`  ${row.dir} — ${row.failures} failure(s), ${row.failuresInNodeCut} of them in the node's four`);
    lines.push(`      created by: ${creator}`);
    lines.push(`      manifest would exist here: ${row.manifestWouldExist ? "yes" : "NO — no scaffolder ever ran here"}`);
  }
  if (census.clearsWithoutAManifest.length > 0) {
    lines.push("");
    lines.push(
      `${census.clearsWithoutAManifest.length} reading(s) clear the threshold on failures where NO MANIFEST WOULD HAVE EXISTED: ` +
        `${census.clearsWithoutAManifest.map((c) => `${c.cut} × ${c.reading}`).join("; ")}. ` +
        `A bar met by counting directories the mechanism cannot reach is not a bar met.`,
    );
  }
  lines.push("");
  lines.push(
    `The node cited ${census.citedVersusFound.cited.length} session(s); the record holds ` +
      `${census.citedVersusFound.found.length}. Uncited: ${census.citedVersusFound.uncited.join(", ") || "none"}.`,
  );
  if (census.creatorUnknown.length > 0) {
    lines.push(
      `${census.creatorUnknown.length} directory(ies) have no establishable creator because the transcript is gone ` +
        `(${census.creatorUnknown.join(", ")}); they count as not-scaffolded, which is the reading that runs against this candidate.`,
    );
  }
  return lines.join("\n");
}
