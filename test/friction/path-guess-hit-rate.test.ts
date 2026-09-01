/**
 * The first-contact path-guess census: of the calls a look-before-you-address
 * guard would have blocked, how many were about to fail anyway?
 *
 * The solution under test is "require a path to have been observed this session
 * before a command may address it" — refuse any call naming a path that has not
 * yet appeared in a listing, a search result or a prior read, and make the run
 * look first. The refusal fires on every first contact, including the ones that
 * would have worked, so the assumption test beneath it fixed the share before
 * anyone counted: **wrong first-contact guesses must be at least 1 in 5 of all
 * first-contact path-taking calls.** Below that the guard costs more turns than it
 * saves and the solution gives way to its cheaper sibling, "a path failure answers
 * with the layout it was addressed against".
 *
 * **The controls are what carry this file.** A replay that called everything
 * first-contact would satisfy every assertion about a corpus that came out high,
 * and one that called nothing first-contact would satisfy every assertion about
 * one that came out low. So the synthetic cases below run first and in both
 * directions: each rule fires on a case built to carry it and fails to fire on one
 * built to look like it and not be it. Only then is the number over the real
 * corpus worth reading.
 *
 * The rule is `GUESS_RULE`, committed in `src/telemetry/path-guess-hit-rate.ts`,
 * including the two judgements it refuses to make alone — which calls the guard
 * governs, and what counts as having looked — each of which is recounted in full
 * rather than chosen. This test asserts the shape of the rule as well as its
 * output, so a later edit shows up here as a changed expectation rather than as a
 * quietly different finding.
 *
 * ## The trap this census exists to avoid
 *
 * Its denominator is **successes**, and this product's distilled friction records
 * hold failures only. Run over `.ost-agent/evidence/TRANSCRIPT_*.md`, the hit rate
 * is 100% by construction and the command passes resoundingly while measuring
 * nothing. The assumption test predicted exactly that, so the refusal is asserted
 * here in both directions before any number is read: a digest throws, and a raw
 * transcript that merely *quotes* a digest does not.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**: 143 wrong guesses out of 17,427 blocked calls — 0.8%,
 * against a bar of 20%. The guard would tax 121 correct addresses for every wrong
 * one it saves. The command is green because the count has been taken and pinned,
 * which is what an instrument on a measurement can mean — the same convention
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/telemetry/preflight-uncertainty-census.test.ts` run under, both of whose
 * censuses also came out refuted and whose nodes are still `#unvalidated`. Whoever
 * reads this exit code must read `census.meetsBar` with it, which is why it is
 * asserted `false` by name below rather than left to be inferred from a share.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  assertNotFailuresOnly,
  assertRawTranscripts,
  commandWords,
  formatPathGuessCensus,
  GUESS_RULE,
  isDiscoveryCall,
  looksLikeFrictionDigest,
  normalizePath,
  pathGuessCensus,
  pathsAddressedBy,
  pathsInCommand,
  pathTokensIn,
  readsAsJsonl,
  readSessionStreams,
  replayGuard,
  type CallEvent,
  type SessionStream,
} from "../../src/telemetry/path-guess-hit-rate.js";
import { readTranscriptSessions } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "path-guess-hit-rate");

function call(over: Partial<CallEvent> = {}): CallEvent {
  return { kind: "call", tool: "Bash", command: "", declaredPath: "", failed: false, error: "", unread: false, ...over };
}

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(GUESS_RULE.bar).toBe(0.2);
  });

  test("both populations are counted in full, so neither choice is hidden", () => {
    expect(GUESS_RULE.populations).toEqual(["declared", "all"]);
  });

  test("a permission denial is not a save, because looking first returns the same denial", () => {
    // The solution node says so itself: "it does not address the failure this pass
    // actually hit — a path that exists and cannot be read for want of a grant".
    expect(GUESS_RULE.savedClasses).not.toContain("denied-path");
    expect(new Set(GUESS_RULE.savedClasses)).toEqual(new Set(["missing-path", "no-matches", "not-a-repo"]));
  });

  test("the declared-path fields are fields, not guesses", () => {
    expect(GUESS_RULE.declaredPathFields).toEqual({
      Read: "file_path",
      Edit: "file_path",
      MultiEdit: "file_path",
      Write: "file_path",
      NotebookEdit: "notebook_path",
    });
  });
});

// ── the trap: the corpus that would answer the question by construction ──────

describe("a distilled friction digest is refused, loudly, before anything is counted", () => {
  const digest = [
    "---",
    "id: 'TRANSCRIPT:005ca37f-b0fc-4ddf-b8b6-971bc90384e1'",
    "source: 'TRANSCRIPT:005ca37f-b0fc-4ddf-b8b6-971bc90384e1'",
    "actor: transcript",
    "---",
    "Session `005ca37f` produced 10 friction events (tool_error ×8, retry ×2).",
    "- **tool_error** (Bash): Exit code 1 … ls: docs/reference: No such file or directory",
  ].join("\n");

  test("it is recognised by its shape and refused by name", () => {
    expect(looksLikeFrictionDigest(digest)).toBe(true);
    expect(() => assertRawTranscripts([{ id: "TRANSCRIPT_x", jsonl: digest }])).toThrow(
      /distilled friction digest.*100% by construction/s,
    );
  });

  test("a raw transcript that merely QUOTES a digest is still a raw transcript", () => {
    // Not hypothetical, and the reason the marker alone is not the test: the
    // sessions that WROTE those digests are in this corpus, and the first cut of
    // this census threw away 1 of 1,216 real transcripts for containing the words
    // it was told to look for.
    const quoting = [
      JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "wrote source: 'TRANSCRIPT:005ca37f'" }] } }),
      JSON.stringify({ message: { role: "user", content: [{ type: "text", text: "it produced 10 friction events" }] } }),
    ].join("\n");
    expect(readsAsJsonl(quoting)).toBe(true);
    expect(looksLikeFrictionDigest(quoting)).toBe(false);
    expect(() => assertRawTranscripts([{ id: "s", jsonl: quoting }])).not.toThrow();
  });

  test("an empty corpus is zero sessions, not a digest", () => {
    expect(readsAsJsonl("")).toBe(true);
    expect(() => assertRawTranscripts([{ id: "s", jsonl: "" }])).not.toThrow();
  });
});

describe("a failures-only corpus is refused even when it does not announce itself", () => {
  test("no successful path-taking call anywhere is the signature, and it throws", () => {
    // The shape a reader would reach for first — the sibling census's
    // `failures.jsonl` — carries no successes, so the hit rate over it is 100%.
    const failuresOnly: SessionStream[] = [
      { session: "a", events: [call({ command: "sed -n 1p src/a.ts", failed: true, error: "sed: src/a.ts: No such file or directory" })] },
      { session: "b", events: [call({ tool: "Read", declaredPath: "/x/b.ts", failed: true, error: "File does not exist." })] },
    ];
    expect(() => assertNotFailuresOnly(failuresOnly)).toThrow(/not one of them succeeded.*100% by construction/s);
    expect(() => pathGuessCensus(failuresOnly, { sessionsRead: 2, calls: 2 })).toThrow(/failures-only/);
  });

  test("one success is enough to make it a corpus rather than a friction record", () => {
    const mixed: SessionStream[] = [
      { session: "a", events: [call({ command: "sed -n 1p src/a.ts", failed: true, error: "sed: src/a.ts: No such file or directory" })] },
      { session: "b", events: [call({ tool: "Read", declaredPath: "/x/b.ts" })] },
    ];
    expect(() => assertNotFailuresOnly(mixed)).not.toThrow();
    expect(pathGuessCensus(mixed, { sessionsRead: 2, calls: 2 }).primary.firstContact).toBe(2);
  });

  test("a corpus with no path-taking call at all is empty, not a fraud", () => {
    // Zero of zero is not 100%. The guard must not fire on a corpus that simply
    // has nothing to say.
    const none: SessionStream[] = [{ session: "a", events: [call({ tool: "WebSearch" })] }];
    expect(() => assertNotFailuresOnly(none)).not.toThrow();
    expect(pathGuessCensus(none, { sessionsRead: 1, calls: 1 }).primary.hitRate).toBeNull();
  });
});

// ── what the guard would govern: each rule fires, and does not overfire ──────

describe("a path named in a declared field is the path, with nothing parsed", () => {
  test("the field is read for every tool that has one", () => {
    expect(pathsAddressedBy(call({ tool: "Read", declaredPath: "/repo/src/a.ts" }), "declared")).toEqual(["/repo/src/a.ts"]);
    expect(pathsAddressedBy(call({ tool: "Write", declaredPath: "/repo/b.md" }), "all")).toEqual(["/repo/b.md"]);
  });

  test("a tool with no path field addresses nothing, whatever else it carries", () => {
    expect(pathsAddressedBy(call({ tool: "WebFetch", command: "https://example.com/a/b" }), "all")).toEqual([]);
    expect(pathsAddressedBy(call({ tool: "mcp__ost-agent__ost_read_tree" }), "all")).toEqual([]);
  });

  test("the narrow population declines to parse a shell command at all", () => {
    const bash = call({ command: "sed -n '1,5p' src/cli/index.ts" });
    expect(pathsAddressedBy(bash, "declared")).toEqual([]);
    expect(pathsAddressedBy(bash, "all")).toEqual(["src/cli/index.ts"]);
  });
});

describe("a path inside a shell command", () => {
  test("the ordinary case, with quoting honoured", () => {
    expect(pathsInCommand(`sed -n '1,5p' "src/cli/index.ts"`)).toEqual(["src/cli/index.ts"]);
    expect(commandWords(`grep -n "a b" src/x.ts`)).toEqual(["grep", "-n", "a b", "src/x.ts"]);
  });

  test("`~` is expanded, because a listing prints the expansion", () => {
    expect(pathsInCommand("cat ~/dev/OST-Agent/package.json")).toEqual(["/Users/tanner/dev/OST-Agent/package.json"]);
  });

  test("every path in a compound command is addressed, not only the first", () => {
    expect(pathsInCommand("cp src/a.ts src/b.ts && rm docs/old.md")).toEqual(["src/a.ts", "src/b.ts", "docs/old.md"]);
  });

  test("a bare filename with a real extension counts; a bare word does not", () => {
    expect(pathsInCommand("node build.mjs")).toEqual(["build.mjs"]);
    expect(pathsInCommand("npm run bundle")).toEqual([]);
  });
});

describe("a shell word that looks like a path and is not one", () => {
  test("a flag is not a path, however many separators it carries", () => {
    expect(pathsInCommand("git log --pretty=format:%h/%s")).toEqual([]);
  });

  test("a URL is not a path", () => {
    expect(pathsInCommand("curl -s https://api.github.com/repos/x/y")).toEqual([]);
  });

  test("a glob addresses a pattern, and the guard as written has nothing to refuse", () => {
    // The exclusion drops calls that were mostly SUCCEEDING from the denominator,
    // which runs toward the answer the solution wants — the direction a judgement
    // this arguable should err in.
    expect(pathsInCommand("ls -d src/**/*.ts")).toEqual([]);
    expect(pathsInCommand("rm /tmp/$SESSION/out.json")).toEqual([]);
  });

  test("a redirection is punctuation, and its file descriptor is not part of the path", () => {
    // `2>/dev/null` is in a large share of this corpus's commands and addresses
    // nothing a run could get wrong. Counting it would pad the denominator with
    // guaranteed successes.
    expect(pathsInCommand("grep -rn x src 2>/dev/null")).toEqual([]);
    expect(pathsInCommand("npx tsc --noEmit > /tmp/out.txt")).toEqual(["/tmp/out.txt"]);
  });

  test("a trailing separator is a spelling, so `ls src/` counts as having looked at `src`", () => {
    expect(pathsInCommand("ls src/")).toEqual(["src"]);
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("docs/reference/")).toBe("docs/reference");
  });
});

describe("a path-shaped token in free text, which is how a listing is read", () => {
  test("separators and known extensions, and nothing else", () => {
    expect(pathTokensIn("total 4\n-rw-r--r--  1 t s  12 src/cli/index.ts")).toContain("src/cli/index.ts");
    expect(pathTokensIn("README.md  package.json")).toEqual(["README.md", "package.json"]);
  });

  test("ordinary prose does not fill the observed set with words", () => {
    expect(pathTokensIn("the run addressed a path that was not there")).toEqual([]);
  });
});

// ── the replay: order, success and the two observation readings ──────────────

describe("the guard's replay over a session it can be checked against by hand", () => {
  const listing = { kind: "observe" as const, tokens: ["src/cli/index.ts"] };

  test("a path nobody has looked at is first contact", () => {
    const blocked = replayGuard([{ session: "s", events: [call({ tool: "Read", declaredPath: "src/cli/index.ts" })] }], "all", "strict");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].unseen).toEqual(["src/cli/index.ts"]);
  });

  test("a path a listing already returned is not", () => {
    const blocked = replayGuard(
      [{ session: "s", events: [listing, call({ tool: "Read", declaredPath: "src/cli/index.ts" })] }],
      "all",
      "strict",
    );
    expect(blocked).toEqual([]);
  });

  test("ORDER is the whole census: the same two events reversed flip the verdict", () => {
    const blocked = replayGuard(
      [{ session: "s", events: [call({ tool: "Read", declaredPath: "src/cli/index.ts" }), listing] }],
      "all",
      "strict",
    );
    expect(blocked).toHaveLength(1);
  });

  test("a call that came back clean leaves the run knowing the path", () => {
    const blocked = replayGuard(
      [
        {
          session: "s",
          events: [call({ tool: "Read", declaredPath: "src/a.ts" }), call({ tool: "Edit", declaredPath: "src/a.ts" })],
        },
      ],
      "all",
      "strict",
    );
    expect(blocked).toHaveLength(1); // the Read, not the Edit
    expect(blocked[0].tool).toBe("Read");
  });

  test("a call that FAILED teaches the run nothing, so the next guess is still a guess", () => {
    const miss = call({ tool: "Read", declaredPath: "src/a.ts", failed: true, error: "File does not exist." });
    const blocked = replayGuard(
      [{ session: "s", events: [miss, call({ tool: "Read", declaredPath: "src/a.ts" })] }],
      "all",
      "strict",
    );
    expect(blocked).toHaveLength(2);
  });

  test("the generous reading lets a listing's basename license the whole path", () => {
    const basenameOnly = { kind: "observe" as const, tokens: ["index.ts"] };
    const events = [basenameOnly, call({ tool: "Read", declaredPath: "src/cli/index.ts" })];
    expect(replayGuard([{ session: "s", events }], "all", "strict")).toHaveLength(1);
    expect(replayGuard([{ session: "s", events }], "all", "generous")).toEqual([]);
  });

  test("a session's observations do not leak into the next session", () => {
    const streams: SessionStream[] = [
      { session: "a", events: [listing, call({ tool: "Read", declaredPath: "src/cli/index.ts" })] },
      { session: "b", events: [call({ tool: "Read", declaredPath: "src/cli/index.ts" })] },
    ];
    const blocked = replayGuard(streams, "all", "strict");
    expect(blocked.map((b) => b.session)).toEqual(["b"]);
  });
});

describe("which blocked calls the guard actually saves", () => {
  test("a failure about the layout is a save", () => {
    const blocked = replayGuard(
      [{ session: "s", events: [call({ command: "sed -n 1p src/gone.ts", failed: true, error: "sed: src/gone.ts: No such file or directory" })] }],
      "all",
      "strict",
    );
    expect(blocked[0].wrongGuess).toBe(true);
    expect(blocked[0].cls).toBe("missing-path");
  });

  test("a failure that has nothing to do with the path is not", () => {
    const blocked = replayGuard(
      [{ session: "s", events: [call({ tool: "Edit", declaredPath: "src/a.ts", failed: true, error: "<tool_use_error>String to replace not found in file.</tool_use_error>" })] }],
      "all",
      "strict",
    );
    expect(blocked[0].failed).toBe(true);
    expect(blocked[0].wrongGuess).toBe(false);
  });

  test("a permission denial is not a save — looking first returns the same denial", () => {
    const blocked = replayGuard(
      [{ session: "s", events: [call({ command: "cat /etc/master.passwd", failed: true, error: "cat: /etc/master.passwd: Permission denied" })] }],
      "all",
      "strict",
    );
    expect(blocked[0].cls).toBe("denied-path");
    expect(blocked[0].wrongGuess).toBe(false);
  });
});

describe("a blocked call that is itself the looking the refusal demands", () => {
  test("the discovery programs are recognised, through a `cd` prefix and an env assignment", () => {
    expect(isDiscoveryCall(call({ command: "ls -la src" }))).toBe(true);
    expect(isDiscoveryCall(call({ command: "cd /repo && find . -name '*.ts'" }))).toBe(true);
    expect(isDiscoveryCall(call({ command: "GIT_PAGER=cat git status" }))).toBe(true);
    expect(isDiscoveryCall(call({ tool: "Grep" }))).toBe(true);
  });

  test("addressing a path is not looking for one", () => {
    expect(isDiscoveryCall(call({ command: "sed -i '' s/a/b/ src/a.ts" }))).toBe(false);
    expect(isDiscoveryCall(call({ tool: "Read", declaredPath: "/repo/a.ts" }))).toBe(false);
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

function committedCorpus(): { streams: SessionStream[]; meta: Record<string, number | string | string[]> } {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, "streams.jsonl.gz"))).toString("utf8");
  const streams = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SessionStream);
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, number>;
  return { streams, meta };
}

describe("the census over the committed corpus", () => {
  const { streams, meta } = committedCorpus();
  const census = pathGuessCensus(streams, {
    sessionsRead: meta.sessionsRead as number,
    calls: meta.calls as number,
  });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.sessionsRead).toBe(1219);
    expect(census.calls).toBe(60472);
    expect(streams).toHaveLength(1219);
    // One call in 60,472 never came back. It is counted FOR the guard, never as a
    // success, and it is reported before any share is.
    expect(census.unread).toBe(1);
  });

  test("dropping irrelevant observation tokens did not change what the replay sees", () => {
    // Written by the harvest script, which alone holds the uncompressed stream.
    // 210,119 tokens down to 60,522, and not one count moved — a token no call
    // ever addresses cannot change any call's verdict.
    expect(meta.observationTokensUnfiltered).toBe(210119);
    expect(meta.observationTokensFiltered).toBe(60522);
    expect(meta.firstContactFiltered).toBe(meta.firstContactUnfiltered);
    expect(meta.wrongGuessesFiltered).toBe(meta.wrongGuessesUnfiltered);
    expect(census.primary.firstContact).toBe(meta.firstContactFiltered);
  });

  test("the guard would have blocked 17,427 calls and waved through 25,685", () => {
    expect(census.primary.population).toBe("all");
    expect(census.primary.observation).toBe("strict");
    expect(census.primary.firstContact).toBe(17427);
    expect(census.primary.observed).toBe(25685);
  });

  test("143 of those 17,427 were about to fail on the layout", () => {
    expect(census.primary.wrongGuesses).toBe(143);
    expect(census.primary.anyFailure).toBe(1022);
    expect(census.primary.hitRate).toBeCloseTo(0.0082, 4);
  });

  test("THE ASSUMPTION IS REFUTED — 0.8% against a pre-committed 20% bar", () => {
    // Read this with the exit code. The command is green because the count has
    // been taken; the count says the solution above it costs far more than it saves.
    expect(census.meetsBar).toBe(false);
    expect(formatPathGuessCensus(census)).toContain("REFUTED");
  });

  test("the guard taxes 121 correct addresses for every wrong guess it saves", () => {
    expect(Math.round(census.taxedPerSave!)).toBe(121);
  });

  test("no reading rescues it, so the arguable choices are not what decided it", () => {
    // Four full recounts — both populations, both readings of "has looked" — and
    // an upper bound on each that credits the guard with every failure of any kind
    // plus every call whose result never came back. The best case the corpus can
    // be made to give the guard is 6.7%, a third of the bar.
    expect(census.readings.map((r) => [r.population, r.observation, r.wrongGuesses, r.firstContact])).toEqual([
      ["declared", "strict", 44, 7500],
      ["declared", "generous", 26, 3499],
      ["all", "strict", 143, 17427],
      ["all", "generous", 98, 10388],
    ]);
    expect(census.readings.every((r) => !r.meetsBar && !r.upperBoundMeetsBar)).toBe(true);
    expect(census.anyReadingMeetsBar).toBe(false);
    expect(census.readingDecides).toBe(false);
    expect(census.bestCaseHitRate).toBeCloseTo(0.067, 3);
  });

  test("the permission-denial exclusion moves the number by exactly nothing", () => {
    // The one class the rule refuses to credit the guard with. There is not one of
    // them among the blocked calls, so the exclusion is not what decided it.
    expect(census.deniedNotSaved).toBe(0);
  });

  test("THE GUARD HAS NO BOOTSTRAP: 6,484 blocked calls were themselves a look", () => {
    // 37% of everything the guard would refuse is `ls`, `find`, `grep` or `git` —
    // the exact looking its own refusal message would name. A session's first
    // listing addresses a directory nothing has observed yet, so under the guard
    // as written it never runs and nothing is ever observed. The solution node
    // names only one exemption, for creating a file that does not exist yet.
    expect(census.discoveryBlocked).toBe(6484);
    expect(census.discoveryBlocked / census.primary.firstContact).toBeGreaterThan(0.35);
  });

  test("the handshake this generalises cost 509 refusals in the same corpus", () => {
    // The solution node states its own worst risk as "roughly twenty collisions
    // with read-before-write across eleven sessions … the most frequent friction
    // event the product has ever observed about itself". Off the raw record it is
    // 509, twenty-five times the figure the node argued against — and that is the
    // cost of the handshake over ONE surface, which this solution proposes to
    // widen to every path-taking call.
    expect(census.handshakeRefusals).toBe(509);
  });

  test("the report leads with coverage and says the verdict in words", () => {
    const report = formatPathGuessCensus(census);
    expect(report).toContain("1219 session(s)");
    expect(report).toContain("against a pre-committed bar of 20%");
    expect(report).toContain("No reading clears the bar");
  });
});

// ── the reader against the real record, not a synthetic one ──────────────────

describe("the reader against two sessions kept raw", () => {
  const sessions = readTranscriptSessions(fixtureDir);

  test("both committed slices are read as transcripts", () => {
    expect(sessions.map((s) => s.id).sort()).toEqual(["agent-abf938e2353ceae33", "agent-adfe86f7f96570999"]);
  });

  test("the session where the guard would have paid for itself", () => {
    // A subagent told in prose about a vault it had never listed. Thirteen
    // path-taking calls, not one preceded by a look, eight of them wrong — a 62%
    // hit rate, three times the bar. The corpus average is not a claim about every
    // session, and this one is the counter-example the aggregate hides.
    const one = sessions.find((s) => s.id === "agent-abf938e2353ceae33")!;
    const { streams, sessionsRead, calls } = readSessionStreams([one]);
    const census = pathGuessCensus(streams, { sessionsRead, calls });
    expect(census.primary.firstContact).toBe(13);
    expect(census.primary.observed).toBe(0);
    expect(census.primary.wrongGuesses).toBe(8);
    expect(census.primary.hitRate).toBeCloseTo(0.615, 3);
    expect(census.meetsBar).toBe(true);

    // It guessed the same file under three different roots in a row, which is the
    // behaviour the solution was ideated from.
    const guessed = replayGuard(streams, "all", "strict").filter((b) => b.wrongGuess);
    expect(guessed.filter((b) => b.unseen[0].endsWith("ost.config.json"))).toHaveLength(3);
  });

  test("the session where it would have been pure tax", () => {
    // Six first-contact addresses, every one of them right, in a repository the
    // agent had never listed either. This is the shape the corpus is made of.
    const one = sessions.find((s) => s.id === "agent-adfe86f7f96570999")!;
    const { streams, sessionsRead, calls } = readSessionStreams([one]);
    const census = pathGuessCensus(streams, { sessionsRead, calls });
    expect(census.primary.firstContact).toBe(6);
    expect(census.primary.wrongGuesses).toBe(0);
    expect(census.meetsBar).toBe(false);
    // Half of what the guard would have refused here is the looking itself.
    expect(census.discoveryBlocked).toBe(3);
  });
});
