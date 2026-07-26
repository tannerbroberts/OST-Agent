/**
 * The product-repo reader — read-only sight of what the product actually is.
 *
 * Ideating in a black box produces generic ideas; reading the product's own
 * code grounds them. This module grants exactly sight and nothing else: paths
 * are resolved through `realpath` and must land inside a configured root
 * (symlink escapes are refused), listings skip vendor noise, file content is
 * capped and passed through `redactSecrets`. There is no write, no glob over
 * everything, no execution.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";

export const MAX_FILE_CHARS = 20_000;
export const MAX_LIST_ENTRIES = 500;

/** Directories that are noise for discovery purposes, skipped in listings. */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv"]);

export interface RepoEntry {
  name: string;
  type: "file" | "dir";
}

export interface RepoReadResult {
  /** "repos" lists the configured roots; "listing" a directory; "file" content. */
  kind: "repos" | "listing" | "file";
  /** Which repo root served this, as its basename. */
  repo?: string;
  path?: string;
  entries?: RepoEntry[];
  text?: string;
  truncated?: boolean;
}

export function readProductRepo(repos: readonly string[], input: { repo?: string; path?: string }): RepoReadResult {
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
    return { kind: "repos", entries: roots.map((r) => ({ name: path.basename(r), type: "dir" as const })) };
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
  let real: string;
  try {
    real = fs.realpathSync(joined);
  } catch {
    throw new Error(`"${rel}" does not exist in ${path.basename(root)}`);
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error(`"${rel}" is a symlink escaping the repo — reads are confined to ${path.basename(root)}`);
  }

  const repoName = path.basename(root);
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(real, { withFileTypes: true })
      .filter((e) => !SKIP_DIRS.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_LIST_ENTRIES)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? ("dir" as const) : ("file" as const) }));
    return { kind: "listing", repo: repoName, path: rel, entries };
  }

  const buf = fs.readFileSync(real);
  if (buf.subarray(0, 8192).includes(0)) {
    throw new Error(`"${rel}" looks binary — only text files can be read`);
  }
  const redacted = redactSecrets(buf.toString("utf8"));
  const truncated = redacted.length > MAX_FILE_CHARS;
  return {
    kind: "file",
    repo: repoName,
    path: rel,
    text: truncated ? redacted.slice(0, MAX_FILE_CHARS) : redacted,
    truncated,
  };
}
