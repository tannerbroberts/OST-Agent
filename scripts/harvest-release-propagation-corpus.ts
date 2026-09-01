/**
 * Re-derive the release-propagation corpus: every version this repository ever
 * cut on `main`, and every version the npm registry ever carried.
 *
 * The assumption test beneath "Resolve the newest published version at pass
 * start and refuse to run silently on a stale one" says the answer is
 * "entirely in git history and the registry's own version list". This script
 * is that sentence, executed — so the two tables in
 * `test/fixtures/release-propagation-lag/corpus.json` can be checked against
 * their sources rather than trusted:
 *
 *   npx tsx scripts/harvest-release-propagation-corpus.ts
 *
 * The cut, in order:
 *   1. `git log -p -- package.json` over the current history, keeping every
 *      commit that ADDS a `"version": "X.Y.Z"` line — that is a version cut,
 *      whether or not anybody remembered to tag it (most were not tagged);
 *   2. the commit's *committer* date, because rebase and squash rewrite it to
 *      when the change landed in this history, which is what "on `main`" means;
 *   3. `GET https://registry.npmjs.org/ost-agent`, whose `time` field is the
 *      registry's own record of when each version became resolvable, plus
 *      `time.unpublished` for the versions it has since withdrawn.
 *
 * Nothing here is imported by `src/` or by a test. The fixture is the artefact,
 * and the test that scores it runs offline against the fixture alone, per
 * CONTRIBUTING.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "test/fixtures/release-propagation-lag");

const PACKAGE_NAME = "ost-agent";

/** Marks a commit header line in `git log -p` output. `%x00` would collide with
 *  nothing, but it also does not survive being read back out of a source file. */
const HEADER = "@@ost-commit@@";

interface Bump {
  version: string;
  commit: string;
  committedAt: string;
  subject: string;
}

/** Every commit that introduced a new `"version"` line into `package.json`,
 *  newest first. A version is recorded at the FIRST commit that added it; a
 *  later commit re-adding the same string (a revert, a merge resolution) is not
 *  a second cut of it. */
function readBumps(): Bump[] {
  const raw = execFileSync(
    "git",
    ["log", `--format=${HEADER}%H\t%cI\t%s`, "-p", "--", "package.json"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const bumps: Bump[] = [];
  const seen = new Set<string>();
  let current: { commit: string; committedAt: string; subject: string } | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith(HEADER)) {
      const [commit, committedAt, ...rest] = line.slice(HEADER.length).split("\t");
      // `%cI` carries whatever UTC offset the committer's machine had.
      // Normalise, so the table reads in one timezone and a reader can subtract
      // two of its instants by eye.
      current = { commit, committedAt: new Date(committedAt).toISOString(), subject: rest.join("\t") };
      continue;
    }
    const added = /^\+\s*"version":\s*"(\d+\.\d+\.\d+)"/.exec(line);
    if (!added || !current) continue;
    const version = added[1];
    if (seen.has(version)) continue;
    seen.add(version);
    bumps.push({ version, ...current });
  }

  return bumps;
}

interface RegistryTime {
  created?: string;
  modified?: string;
  unpublished?: { time: string; versions: string[] };
  [version: string]: unknown;
}

async function readRegistry(): Promise<{ status: number; time: RegistryTime }> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}`);
  const body = (await response.json()) as { time?: RegistryTime };
  return { status: response.status, time: body.time ?? {} };
}

async function main(): Promise<void> {
  const bumps = readBumps();
  const { status, time } = await readRegistry();

  const { created, modified, unpublished, ...published } = time;
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
    private?: boolean;
  };

  const corpus = {
    package: PACKAGE_NAME,
    /** The commit this cut was taken at, so a re-run on a later `main` is a
     *  visibly different corpus rather than a silently different one. */
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    localVersion: packageJson.version,
    localPrivate: packageJson.private === true,
    /** Commits on `main` since the newest instant the registry records — the
     *  size of the gap a pull-at-start instance would be resolving across. */
    commitsSinceLastPublish: 0,
    registry: {
      status,
      created: created ?? null,
      modified: modified ?? null,
      /** version → the instant it became resolvable from the registry. */
      published: Object.fromEntries(Object.entries(published).map(([v, t]) => [v, String(t)])) as Record<
        string,
        string
      >,
      unpublished: unpublished ?? null,
    },
    /** Newest first. */
    bumps,
  };

  const lastPublish = Object.values(corpus.registry.published).sort().at(-1);
  if (lastPublish) {
    corpus.commitsSinceLastPublish = Number(
      execFileSync("git", ["rev-list", "--count", `--since=${lastPublish}`, "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim(),
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`);
  process.stdout.write(
    `${bumps.length} version bump(s) on main, ${Object.keys(corpus.registry.published).length} published to the registry, ` +
      `${corpus.registry.unpublished ? corpus.registry.unpublished.versions.length : 0} since withdrawn, ` +
      `${corpus.commitsSinceLastPublish} commit(s) since the last publish\n`,
  );
}

await main();
