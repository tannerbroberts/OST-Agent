/**
 * The instrument for "Never let a malformed search be counted as an empty result".
 *
 * **What is being tested.** Not that an unread marker can be constructed —
 * introducing a third return state is easy. What is in doubt is whether the
 * distinction between "examined and found nothing" and "could not examine"
 * survives the trip to the number an operator reads. So the fixture is a sweep
 * over ten subjects, two of which cannot be read for reasons taken from this
 * vault's own record rather than invented: one whose pattern is malformed the way
 * `{Charge` was malformed, and one the filesystem refuses the way the product
 * directory was refused four times. The bar is that the reported total says eight
 * examined and two unread with both reasons named.
 *
 * A total that says ten examined is the bug this exists to prevent. A total that
 * says eight and stays silent about the other two is the same bug wearing better
 * manners — silence about an unread subject is what produced the clean result in
 * the first place — so that is asserted as a failure too.
 *
 * **The half that actually tests the parent assumption.** The assumption is that
 * every consumer between the search and the summary preserves the distinction,
 * and the pressure at each boundary runs the other way: `results.length` and
 * `results.filter(...)` are the obvious things to write and both flatten unread
 * to zero. So the flattening path is asserted *absent*, not merely unused —
 * structurally (no `hits`, no `length`, no iterator, nothing in `JSON.stringify`)
 * and at the type level, by running `tsc` over source that tries each of them and
 * requiring it to fail to compile. A guarantee that rests on people writing the
 * careful thing is a convention, and conventions in this codebase have a recorded
 * history of not holding: the wrapped-wikilink rule exists because asking people
 * to keep links on one line did not work.
 *
 * **Non-vacuity.** Every assertion about a missing hit has a positive control
 * beside it — the same ten subjects, all readable, all patterns valid — which
 * finds eight hits. That is what proves the two unread subjects were hiding real
 * content rather than being empty anyway, and it is what would fail if a bug made
 * every search come back unread.
 *
 * **What green here does not settle.** It covers the mechanical path only. Every
 * summary this loop writes is composed in prose by a model, and no type system
 * stops a sentence from saying "no issues found" over a subject that was never
 * read. It also exercises two failure modes because those two are on record; a
 * third nobody has hit yet is not covered by this passing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  compileGlob,
  examined,
  formatSearchTotal,
  searchSubjects,
  SearchTotal,
  unread,
  type LineHit,
  type SearchRequest,
} from "../../src/ost/search.js";
import { sweepReport } from "../../src/ost/sweep.js";

const TSC = path.resolve(__dirname, "../../node_modules/.bin/tsc");
const SEARCH_MODULE = path.resolve(__dirname, "../../src/ost/search.js");

/** The malformed glob, copied from the friction record verbatim. */
const MALFORMED = "{Charge";
/** The pattern the other nine subjects are searched with. */
const GOOD = "*Charge*";

let dirs: string[];

beforeEach(() => {
  dirs = [];
});

afterEach(() => {
  for (const d of dirs) {
    // chmod back first: a 0o000 file cannot be removed from a directory the
    // test also stripped, and a leaked tmpdir is a slow way to fill a CI disk.
    try {
      for (const f of fs.readdirSync(d)) fs.chmodSync(path.join(d, f), 0o600);
    } catch {
      // already gone
    }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpdir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * Ten subjects on disk. Eight carry one line that matches `*Charge*`, two do not.
 *
 * Subjects 3 and 7 — the two that will go unread — are both given a matching
 * line. That is what makes the count in the positive control (8) differ from the
 * count in the real run (6): the two hits that go missing are real hits, so a
 * total that reported 6 over ten examined subjects would be wrong about the
 * world and not merely imprecise about its own coverage.
 */
function tenSubjects(dir: string): string[] {
  const names: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const name = `subject-${i}`;
    const body = i <= 8 ? "Charge the battery" : "nothing of interest";
    fs.writeFileSync(path.join(dir, `${name}.md`), `${name} header\n${body}\ntrailing line\n`);
    names.push(name);
  }
  return names;
}

/**
 * The requests as the failing run makes them: subject 3 gets the malformed
 * pattern, subject 7's file is refused by the filesystem.
 *
 * The denial is a real `chmod 0o000` rather than an injected error, because the
 * event on record is a real one. Running as root defeats `chmod`, so under root
 * the subject is pointed at a directory instead — `EISDIR`, which is the same
 * event from the caller's side and is not something a uid can bypass. Both paths
 * assert the same thing; neither fakes the failure.
 */
function failingRequests(dir: string, names: string[]): SearchRequest[] {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (asRoot) {
    fs.rmSync(path.join(dir, "subject-7.md"));
    fs.mkdirSync(path.join(dir, "subject-7.md"));
  } else {
    fs.chmodSync(path.join(dir, "subject-7.md"), 0o000);
  }
  return names.map((subject, i) => ({
    subject,
    file: path.join(dir, `${subject}.md`),
    pattern: i === 2 ? MALFORMED : GOOD,
  }));
}

describe("the total distinguishes hits, examined and unread", () => {
  test("ten subjects, two unreadable: 8 examined / 2 unread, both reasons named", () => {
    const dir = tmpdir("ost-unread-");
    const names = tenSubjects(dir);
    const total = searchSubjects(failingRequests(dir, names));

    expect(total.offered).toBe(10);
    // The bug this exists to prevent: a total that reports ten examined.
    expect(total.examined).toBe(8);
    expect(total.unread).toHaveLength(2);

    const bySubject = new Map(total.unread.map((u) => [u.subject, u]));
    expect(bySubject.get("subject-3")?.cause).toBe("malformed-pattern");
    expect(bySubject.get("subject-3")?.detail).toContain(MALFORMED);
    expect(bySubject.get("subject-7")?.cause).toBe("denied");

    // Three quantities, not two. Six hits found, and the total says out loud that
    // it is short by whatever the two unread subjects hold — which is two more.
    const found = total.resolve({
      whenComplete: (hits) => hits.length,
      whenUnread: (_unread, hits) => hits.length,
    });
    expect(found).toBe(6);
  });

  test("the reported line names both unread subjects and both reasons", () => {
    const dir = tmpdir("ost-unread-");
    const names = tenSubjects(dir);
    const text = formatSearchTotal("sweep", searchSubjects(failingRequests(dir, names)));

    expect(text).toContain("8 of 10 subject(s) examined, 2 unread");
    // Silence about an unread subject fails here: naming the count is not enough,
    // the subject and its reason have to reach the operator's line.
    expect(text).toContain("subject-3");
    expect(text).toContain("malformed-pattern");
    expect(text).toContain(MALFORMED);
    expect(text).toContain("subject-7");
    expect(text).toContain("denied");
  });

  test("the same ten subjects, all readable, find the two hits that went missing", () => {
    const dir = tmpdir("ost-unread-control-");
    const names = tenSubjects(dir);
    const total = searchSubjects(names.map((subject) => ({ subject, file: path.join(dir, `${subject}.md`), pattern: GOOD })));

    expect(total.offered).toBe(10);
    expect(total.examined).toBe(10);
    expect(total.unread).toEqual([]);
    expect(total.resolve({ whenComplete: (hits) => hits.length, whenUnread: (_u, hits) => hits.length })).toBe(8);
    expect(formatSearchTotal("sweep", total)).toContain("0 unread");
  });

  test("the offered/read pair reaches the sweep report, so the run is partly blind rather than clean", () => {
    const dir = tmpdir("ost-unread-");
    const names = tenSubjects(dir);
    const total = searchSubjects(failingRequests(dir, names));
    const report = sweepReport("search", total.toSweepSubject(), 6);

    expect(report.blindness).toBe("partly-blind");
    expect(report.lines.join("\n")).toContain("partly blind");
  });

  test("a malformed pattern over every subject is blind, not clean", () => {
    const dir = tmpdir("ost-unread-blind-");
    const names = tenSubjects(dir);
    const total = searchSubjects(
      names.map((subject) => ({ subject, file: path.join(dir, `${subject}.md`), pattern: MALFORMED })),
    );

    expect(total.examined).toBe(0);
    expect(total.blind).toBe(true);
    expect(sweepReport("search", total.toSweepSubject(), 0).exitCode).toBe(1);
    expect(formatSearchTotal("sweep", total)).toContain("ran against nothing");
  });
});

describe("the compiler refuses the pattern instead of matching nothing", () => {
  test("`{Charge` does not compile, and says so in ripgrep's words", () => {
    const compiled = compileGlob(MALFORMED);
    expect(compiled.ok).toBe(false);
    expect(compiled.ok === false && compiled.error).toContain("unclosed alternate group");
  });

  test("a well-formed alternate group still compiles and matches", () => {
    const compiled = compileGlob("*{Charge,Discharge}*");
    expect(compiled.ok).toBe(true);
    expect(compiled.ok === true && compiled.matches("Charge the battery")).toBe(true);
    expect(compiled.ok === true && compiled.matches("nothing of interest")).toBe(false);
  });
});

describe("the flattening path is absent, not merely unused", () => {
  const total = SearchTotal.over<LineHit>([
    examined("a", [{ subject: "a", line: 1, text: "Charge" }]),
    unread<LineHit>("b", "denied", "EACCES"),
  ]);

  test("no member yields the hits without the unread case", () => {
    const members = new Set([
      ...Object.getOwnPropertyNames(total),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(total)),
    ]);
    for (const forbidden of ["hits", "length", "results", "matches", "count", "size", "filter", "map"]) {
      expect(members.has(forbidden)).toBe(false);
    }
  });

  test("it is not a collection: not spreadable, and it hands nothing out to JSON", () => {
    expect((total as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator]).toBeUndefined();
    // The outcomes live in a `#private` field, so serialising the total cannot
    // leak them into a consumer that then takes a length off the array.
    expect(JSON.stringify(total)).not.toContain("Charge");
    expect(JSON.stringify(total)).not.toContain("hits");
  });

  test("the type checker rejects every flattening call and accepts the handled one", () => {
    const dir = tmpdir("ost-unread-tsc-");
    // `type: module` so `--module nodenext` reads these the way the repo's own
    // sources are read; without it TS treats them as CommonJS and reports that
    // instead of what is being asked.
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const from = path.relative(dir, SEARCH_MODULE).split(path.sep).join("/");

    const preamble = `import { SearchTotal, type LineHit } from "${from}";\ndeclare const total: SearchTotal<LineHit>;\n`;
    const bad: Record<string, string> = {
      "hits.ts": `${preamble}export const n = total.hits.length;\n`,
      "length.ts": `${preamble}export const n = total.length;\n`,
      "spread.ts": `${preamble}export const n = [...total].length;\n`,
      "half.ts": `${preamble}export const n = total.resolve({ whenComplete: (h) => h.length });\n`,
    };
    const good = "handled.ts";
    for (const [name, src] of Object.entries(bad)) fs.writeFileSync(path.join(dir, name), src);
    fs.writeFileSync(
      path.join(dir, good),
      `${preamble}export const n = total.resolve({\n  whenComplete: (h) => h.length,\n  whenUnread: (u, h) => h.length + u.length,\n});\n`,
    );

    const files = [...Object.keys(bad), good].map((f) => path.join(dir, f));
    const tsc = spawnSync(TSC, ["--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", ...files], {
      encoding: "utf8",
    });
    const out = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`;

    // Each flattening attempt is a compile error — the path is absent from the
    // type, so a consumer cannot reach a bare count by writing the obvious thing.
    for (const name of Object.keys(bad)) {
      expect(out, `expected ${name} not to compile:\n${out}`).toContain(name);
    }
    // …and the handled call compiles, which is what makes the four above a
    // statement about flattening rather than about the module failing to build.
    expect(out, `expected ${good} to compile:\n${out}`).not.toContain(good);
    expect(tsc.status).not.toBe(0);
  }, 60_000);
});
