/**
 * The credential wall must be an instruction, not a stack trace.
 *
 * Observed (fresh-user simulation, 2026-07-25): `ost-agent run P2_map` without a
 * key dies with the raw SDK line "Could not resolve authentication method.
 * Expected either apiKey or authToken to be set." A PM cannot act on that, and it
 * conceals the fact that a no-key path exists at all — the MCP server holds no
 * model and needs no credential.
 */
import { describe, expect, test } from "vitest";
import { anthropicCredentialsPresent, assertAnthropicCredentials } from "../../src/runner/credentials.js";

describe("anthropicCredentialsPresent", () => {
  test("false when neither variable is set", () => {
    expect(anthropicCredentialsPresent({})).toBe(false);
  });

  test("an empty or whitespace value is not a credential", () => {
    expect(anthropicCredentialsPresent({ ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(anthropicCredentialsPresent({ ANTHROPIC_API_KEY: "   " })).toBe(false);
  });

  test("either variable the SDK accepts counts", () => {
    expect(anthropicCredentialsPresent({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(anthropicCredentialsPresent({ ANTHROPIC_AUTH_TOKEN: "tok" })).toBe(true);
  });
});

describe("assertAnthropicCredentials", () => {
  test("passes silently when a credential is present", () => {
    expect(() => assertAnthropicCredentials({ ANTHROPIC_API_KEY: "sk-ant-x" })).not.toThrow();
  });

  test("names the variable to set AND the no-key path, so neither reads as the only option", () => {
    let msg = "";
    try {
      assertAnthropicCredentials({});
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).not.toBe("");
    expect(msg).toMatch(/ANTHROPIC_API_KEY/);
    expect(msg).toMatch(/ost-agent mcp/);
    expect(msg).toMatch(/plugin/i);
    // the point of the guard: the operator never sees the SDK's own wording
    expect(msg).not.toMatch(/Could not resolve authentication method/);
  });

  test("says which command it was about to run, so the message is locatable", () => {
    let msg = "";
    try {
      assertAnthropicCredentials({}, "run P2_map");
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/run P2_map/);
  });
});
