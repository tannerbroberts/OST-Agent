/**
 * Auth-wall legibility: a missing-credential failure from the SDK must come out
 * of the CLI as an actionable message — including the zero-key path (drive the
 * tree from Claude Code over MCP) — not as a raw SDK auth stack line.
 */
import { describe, expect, test } from "vitest";
import { withAuthHint } from "../../src/runner/errors.js";

const SDK_AUTH_ERROR =
  "Could not resolve authentication method. Expected either apiKey or authToken to be set. " +
  'Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted';

describe("withAuthHint", () => {
  test("an SDK auth failure gains the two real fixes: set a key, or use the no-key MCP path", () => {
    const out = withAuthHint(SDK_AUTH_ERROR);
    expect(out).toContain(SDK_AUTH_ERROR); // never hide the original error
    expect(out).toMatch(/ANTHROPIC_API_KEY/);
    expect(out).toMatch(/no api key/i);
    expect(out).toMatch(/mcp|claude code/i);
  });

  test("a non-auth error passes through untouched", () => {
    expect(withAuthHint("P2_map exploded: disk full")).toBe("P2_map exploded: disk full");
  });
});
