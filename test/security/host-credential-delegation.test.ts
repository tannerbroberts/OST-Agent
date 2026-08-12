/**
 * The instrument for "Ask the host for the credential it already holds,
 * instead of asking the operator for a second one" — beneath the assumption
 * "the hosts this runs under expose a delegable capability, on enough of the
 * real runs to matter".
 *
 * The spec, from the assumption test's own design: for every host surface
 * this repository ships an entry point for, the code either resolves a
 * host-held credential or records that the host exposes none
 * (`src/security/host-delegation.ts`). Structural checks hold the registry to
 * "well-formed"; the rest re-drive the actual code each `delegable: true`
 * entry claims implements it, so a claim in the registry that stops being
 * true fails here rather than going stale as prose.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { gitCommit, gitInitIfAbsent, gitPush } from "../../src/git/safe-git.js";
import { resolveCredential } from "../../src/security/credential-forms.js";
import { githubOffers } from "../../src/runner/credentials.js";
import { HOST_SURFACES, delegableHostSurfaces } from "../../src/security/host-delegation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");

// `host-delegation.ts` itself names these env vars in prose, to explain why no
// OTHER module reads them — excluded here so the registry can describe the
// claim it makes without tripping the very check that verifies it.
const SELF = path.join(srcRoot, "security/host-delegation.ts");

function readAllSrc(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts") && p !== SELF) chunks.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(srcRoot);
  return chunks.join("\n");
}

describe("the registry is well-formed", () => {
  test("every surface names a label, an entry point, and a claim (implementedBy or reason)", () => {
    for (const s of HOST_SURFACES) {
      expect(s.id.length, s.id).toBeGreaterThan(0);
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.entryPoint.length, s.id).toBeGreaterThan(0);
      if (s.delegable) expect(s.implementedBy.length, s.id).toBeGreaterThan(0);
      else expect(s.reason.length, s.id).toBeGreaterThan(0);
    }
  });

  test("ids are unique — one verdict per surface, never two", () => {
    expect(new Set(HOST_SURFACES.map((s) => s.id)).size).toBe(HOST_SURFACES.length);
  });

  test("the assumption's threshold: at least 2 surfaces expose a delegable capability", () => {
    expect(delegableHostSurfaces().length).toBeGreaterThanOrEqual(2);
  });
});

describe("agent-session: no model credential is asked of the operator", () => {
  test("nothing under src/ reads ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN", () => {
    const all = readAllSrc();
    expect(all).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(all).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
  });
});

describe("vault-git-remote: the host's own git credentials, never a configured one", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-host-deleg-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("ost.config.yaml carries no push-credential field, and safe-git.ts reads none", () => {
    const schema = fs.readFileSync(path.join(srcRoot, "config/schema.ts"), "utf8");
    expect(schema).not.toMatch(/push.*[Tt]oken|remote.*[Cc]redential/);
    const code = fs
      .readFileSync(path.join(srcRoot, "git/safe-git.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\.env/);
  });

  test("gitPush reaches a bare remote with no credential passed anywhere in the call", async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "ost-host-deleg-remote-"));
    try {
      await simpleGit(target).raw(["init", "--bare"]);
      await gitInitIfAbsent(dir);
      fs.writeFileSync(path.join(dir, "a.md"), "one");
      await gitCommit(dir, "first");
      await gitPush(dir, target);
      expect((await simpleGit(target).raw(["for-each-ref"])).trim()).not.toBe("");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

describe("terminal-cli: gh's own stored login, not a second token", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-host-deleg-gh-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("githubOffers resolves gh's stored login before asking the operator for a variable", () => {
    fs.writeFileSync(
      path.join(tmp, "hosts.yml"),
      `github.com:\n    user: tanner\n    oauth_token: gho_stored-by-gh-login-0123456789\n`,
      "utf8",
    );
    const result = resolveCredential(githubOffers({ GH_CONFIG_DIR: tmp }));
    expect(result.accepted?.form).toBe("cli-stored-auth");
    expect(result.accepted?.secret).toBe("gho_stored-by-gh-login-0123456789");
  });

  test("`gh pr merge` is invoked with no token argument — gh's own auth is what authenticates it", () => {
    const src = fs.readFileSync(path.join(srcRoot, "release/ship-repo.ts"), "utf8");
    const calls = [...src.matchAll(/\["gh"[^\]]*\]/g)].map((m) => m[0]);
    expect(calls.length, "no `gh` invocation found in ship-repo.ts").toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toMatch(/token/i);
  });
});

describe("scheduled-job: the token GitHub Actions injects, not one an operator sets", () => {
  test("GITHUB_TOKEN alone resolves the credential — the exact name Actions injects", () => {
    const result = resolveCredential(githubOffers({ GITHUB_TOKEN: "ghs_actions-injected-0123456789" }));
    expect(result.accepted?.form).toBe("env-var");
    expect(result.accepted?.source).toBe("GITHUB_TOKEN");
  });
});

describe("editor-extension: recorded as exposing none, and that stays true", () => {
  test("this repository ships no editor-extension entry point to check", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.contributes).toBeUndefined();
    expect(pkg.engines?.vscode).toBeUndefined();
  });
});
