/**
 * Replay the seven refusals and check the ledger surfaces every one before a call
 * is composed.
 *
 * The assumption under test is feasibility, not persuasion: **can a correction be
 * stored in a form a later session actually receives?** Not that it will be obeyed.
 * The corpus is the seven machine-captured sessions that hit the identical
 * `Blocked: sleep …` refusal across four days — `test/fixtures/corrections/
 * PROVENANCE.md` records exactly what was cut and what was left behind.
 *
 * **One thing here does not match the node it was built from, and it is recorded
 * rather than smoothed over.** The assumption test's threshold says "all seven
 * observed refusal *classes*". The corpus does not contain seven classes. It
 * contains seven *sessions* carrying eight sightings of ONE class, which is what
 * the opportunity node says in the first place ("Seven sessions across four days
 * show the identical refusal") and what the test's own design paragraph asks for
 * ("Assert the ledger holds each distinct refusal class exactly once —
 * deduplicated, since seven copies of the same correction is the failure it was
 * built to fix"). Those two sentences cannot both be satisfied: deduplicating one
 * class seven times yields one entry, not seven. This file measures the design
 * paragraph, because it is the one the evidence supports — and it asserts the seven
 * sessions explicitly, so the count the threshold was reaching for is still pinned.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  correctionId,
  extractRefusals,
  foldSightings,
  emptyCorrectionsLedger,
  ledgerPath,
  MAX_CORRECTIONS,
  readLedger,
  readPermittedForm,
  recordCorrections,
  renderCorrections,
  type RefusalSighting,
} from "../../src/loop/corrections.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const CORPUS = path.resolve(__dirname, "../fixtures/corrections");

/**
 * The seven sessions the opportunity node names, by the prefix it names them with.
 * Hard-coded rather than globbed: the claim is about these seven, and a corpus that
 * silently lost one must fail here rather than quietly measure six.
 */
const SEVEN = ["470cb94a", "4ff7b605", "995b8ab1", "a0eb3fd4", "97546e2f", "516fdfb8", "87a025f8"];

/** The remedy the sleep guard names — the correction all seven sessions were given. */
const SLEEP_REMEDY_MARKER = "use Monitor with an until-loop";

function corpusFiles(): string[] {
  return fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => path.join(CORPUS, f));
}

function replayCorpus(): RefusalSighting[] {
  return corpusFiles().flatMap((f) =>
    extractRefusals(fs.readFileSync(f, "utf8"), path.basename(f, ".jsonl")),
  );
}

let state: string;

beforeEach(() => {
  state = fs.mkdtempSync(path.join(os.tmpdir(), "ost-corrections-"));
});
afterEach(() => fs.rmSync(state, { recursive: true, force: true }));

describe("the corpus is the seven sessions the node names", () => {
  test("all seven transcripts are present", () => {
    const names = corpusFiles().map((f) => path.basename(f));
    for (const id of SEVEN) {
      expect(names.some((n) => n.startsWith(id)), `session ${id} is missing from the corpus`).toBe(true);
    }
    expect(names).toHaveLength(SEVEN.length);
  });

  test("every one of them carries the sleep refusal — that is what makes it the corpus", () => {
    for (const id of SEVEN) {
      const file = corpusFiles().find((f) => path.basename(f).startsWith(id));
      const sightings = extractRefusals(fs.readFileSync(file!, "utf8"), id);
      expect(
        sightings.some((s) => s.permitted.includes(SLEEP_REMEDY_MARKER)),
        `session ${id} does not carry the refusal the node says all seven carry`,
      ).toBe(true);
    }
  });
});

describe("replaying the seven refusals through the ledger writer", () => {
  test("the correction all seven were given is in the ledger exactly once", () => {
    const sightings = replayCorpus();
    const sleepSightings = sightings.filter((s) => s.permitted.includes(SLEEP_REMEDY_MARKER));
    // Eight, not seven: 470cb94a hit it twice. The point of the ledger is that the
    // number of entries does not track the number of times it was paid for.
    expect(sleepSightings.length).toBeGreaterThan(SEVEN.length);

    const ledger = foldSightings(emptyCorrectionsLedger(), sightings);
    const entries = ledger.corrections.filter((c) => c.permitted.includes(SLEEP_REMEDY_MARKER));
    expect(entries).toHaveLength(1);
    expect(entries[0].occurrences).toBe(sleepSightings.length);
    expect(entries[0].sessions).toHaveLength(SEVEN.length);
  });

  test("each distinct correction appears exactly once", () => {
    const ledger = foldSightings(emptyCorrectionsLedger(), replayCorpus());
    const permitted = ledger.corrections.map((c) => c.permitted);
    expect(new Set(permitted).size).toBe(permitted.length);
    const ids = ledger.corrections.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every entry carries the permitted form the guard named", () => {
    const ledger = foldSightings(emptyCorrectionsLedger(), replayCorpus());
    expect(ledger.corrections.length).toBeGreaterThan(0);
    for (const c of ledger.corrections) {
      expect(c.permitted.length).toBeGreaterThan(0);
      // The identity is the remedy, so the id has to derive from it and nothing else.
      expect(c.id).toBe(correctionId(c.permitted));
    }
    const sleep = ledger.corrections.find((c) => c.permitted.includes(SLEEP_REMEDY_MARKER))!;
    // Both halves of what the guard actually offered, not a paraphrase of one.
    expect(sleep.permitted).toContain("run_in_background");
    expect(sleep.permitted).toContain("Do not chain shorter sleeps");
  });

  test("a failure that named no alternative is not recorded as a correction", () => {
    // `String to replace not found in file.` is a call the world disagreed with,
    // not a shape the surface rejected. There is nothing for a later session to do
    // differently, so an entry for it would be length the reader pays for and gets
    // nothing back from. The corpus contains several; none may reach the ledger.
    const ledger = foldSightings(emptyCorrectionsLedger(), replayCorpus());
    for (const c of ledger.corrections) {
      expect(c.permitted).not.toContain("String to replace not found");
      expect(c.permitted).not.toContain("old_string and new_string are exactly the same");
    }
  });

  test("a guard quoting the caller's own prose back at them is not a permitted form", () => {
    /*
     * The regression that produced this test, from the real corpus. `Edit`'s
     * not-found error echoes the whole `old_string`, and one of those strings was a
     * source comment containing "the default genome must not pay for a ledger
     * walk". A remedy detector that scanned the message for a cue anywhere read
     * that comment as the guard's advice and filed it as a correction. A permitted
     * form has to be the guard's closing words, not something it is quoting.
     */
    const quoted =
      "<tool_use_error>String to replace not found in file.\nString:   // Lazily, and only where it is read:\n" +
      "  // the default genome must not pay for a ledger walk on every call.\n" +
      `${"  const x = 1;\n".repeat(40)}</tool_use_error>`;
    expect(readPermittedForm(quoted)).toBeNull();
  });
});

describe("the ledger is durable, and folding the same corpus twice changes nothing", () => {
  test("recording writes a ledger the next process can read", () => {
    const result = recordCorrections(state, CORPUS, { quietMinutes: 0 });
    expect(result.readable).toBe(true);
    expect(fs.existsSync(ledgerPath(state))).toBe(true);

    const reread = readLedger(state);
    expect(reread.harvested.sort()).toEqual(corpusFiles().map((f) => path.basename(f, ".jsonl")).sort());
    expect(reread.corrections.length).toBeGreaterThan(0);
    expect(reread.corrections.some((c) => c.permitted.includes(SLEEP_REMEDY_MARKER))).toBe(true);
  });

  test("a second harvest of the same sessions adds nothing and double-counts nothing", () => {
    const first = recordCorrections(state, CORPUS, { quietMinutes: 0 });
    const second = recordCorrections(state, CORPUS, { quietMinutes: 0 });
    if (!first.readable || !second.readable) throw new Error("the corpus should be readable");

    expect(second.sessions).toEqual([]);
    expect(second.added).toBe(0);
    expect(second.ledger.corrections).toEqual(first.ledger.corrections);
  });

  test("a session still being written to is not harvested — a correction has to outlive its session", () => {
    // Everything in the corpus is "live" under the default quiet window, because a
    // fresh checkout stamps every fixture with today's mtime. That is the same
    // guard `TranscriptSource` applies, and it is why a session never receives its
    // own corrections.
    const result = recordCorrections(state, CORPUS, { quietMinutes: 30, now: Date.now() });
    if (!result.readable) throw new Error("the corpus should be readable");
    expect(result.sessions).toEqual([]);
    expect(result.ledger.corrections).toEqual([]);
  });

  test("an unreachable transcript directory is reported, and does not lose what is already recorded", () => {
    recordCorrections(state, CORPUS, { quietMinutes: 0 });
    const before = readLedger(state).corrections;

    const result = recordCorrections(state, path.join(state, "no-such-dir"), { quietMinutes: 0 });
    expect(result.readable).toBe(false);
    expect(readLedger(state).corrections).toEqual(before);
  });

  test("the ledger is capped, and says how much it dropped rather than truncating in silence", () => {
    const many: RefusalSighting[] = Array.from({ length: MAX_CORRECTIONS + 4 }, (_, i) => ({
      session: `s${i}`,
      attempted: `call ${i}`,
      permitted: `Use form number ${i} instead.`,
      at: `2026-08-0${(i % 9) + 1}T00:00:0${i % 10}.000Z`,
    }));
    const ledger = foldSightings(emptyCorrectionsLedger(), many);
    expect(ledger.corrections).toHaveLength(MAX_CORRECTIONS);
    expect(ledger.dropped).toBe(4);
    expect(renderCorrections(ledger)).toContain("4 older correction(s) have fallen off");
  });
});

describe("delivery: every correction reaches a session before it composes its first call", () => {
  test("the rendered briefing carries all seven sessions' corrections", () => {
    recordCorrections(state, CORPUS, { quietMinutes: 0 });
    const ledger = readLedger(state);
    const text = renderCorrections(ledger);

    // Every entry in the ledger is in the text handed over. A briefing that holds
    // back an entry is the storage failure again, one layer further along.
    for (const c of ledger.corrections) expect(text).toContain(c.permitted);
    expect(text).toContain(SLEEP_REMEDY_MARKER);
    // And it says what it cost, because "seven sessions already paid for this" is
    // the only argument the ledger has against a reflex.
    expect(text).toMatch(new RegExp(`across ${SEVEN.length} sessions`));
  });

  test("an empty ledger says so rather than rendering nothing", () => {
    const text = renderCorrections(emptyCorrectionsLedger());
    expect(text).toContain("none recorded");
  });

  test("`ost-agent corrections` harvests and prints the ledger on stdout", () => {
    const r = spawnSync(TSX, [CLI, "corrections", "--state", state, "--sessions", CORPUS, "--quiet-minutes", "0"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(0);
    // stdout is the briefing and nothing else — a wrapper pipes it into a prompt.
    expect(r.stdout).toContain(SLEEP_REMEDY_MARKER);
    expect(r.stdout).toContain("read before composing a call");
    // The harvest note goes to stderr so it cannot land inside that prompt.
    expect(r.stderr).toContain("harvested");
    expect(fs.existsSync(ledgerPath(state))).toBe(true);
  });

  test("a workspace with no ledger yet still prints a briefing and exits 0", () => {
    const r = spawnSync(TSX, [CLI, "corrections", "--state", state, "--no-record"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("none recorded");
  });

  test("a vault loop's ledger lands under .git, where `git add -A` can never sweep it", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-corrections-vault-"));
    try {
      const git = (...a: string[]) =>
        execFileSync("git", a, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      fs.writeFileSync(path.join(vault, "Root.md"), "# Root\n");
      git("add", "-A");
      git("commit", "-qm", "root");

      const r = spawnSync(TSX, [CLI, "corrections", "--vault", vault, "--sessions", CORPUS, "--quiet-minutes", "0"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(SLEEP_REMEDY_MARKER);
      expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "corrections.json"))).toBe(true);
      // The working tree the next auto-committing tool sees must still be clean.
      expect(git("status", "--porcelain").trim()).toBe("");
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  test("the unattended wrappers read the ledger into the prompt BEFORE the pass composes", () => {
    /*
     * The property the threshold names — "surfaced to a session before it composes
     * its first call" — is a property of the wrappers, not of this module. Nothing
     * in OST-Agent calls the model; Claude Code does. So the checkable form of the
     * claim is that each wrapper puts `corrections` into the prompt file, and does
     * it upstream of the line that hands that prompt to `claude`.
     *
     * Asserted on the shipped scripts rather than described in prose, on
     * `test/release/examples-allowlist.test.ts`'s precedent: an integration that
     * lives only in a comment is one someone deletes while tidying.
     */
    for (const name of ["autonomous-pass.sh", "build-pass.sh"]) {
      const script = fs.readFileSync(path.resolve(__dirname, "../../examples/automation", name), "utf8");
      const harvest = script.indexOf("corrections");
      expect(harvest, `${name} never reads the corrections ledger`).toBeGreaterThan(-1);
      const invoke = script.search(/^\s*claude -p |^\s+claude -p /m);
      expect(invoke, `${name} does not invoke claude`).toBeGreaterThan(-1);
      expect(harvest, `${name} reads the ledger after composing the call`).toBeLessThan(invoke);
    }
  });
});
