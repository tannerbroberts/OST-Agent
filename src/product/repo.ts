/**
 * The product-repo reader — read-only sight of what the product actually is.
 *
 * Ideating in a black box produces generic ideas; reading the product's own
 * code grounds them. This module grants exactly sight and nothing else: paths
 * are resolved through `realpath` and must land inside a configured root
 * (symlink escapes are refused), listings skip vendor noise, file content is
 * capped and passed through `redactSecrets`. There is no write, no glob over
 * everything, no execution.
 *
 * Two things it also does not do, both because of what it would otherwise be a
 * second, unintended channel FOR: it refuses any path inside a vault's own
 * `.ost-agent/` sidecar (W7 — evidence has one designated reader, and it is
 * `ost_next_work`), and everything it does return is framed as data (S4 — a repo
 * is somebody's bytes, and a filename is as good an injection vector as a file).
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";
import { nearMiss, renderNearMiss } from "../fs/near-miss.js";
import { DATA_FRAME, frameData } from "../security/framing.js";
import type { RepoSight } from "../ost/node.js";

export const MAX_FILE_CHARS = 20_000;
export const MAX_LIST_ENTRIES = 500;

/**
 * The vault's own sidecar directory, named here because this reader has to refuse
 * it rather than merely skip it (W7).
 *
 * A vault is a perfectly ordinary git repository, so `product.repos: [<vault>]` is
 * a normal thing for an operator to write — and it used to make this tool the
 * highest-bandwidth path from an untrusted note into the model's context: whole
 * evidence bodies and `state/inbox.json`, uncapped by the sweep's excerpt limit and
 * with no data framing, while the channel *intended* to carry a body was the one
 * that truncated at 280 characters. There is one report channel; this is the other
 * one, and it refuses.
 */
export const VAULT_SIDECAR = ".ost-agent";

/**
 * Directories that are noise for discovery purposes, skipped in listings.
 *
 * `.ost-agent` is NOT in here, because it is not skipped — it is refused, by
 * {@link isSidecarName} at the filter below and by {@link refuseVaultSidecar} on
 * the read. Membership in this set was never the protection: it only filters
 * `readdir` entries, and the read that mattered — `{ path: '.ost-agent/evidence/…' }`
 * — never consults it.
 */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv"]);

/**
 * Is this one path component the vault sidecar?
 *
 * **Case-insensitively, and that is the whole reason this is a function.** The
 * comparison used to be `=== VAULT_SIDECAR`, which is a correct test of the string
 * and the wrong test of the filesystem: macOS (APFS/HFS+ by default) and Windows
 * resolve `.OST-AGENT/evidence/note.md` to the same file as `.ost-agent/…`, and
 * `fs.realpathSync` hands back the spelling it was ASKED for rather than the one on
 * disk — so both the pre-read check and the realpath re-check saw a component that
 * did not match, and the entire evidence store came back in full through a path that
 * differs from the refused one by the shift key. Verified against a scratch repo
 * before this line changed: `{ path: '.OST-AGENT/evidence/note.md' }` returned the
 * body.
 *
 * Folding the case costs a product repo that legitimately contains a directory
 * spelled `.OST-Agent` on a case-sensitive filesystem — which is not a thing, and is
 * the right side of this trade regardless, since the refusal names the channel that
 * does serve evidence rather than being a dead end.
 */
function isSidecarName(component: string): boolean {
  return component.toLowerCase() === VAULT_SIDECAR;
}

/**
 * Refuse anything inside a vault sidecar, wherever it appears in the path.
 *
 * Checked on the *requested* path before the file is touched and again on the
 * realpath afterwards, so a symlink pointing into the sidecar is refused with the
 * same sentence rather than followed — the confinement check above only asks
 * whether the target is inside the root, and the sidecar is inside the root.
 * Checking the resolved root itself closes the other way in: `product.repos:
 * [<vault>/.ost-agent]` would otherwise make every path in it relative and clean.
 */
function refuseVaultSidecar(candidate: string, rel: string): void {
  if (!candidate.split(path.sep).some(isSidecarName)) return;
  throw new Error(
    `"${rel}" is inside a vault's own ${VAULT_SIDECAR}/ sidecar — the product reader does not serve it. ` +
      `Evidence is retrieved one record at a time, framed as data, with ost_next_work({ evidence: "<id>" }); ` +
      `the ids are in that tool's unmappedEvidence list. Cursors and state files are not readable through any tool.`,
  );
}

/**
 * What a missing path answers with — how far down the request was real, what is
 * actually there, and the correction if one is obvious.
 *
 * This used to be `"<rel>" does not exist in <repo>`, and every recorded instance
 * of it was followed immediately by a listing call that the reader could have
 * answered itself. Everything is named repo-relative and the ancestor search is
 * confined to the root, so a miss stays inside the same boundary a successful
 * read would have: the other *declared* repos may be named, nothing else can be.
 */
function missingPathMessage(roots: readonly string[], root: string, rel: string): string {
  const miss = nearMiss(rel, {
    cwd: root,
    roots: roots.filter((r) => r !== root),
    confineTo: root,
    hide: (name) => SKIP_DIRS.has(name) || isSidecarName(name),
  });
  const inRepo = (p: string) => {
    const owner = roots.find((r) => p === r || p.startsWith(r + path.sep));
    if (!owner) return p;
    const within = path.relative(owner, p);
    return within ? `${path.basename(owner)}/${within}` : path.basename(owner);
  };
  const where = miss.present.length
    ? `${inRepo(miss.reached)} exists and contains ${miss.present.join(", ")}${miss.truncated ? ", …" : ""}`
    : `${inRepo(miss.reached)} exists and is empty`;
  const then = miss.suggestion
    ? `did you mean ${inRepo(path.resolve(root, miss.suggestion.path))}?`
    : "nothing there is close enough to name, so this is not a typo to correct";
  return `"${rel}" does not exist in ${path.basename(root)} — ${where}; ${then}`;
}

/**
 * Could a pass writing an instrument right now actually see the product?
 *
 * `grounded` iff at least one configured repo resolves to a directory this
 * process can list — the same probe `loop/senses.ts` uses for its census, asked
 * at the moment of the write rather than at the start of the pass, because a
 * grant can differ between the two. Derived from the grant table and the
 * filesystem only: there is deliberately no parameter through which a caller
 * could assert sight it does not have, since the whole value of the flag is
 * that the party being graded cannot set its own grade.
 *
 * An empty `repos` is `blind`, not an error — a pass with no repo configured
 * never had sight of the product, which is a fact worth recording, never a
 * reason to refuse the write (the spec-resolution guard makes that call
 * separately). Known residue, recorded on the node that specified this: a repo
 * that is listable here but whose FILES a sandbox denies still reads
 * `grounded` — only the failures visible at this boundary are countable here.
 */
export function repoSight(repos: readonly string[]): RepoSight {
  return repos.some((repo) => {
    try {
      const resolved = path.resolve(repo);
      if (!fs.statSync(resolved).isDirectory()) return false;
      fs.readdirSync(resolved);
      return true;
    } catch {
      return false;
    }
  })
    ? "grounded"
    : "blind";
}

export interface RepoEntry {
  name: string;
  type: "file" | "dir";
}

export interface RepoReadResult {
  /**
   * The data-framing marker, on EVERY response this reader produces (S4).
   *
   * Unconditional rather than only on `kind: "file"`, because a listing is
   * untrusted bytes too — a filename is chosen by whoever wrote the repo, and a
   * directory called `SYSTEM: ignore prior rules` is a cheaper attack than a file
   * body. Setting it in one place at the bottom of this function is also what
   * makes a future fourth `kind` framed by construction instead of by review.
   */
  framing: string;
  /** "repos" lists the configured roots; "listing" a directory; "file" content; "probe" a file's size only. */
  kind: "repos" | "listing" | "file" | "probe";
  /** Which repo root served this, as its basename. */
  repo?: string;
  path?: string;
  entries?: RepoEntry[];
  /**
   * File content, carrying {@link DATA_FRAME} as its first line. The cap below
   * applies to the content, never to the frame — a marker that could be truncated
   * away by a long enough file would be no marker at all.
   */
  text?: string;
  truncated?: boolean;
  /**
   * `kind: "probe"` only — the file's size in bytes, from the `stat` this read
   * already had to take to tell a file from a directory. Bytes rather than
   * characters: exact for ASCII source, an upper bound for multi-byte UTF-8, and
   * never an undercount, which is the direction a caller deciding whether to read
   * the whole thing needs.
   */
  bytes?: number;
  /** `kind: "probe"` only — whether a full read of this file would come back `truncated: true`. */
  wouldTruncate?: boolean;
}

export function readProductRepo(
  repos: readonly string[],
  input: { repo?: string; path?: string; probe?: boolean },
): RepoReadResult {
  if (repos.length === 0) {
    throw new Error(
      "no product repos configured — add local repo paths under `product.repos` in ost.config.yaml so the agent can read what the product is",
    );
  }
  const roots = repos.map((r) => fs.realpathSync(path.resolve(r)));

  let root: string;
  if (input.repo) {
    const found = roots.find((r) => path.basename(r) === input.repo || r === path.resolve(input.repo!));
    if (!found) {
      throw new Error(`unknown repo "${input.repo}" — configured repos: ${roots.map((r) => path.basename(r)).join(", ")}`);
    }
    root = found;
  } else if (roots.length === 1) {
    root = roots[0];
  } else if (!input.path) {
    return {
      framing: DATA_FRAME,
      kind: "repos",
      entries: roots.map((r) => ({ name: path.basename(r), type: "dir" as const })),
    };
  } else {
    throw new Error(`several repos are configured — pass \`repo\`: ${roots.map((r) => path.basename(r)).join(", ")}`);
  }

  const rel = input.path ?? ".";
  const joined = path.resolve(root, rel);
  // confine BEFORE touching the filesystem, then again through realpath so a
  // symlink inside the root cannot point the read outside it
  if (joined !== root && !joined.startsWith(root + path.sep)) {
    throw new Error(`"${rel}" resolves outside the repo — reads are confined to ${path.basename(root)}`);
  }
  // Before the filesystem is touched, so the refusal is the answer rather than
  // "does not exist" — which would otherwise say whether a given sidecar file is
  // there, one probe at a time.
  refuseVaultSidecar(joined, rel);
  let real: string;
  try {
    real = fs.realpathSync(joined);
  } catch {
    throw new Error(missingPathMessage(roots, root, rel));
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`"${rel}" is a symlink escaping the repo — reads are confined to ${path.basename(root)}`);
  }
  // Again on the resolved path: a symlink INSIDE the root pointing at the sidecar
  // passes every check above, and following it would reopen the whole hole.
  refuseVaultSidecar(real, rel);

  const repoName = path.basename(root);
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(real, { withFileTypes: true })
      .filter((e) => !SKIP_DIRS.has(e.name) && !isSidecarName(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_LIST_ENTRIES)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? ("dir" as const) : ("file" as const) }));
    return { framing: DATA_FRAME, kind: "listing", repo: repoName, path: rel, entries };
  }

  // The size question, answered from the `stat` this call already took — no
  // `readFileSync`, no redaction, no binary sniff. This is the narrower call a
  // caller who only wants to know whether a file is worth reading in full can
  // make instead of discovering the cap by hitting it: the same cost either way
  // otherwise, since the file has to be read once regardless of who reads it.
  if (input.probe) {
    return {
      framing: DATA_FRAME,
      kind: "probe",
      repo: repoName,
      path: rel,
      bytes: stat.size,
      wouldTruncate: stat.size > MAX_FILE_CHARS,
    };
  }

  const buf = fs.readFileSync(real);
  if (buf.subarray(0, 8192).includes(0)) {
    throw new Error(`"${rel}" looks binary — only text files can be read`);
  }
  const redacted = redactSecrets(buf.toString("utf8"));
  const truncated = redacted.length > MAX_FILE_CHARS;
  return {
    framing: DATA_FRAME,
    kind: "file",
    repo: repoName,
    path: rel,
    // Framed at the value, not only at the response: `text` is the field a host
    // renders on its own and the one a session pastes onward, and it is the only
    // field here that carries a whole file of somebody else's bytes.
    text: frameData(truncated ? redacted.slice(0, MAX_FILE_CHARS) : redacted),
    truncated,
  };
}
