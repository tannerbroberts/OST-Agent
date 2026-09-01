/**
 * Capture the machine-written version signals from the last N commits of a vault.
 *
 * Re-runnable, and the commands it stands in for are in PROVENANCE.md. It copies
 * bytes out of git rather than summarising them, so the resolver under test reads
 * what the vault actually held and not this script's opinion of it. Blobs are
 * de-duplicated by content the way git does, which is what keeps a hundred states
 * of a live vault down to a fixture worth committing.
 *
 * What it deliberately does NOT capture: `.ost-agent/NEXT-BUILD.md`, the operator's
 * briefing. A version named in a sentence a person wrote is not a stamp, and a
 * resolver that reads prose is one that will one day read the wrong sentence
 * confidently. That omission is the point of the fixture, not a gap in it.
 *
 * Files over {@link COPY_LIMIT} are recorded rather than copied — the adapter
 * cursors are a megabyte of evidence ids per hundred states and none of it is a
 * version signal. `oversize` keeps each one's path, size and whether its bytes
 * hold a semver-shaped token, which is the only property the test asserts about
 * them; a cursor that ever starts carrying a version breaks that assertion here
 * rather than going unnoticed because the fixture stopped looking.
 *
 *   node test/fixtures/writing-version/capture.mjs <vault-dir> [count]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(process.argv[2] ?? "../../../../ost-agent-meta");
const count = Number(process.argv[3] ?? 100);

const git = (...args) => execFileSync("git", ["-C", vault, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

/** The machine-written state a resolver is allowed to read. */
const wanted = (p) => p.startsWith(".ost-agent/state/") || p === ".ost-agent/health/runs.jsonl";

/** Bytes above this are recorded, not copied. See the header. */
const COPY_LIMIT = 8192;

/** A semver-shaped token anywhere in the bytes — the loosest possible version signal. */
const SEMVER = /\b\d+\.\d+\.\d+\b/;

const blobsDir = path.join(here, "blobs");
fs.rmSync(blobsDir, { recursive: true, force: true });
fs.mkdirSync(blobsDir, { recursive: true });

const commits = [];
for (const line of git("log", `-${count}`, "--format=%H|%cI").trim().split("\n")) {
  const [sha, at] = line.split("|");
  const files = {};
  const oversize = [];
  for (const entry of git("ls-tree", "-r", sha, ".ost-agent").trim().split("\n")) {
    if (!entry) continue;
    const [, filePath] = entry.split("\t");
    if (!wanted(filePath)) continue;
    const contents = git("show", `${sha}:${filePath}`);
    if (Buffer.byteLength(contents, "utf8") > COPY_LIMIT) {
      oversize.push({ path: filePath, bytes: Buffer.byteLength(contents, "utf8"), namesAVersion: SEMVER.test(contents) });
      continue;
    }
    const id = createHash("sha256").update(contents).digest("hex").slice(0, 16);
    fs.writeFileSync(path.join(blobsDir, id), contents, "utf8");
    files[filePath] = id;
  }
  commits.push({ sha, at, files, oversize });
}

fs.writeFileSync(path.join(here, "commits.json"), JSON.stringify({ vault: path.basename(vault), commits }, null, 2) + "\n", "utf8");
console.log(`captured ${commits.length} state(s), ${fs.readdirSync(blobsDir).length} unique blob(s)`);
