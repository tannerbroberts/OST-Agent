/**
 * Replay the two titles that broke ripgrep through every path that reaches a
 * command.
 *
 * The bar this file was written against, pre-committed in the tree: *both titles
 * traverse all four routes with correct quoting or explicit refusal, and no call
 * path yields the unwrapped string without naming a destination.* The second half
 * is the half that decides between two different products — "route arguments
 * through a quoter" is a convention with a hole in it, and only "there is no
 * unquoted form" holds. So the last block here is a sweep over every member of
 * the type rather than a list of the leaks anyone thought of.
 *
 * The two values are the ones actually recorded, taken from the transcripts as
 * they were logged: `{Charge` (session `8a9777ad`) and `*{threshold` (session
 * `6e66c934`). They are the globs ripgrep rejected, which are fragments of the
 * node titles they were built from — `Charge for the maintained tree, not the
 * tool that maintains it` and `Check whether the threshold field gets a bound or
 * just the same wrapped prose`, both real nodes in the vault. Both forms are
 * driven through every route, because the whole failure is that the second turns
 * into the first somewhere no one is watching.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseFrontmatter } from "../../src/ost/frontmatter.js";
import { compileGlob } from "../../src/ost/search.js";
import { TreeText, wrapFrontmatter } from "../../src/security/tainted.js";

/** The glob ripgrep rejected, and the node title it was built out of. */
const RECORDED = [
  {
    label: "8a9777ad",
    glob: "{Charge",
    title: "Charge for the maintained tree, not the tool that maintains it",
  },
  {
    label: "6e66c934",
    glob: "*{threshold",
    title: "Check whether the threshold field gets a bound or just the same wrapped prose",
  },
] as const;

/** Every value under test, each as it arrives out of a real frontmatter block. */
const VALUES: readonly { readonly name: string; readonly raw: string }[] = RECORDED.flatMap((r) => [
  { name: `${r.label} glob`, raw: r.glob },
  { name: `${r.label} title`, raw: r.title },
]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tainted-guard-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/**
 * Read one value the way a pass does: out of a node file's frontmatter, wrapped
 * at the boundary. Nothing in this file constructs a `TreeText` by hand, because
 * the claim under test is about values that came from the tree.
 */
function fromNodeFile(name: string, raw: string): TreeText {
  const file = path.join(tmp, `${name.replace(/[^a-z0-9]+/gi, "-")}.md`);
  // YAML-quoted, which is how a title with punctuation is stored on disk.
  fs.writeFileSync(file, `---\ntype: Solution\ntitle: ${JSON.stringify(raw)}\n---\nbody\n`, "utf8");
  const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"));
  const wrapped = wrapFrontmatter(file, parsed.data);
  const value = wrapped.get("title");
  if (!value) throw new Error(`title did not survive the frontmatter read of ${file}`);
  return value;
}

describe("route 1 — a search over node text", () => {
  test.each(RECORDED)("$label: the recorded glob is genuinely rejected unquoted", ({ glob }) => {
    // The premise, asserted rather than assumed: this is a real failure and not a
    // story about one. Both recorded values open an alternate group and never
    // close it, which is exactly what ripgrep complained about.
    const bare = compileGlob(glob);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toMatch(/unclosed alternate group/);
  });

  test.each(VALUES)("$name: quoted for search, it compiles and matches itself", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);
    const compiled = compileGlob(value.forSearchPattern());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.matches(raw)).toBe(true);
    // A literal is a literal: it must not have become a wildcard on the way.
    expect(compiled.matches(`${raw} and more`)).toBe(false);
  });

  test("a backslash in a title stays a backslash", () => {
    const value = fromNodeFile("backslash", "a\\{b");
    const compiled = compileGlob(value.forSearchPattern());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.matches("a\\{b")).toBe(true);
  });
});

describe("route 2 — a path built for a file read", () => {
  test.each(VALUES)("$name: the path built for it reads back the bytes written", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);
    const built = value.forPathUnder(tmp);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    fs.writeFileSync(built.path, `body of ${name}`, "utf8");
    expect(fs.readFileSync(built.path, "utf8")).toBe(`body of ${name}`);
    expect(path.dirname(built.path)).toBe(tmp);
  });

  test.each([
    { name: "separator", raw: "notes/{Charge" },
    { name: "traversal", raw: "..{Charge" },
    { name: "newline", raw: "{Charge\nrm -rf /" },
    { name: "blank", raw: "   " },
  ])("$name: refuses rather than repairing", ({ name, raw }) => {
    const built = fromNodeFile(name, raw).forPathUnder(tmp);
    expect(built.ok).toBe(false);
    // A refusal has to say what was wrong with the value, or it is a silent drop
    // wearing a return type.
    if (!built.ok) expect(built.reason.length).toBeGreaterThan(0);
  });
});

describe("route 3 — a message formatted for output", () => {
  test.each(VALUES)("$name: printed as a value, on one line, recoverable", ({ name, raw }) => {
    const message = fromNodeFile(name, raw).forMessage();
    expect(message.includes("\n")).toBe(false);
    expect(JSON.parse(message)).toBe(raw);
  });

  test("a control character never reaches the output as itself", () => {
    const message = fromNodeFile("control", "{Charge\n== not found").forMessage();
    expect(message.includes("\n")).toBe(false);
    expect(message).toContain("\\n");
  });
});

describe("route 4 — a comparison against a literal", () => {
  test.each(VALUES)("$name: compares without yielding the string", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);
    expect(value.equalsLiteral(raw)).toBe(true);
    expect(value.equalsLiteral(`${raw} `)).toBe(false);
    expect(value.equalsLiteral("Charge")).toBe(false);
  });
});

/**
 * The half that separates the two designs: not "is there a quoter" but "is there
 * anything else".
 */
describe("no bare form", () => {
  /**
   * The complete inventory of members that may hand back something derived from
   * the value, each named for where the value is going. The sweep below asserts
   * every *other* member leaks nothing, and the inventory assertion means a new
   * member added later has to be argued for here before it can pass.
   */
  const DESTINATIONS = new Set(["forSearchPattern", "forPathUnder", "forMessage", "equalsLiteral"]);

  test.each(VALUES)("$name: the implicit conversions all throw", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);
    expect(() => String(value)).toThrow(/no bare form/);
    expect(() => `${value}`).toThrow(/no bare form/);
    expect(() => (value as unknown as string) + "").toThrow(/no bare form/);
    expect(() => JSON.stringify(value)).toThrow(/no bare form/);
    expect(() => JSON.stringify({ title: value })).toThrow(/no bare form/);
    expect(() => [value].join(",")).toThrow(/no bare form/);
  });

  test.each(VALUES)("$name: enumeration and spreading expose nothing", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);
    expect(Object.keys(value)).toEqual([]);
    expect(Object.values(value)).toEqual([]);
    expect(Object.getOwnPropertyNames(value)).toEqual([]);
    expect(JSON.stringify({ ...value })).toBe("{}");
    expect((value as unknown as Iterable<unknown>)[Symbol.iterator]).toBeUndefined();
  });

  test.each(VALUES)("$name: no member outside the named destinations yields the value", ({ name, raw }) => {
    const value = fromNodeFile(name, raw);

    const members = new Set<string | symbol>();
    for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const key of Reflect.ownKeys(o)) members.add(key);
    }

    for (const key of members) {
      if (key === "constructor" || (typeof key === "string" && DESTINATIONS.has(key))) continue;

      // Reading the member, then calling it if it takes no argument — the two
      // shapes a leak comes in. A member that throws has refused, which passes.
      const results: unknown[] = [];
      let read: unknown;
      try {
        read = Reflect.get(value, key);
        results.push(read);
      } catch {
        continue;
      }
      if (typeof read === "function" && read.length === 0) {
        try {
          results.push(read.call(value));
        } catch {
          /* a refusal is the outcome this test wants */
        }
      }

      for (const result of results) {
        if (typeof result === "function") continue;
        expect(result, `${String(key)} returned the value`).not.toBe(raw);
        const rendered = typeof result === "string" ? result : safeRender(result);
        expect(rendered.includes(raw), `${String(key)} leaked the value: ${rendered}`).toBe(false);
      }
    }
  });

  test("the destination inventory is exactly what the sweep exempts", () => {
    const declared = Object.getOwnPropertyNames(TreeText.prototype).filter(
      (n) => n !== "constructor" && !["toString", "valueOf", "toJSON"].includes(n),
    );
    // `origin` and `length` are on the prototype too and are exempt from the
    // inventory because they carry no part of the value — the sweep above proves
    // that rather than trusting it.
    expect(new Set(declared)).toEqual(new Set([...DESTINATIONS, "origin", "length"]));
  });

  test("origin names the source without carrying the value", () => {
    const raw = "{Charge";
    const value = fromNodeFile("origin", raw);
    expect(value.origin.field).toBe("title");
    expect(value.origin.file.endsWith("origin.md")).toBe(true);
    expect(JSON.stringify(value.origin).includes(raw)).toBe(false);
  });
});

/** Render whatever a member handed back, without letting it refuse to be inspected. */
function safeRender(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "";
  }
}
