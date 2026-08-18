/**
 * Five real-shaped `.claude/settings.json` files, merged, and checked for
 * loss — the assumption test for "Creating a vault writes the tool-enabling
 * config into the project beside it": that writing the enabling config
 * automatically is only a fix if the write into a file the operator already
 * owns cannot damage what was already there.
 *
 * Green means: every setting each fixture started with is still present and
 * unchanged after the merge, the merged file enables the plugin per
 * `diagnoseSetup` (the same check `setup-check-diagnosis.test.ts` pins), and
 * at least four of the five still parse as strict JSON without hand-fixing —
 * the fifth carries comments, and preserving those on purpose is what "keep
 * every setting" means for that fixture, not a failure to reformat it away.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mergeEnablingConfig } from "../../src/config/settings-merge.js";
import { diagnoseSetup } from "../../src/config/setup-check.js";

let project: string;

beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-settings-merge-")));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

function canonical(): string {
  return path.join(project, ".claude", "settings.json");
}

/** Deep "is `sub` present, unchanged, inside `whole`" — additions in `whole` are fine. */
function isSubsetOf(sub: unknown, whole: unknown): boolean {
  if (sub === whole) return true;
  if (typeof sub !== "object" || sub === null || typeof whole !== "object" || whole === null) return false;
  if (Array.isArray(sub) !== Array.isArray(whole)) return false;
  if (Array.isArray(sub) && Array.isArray(whole)) {
    return sub.length === whole.length && sub.every((v, i) => isSubsetOf(v, whole[i]));
  }
  return Object.entries(sub as Record<string, unknown>).every(([k, v]) =>
    isSubsetOf(v, (whole as Record<string, unknown>)[k]),
  );
}

const FIXTURES: { name: string; raw: string; expectStrictJsonParse: boolean }[] = [
  {
    name: "empty object — the smallest real file",
    raw: `{}\n`,
    expectStrictJsonParse: true,
  },
  {
    name: "permissions only, no plugin keys at all",
    raw: JSON.stringify({ permissions: { allow: ["Read", "Grep(*)", "Bash(git status:*)"] } }, null, 2) + "\n",
    expectStrictJsonParse: true,
  },
  {
    name: "already enables a different plugin and a different marketplace",
    raw:
      JSON.stringify(
        {
          extraKnownMarketplaces: {
            "some-other-marketplace": { source: { source: "github", repo: "someone/else" } },
          },
          enabledPlugins: { "some-other-plugin@some-other-marketplace": true },
          permissions: { allow: ["Read"] },
        },
        null,
        2,
      ) + "\n",
    expectStrictJsonParse: true,
  },
  {
    name: "comments and unusual formatting — a hand-edited file",
    raw: [
      "{",
      "  // permissions this project has granted so far",
      "  \"permissions\": { \"allow\": [\"Read\", \"Grep\"] }, // trailing comment",
      "  /* env block, left compact on purpose */",
      "  \"env\": {\"FOO\":\"bar\"}",
      "}",
      "",
    ].join("\n"),
    expectStrictJsonParse: false,
  },
  {
    name: "the plugin's own key already present, alongside unrelated config",
    raw:
      JSON.stringify(
        {
          enabledPlugins: { "ost-agent@ost-agent": true },
          statusLine: { type: "command", command: "echo hi" },
        },
        null,
        2,
      ) + "\n",
    expectStrictJsonParse: true,
  },
];

describe("merging the enabling config into five real settings files", () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const before = parseJsonc(fixture.raw, [], { allowTrailingComma: true });

      const result = mergeEnablingConfig(fixture.raw);
      expect(result.ok).toBe(true);
      const merged = result.content as string;

      // Nothing the fixture started with was lost.
      const after = parseJsonc(merged, [], { allowTrailingComma: true });
      expect(isSubsetOf(before, after)).toBe(true);

      // Strict JSON.parse only where the fixture had no comments to preserve.
      fs.mkdirSync(path.dirname(canonical()), { recursive: true });
      fs.writeFileSync(canonical(), merged, "utf8");
      if (fixture.expectStrictJsonParse) {
        expect(() => JSON.parse(merged)).not.toThrow();
        // Claude Code's own settings loader is strict JSON (`setup-check.ts`'s
        // `enables()` reads it that way), so only the fixtures that stayed
        // strict JSON are checked against the real diagnosis — see the
        // dedicated test below for why the comment-carrying fixture is not.
        const d = diagnoseSetup(project);
        expect(d.ok).toBe(true);
        expect(d.enabledBy).toBe(canonical());
      } else {
        expect(() => JSON.parse(merged)).toThrow();
        expect(merged).toContain("// permissions this project has granted so far");
        expect(merged).toContain("/* env block, left compact on purpose */");
      }
    });
  }

  test("at least four of the five fixtures parse as strict JSON without hand-fixing", () => {
    const strictCount = FIXTURES.filter((f) => {
      const result = mergeEnablingConfig(f.raw);
      if (!result.ok) return false;
      try {
        JSON.parse(result.content as string);
        return true;
      } catch {
        return false;
      }
    }).length;
    expect(strictCount).toBeGreaterThanOrEqual(4);
  });

  test("preserving comments means the merged file does NOT register as enabled by diagnoseSetup", () => {
    // The safety bar ("keep every setting") and the correctness bar ("actually
    // enables the plugin") pull in opposite directions for a file that already
    // carries comments: preserving them is what "nothing lost" requires, but
    // `diagnoseSetup` (and, on the evidence of its own strict `JSON.parse`,
    // Claude Code's real settings loader) cannot read past them. This is the
    // gap the solution node itself names ("says nothing about the merge being
    // correct") — pinned here so it stays a known, tested gap rather than a
    // silent one, and so a caller (`init`) knows to check `diagnoseSetup`
    // after writing rather than trusting `mergeEnablingConfig`'s `ok: true`.
    const commentFixture = FIXTURES.find((f) => !f.expectStrictJsonParse);
    if (!commentFixture) throw new Error("expected a comment-carrying fixture");
    const result = mergeEnablingConfig(commentFixture.raw);
    expect(result.ok).toBe(true);
    fs.mkdirSync(path.dirname(canonical()), { recursive: true });
    fs.writeFileSync(canonical(), result.content as string, "utf8");
    expect(diagnoseSetup(project).ok).toBe(false);
  });

  test("a file that is not a JSON object is refused rather than guessed at", () => {
    const result = mergeEnablingConfig("{ this is not json");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  test("merging twice is idempotent — no duplicate keys, still enables the plugin", () => {
    const once = mergeEnablingConfig(FIXTURES[1].raw);
    expect(once.ok).toBe(true);
    const twice = mergeEnablingConfig(once.content as string);
    expect(twice.ok).toBe(true);
    const parsed = parseJsonc(twice.content as string, [], { allowTrailingComma: true }) as {
      enabledPlugins?: Record<string, unknown>;
    };
    expect(parsed.enabledPlugins?.["ost-agent@ost-agent"]).toBe(true);
  });
});
