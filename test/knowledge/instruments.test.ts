import { describe, expect, test } from "vitest";
import { INSTRUMENT_FORMS, isInstrument, parseInstrument } from "../../src/knowledge/instruments.js";

describe("instrument forms", () => {
  test("a spec-file invocation parses into argv, never a shell string", () => {
    const parsed = parseInstrument("npx vitest run test/git/conflict-guard.test.ts");
    expect(isInstrument(parsed)).toBe(true);
    if (!isInstrument(parsed)) return;
    expect(parsed.target).toBe("test/git/conflict-guard.test.ts");
    expect(parsed.argv).toEqual(["vitest", "run", "test/git/conflict-guard.test.ts"]);
    // The command never reaches a shell, so argv must carry no shell syntax.
    expect(parsed.argv.join(" ")).not.toMatch(/[;&|`$]/);
  });

  test("an absent declaration is a rejection, not a default", () => {
    expect(isInstrument(parseInstrument(undefined))).toBe(false);
    expect(isInstrument(parseInstrument(""))).toBe(false);
    expect(isInstrument(parseInstrument("   "))).toBe(false);
  });

  /*
   * The anti-fabrication core. An agent authors the instrument, so the set of
   * strings it can author is the set of verdicts it can manufacture. Every entry
   * below is a way to exit 0 without any committed code being involved — which
   * is precisely the trade that would let a tree's credibility be spent on
   * `true`.
   */
  test.each([
    ["true"],
    ["echo ok"],
    ["exit 0"],
    ["npx vitest run test/a.test.ts || true"],
    ["npx vitest run test/a.test.ts; true"],
    ["npx vitest run test/a.test.ts && echo done"],
    ["npx vitest run $(echo test/a.test.ts)"],
    ["npx vitest run `echo test/a.test.ts`"],
    ["bash -c 'exit 0'"],
    ["npm test"],
    ["node -e 'process.exit(0)'"],
  ])("refuses a command that could exit 0 without committed code: %s", (command) => {
    const parsed = parseInstrument(command);
    expect(isInstrument(parsed)).toBe(false);
  });

  test.each([
    ["npx vitest run /etc/passwd.test.ts"],
    ["npx vitest run ../other-repo/test/a.test.ts"],
    ["npx vitest run test/../../escape.test.ts"],
  ])("refuses a target outside the repository: %s", (command) => {
    expect(isInstrument(parseInstrument(command))).toBe(false);
  });

  test("a rejection explains itself well enough to act on", () => {
    const parsed = parseInstrument("true");
    expect(isInstrument(parsed)).toBe(false);
    if (isInstrument(parsed)) return;
    expect(parsed.reason).toMatch(/committed code/);
  });

  test("every form assembles argv without invoking a shell interpreter", () => {
    for (const form of INSTRUMENT_FORMS) {
      const argv = form.argv("test/x.test.ts");
      expect(argv[0]).not.toMatch(/^(sh|bash|zsh|env)$/);
      expect(argv.some((a) => a === "-c")).toBe(false);
    }
  });
});
