/**
 * Cut the friction-surface corpus out of a vault's own git history.
 *
 * Run by hand, output committed under `test/fixtures/friction-surface-rule/`. The
 * replay in `test/telemetry/friction-surface-rule.test.ts` scores the surface rule
 * against a judgement a pass made on 2026-08-02, and that judgement is only worth
 * scoring against if the corpus is exactly what the pass was looking at. So the
 * cut is taken **at a git revision**, not off the live vault: the vault has since
 * grown to hundreds of evidence records and "the 29" would otherwise be a number
 * nobody could reproduce.
 *
 *   npx tsx scripts/harvest-friction-surface-corpus.ts \
 *     /Users/tanner/ost-agent-meta test/fixtures/friction-surface-rule 32a44d74
 *
 * The revision defaults to the commit that created the parent opportunity, which
 * is the pass's own commit and therefore the only defensible snapshot: the pass
 * read what was unmapped at the moment it wrote its census.
 *
 * **Harvested records only.** `INBOX_*` evidence is written by a human dropping a
 * note in a folder, and the rule under test filters a *machine* channel. Including
 * inbox notes would put the operator's own prose into a count of the agent's
 * friction and inflate both sides of the score.
 *
 * The judgement is NOT cut by this script. It is transcribed by hand from the
 * census the pass wrote, and lives in `judgement.json` — see PROVENANCE.md for
 * where its 29th row came from, since the census prose accounts for 28.
 *
 * Nothing here is imported by src/. The fixture is the artefact.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The commit that created "The friction channel fills with my own typos…". */
const DEFAULT_REV = "32a44d74";

const EVIDENCE_DIR = ".ost-agent/evidence";

/** Only the two machine harvests. See the module comment on `INBOX_*`. */
const HARVESTED = /^(TRANSCRIPT|USAGE)_/;

function git(vault: string, args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function main(): void {
  const [vault, outDir, rev = DEFAULT_REV] = process.argv.slice(2);
  if (!vault || !outDir) {
    console.error("usage: harvest-friction-surface-corpus.ts <vault> <out-dir> [rev]");
    process.exit(2);
  }

  const listed = git(vault, ["ls-tree", "--name-only", rev, `${EVIDENCE_DIR}/`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => HARVESTED.test(path.basename(file)));

  const recordsDir = path.join(outDir, "records");
  fs.mkdirSync(recordsDir, { recursive: true });

  for (const file of listed) {
    fs.writeFileSync(path.join(recordsDir, path.basename(file)), git(vault, ["show", `${rev}:${file}`]));
  }

  const resolved = git(vault, ["rev-parse", rev]).trim();
  const dated = git(vault, ["log", "-1", "--format=%cI", rev]).trim();
  fs.writeFileSync(
    path.join(outDir, "corpus.json"),
    `${JSON.stringify(
      {
        vault: path.resolve(vault),
        rev: resolved,
        revCommittedAt: dated,
        evidenceDir: EVIDENCE_DIR,
        records: listed.length,
        transcripts: listed.filter((f) => path.basename(f).startsWith("TRANSCRIPT_")).length,
        usage: listed.filter((f) => path.basename(f).startsWith("USAGE_")).length,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`${listed.length} record(s) → ${recordsDir}`);
}

main();
