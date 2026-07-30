import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import * as safeGit from "../../src/git/safe-git.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-git-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("safe-git exported surface", () => {
  test("exposes exactly the three safe operations — no reset/rm/force", () => {
    // Four names, three operations: `pushTargetFor` invokes no git at all. It is
    // the pure decision about WHERE a push may go (P9), and it lives here rather
    // than beside its callers so that the destination and the only call that can
    // reach a network are decided in one file.
    expect(Object.keys(safeGit).sort()).toEqual(["gitCommit", "gitInitIfAbsent", "gitPush", "pushTargetFor"]);
    const src = fs.readFileSync(new URL("../../src/git/safe-git.ts", import.meta.url), "utf8");
    // Scan CODE only (strip comments — the doc comment names these on purpose).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/--force/);
    expect(code).not.toMatch(/\.(reset|clean|rm|deleteLocalBranch)\s*\(/);
    expect(code).not.toMatch(/branch\s*\(\s*\[?\s*["']-D/);
    expect(code).not.toMatch(/filter-branch|rev-list.*--all.*reset/);
  });
});

describe("gitInitIfAbsent + gitCommit", () => {
  test("commits only new history; the parent chain stays intact", async () => {
    expect(await safeGit.gitInitIfAbsent(dir)).toBe(true);
    expect(await safeGit.gitInitIfAbsent(dir)).toBe(false); // idempotent

    fs.writeFileSync(path.join(dir, "a.md"), "one");
    const c1 = await safeGit.gitCommit(dir, "first");
    expect(c1.committed).toBe(true);

    fs.writeFileSync(path.join(dir, "b.md"), "two");
    const c2 = await safeGit.gitCommit(dir, "second");
    expect(c2.committed).toBe(true);
    expect(c2.sha).not.toBe(c1.sha);

    const count = (await simpleGit(dir).raw(["rev-list", "--count", "HEAD"])).trim();
    expect(count).toBe("2");

    // the first commit is still an ancestor — history was never rewritten
    const isAncestor = await simpleGit(dir)
      .raw(["merge-base", "--is-ancestor", c1.sha, c2.sha])
      .then(() => true)
      .catch(() => false);
    expect(isAncestor).toBe(true);
  });

  test("commits succeed with no ambient git identity (fresh CI runner / bare machine)", async () => {
    // Simulate a machine with no usable global/system identity: a global config that
    // sets user.useConfigOnly (so git refuses to guess an identity) and no name/email.
    // Without gitInitIfAbsent seeding a repo-local identity, the commit would fail here.
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-gitcfg-"));
    const globalCfg = path.join(cfgDir, "config");
    fs.writeFileSync(globalCfg, "[user]\n\tuseConfigOnly = true\n");
    const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_CONFIG_GLOBAL = globalCfg;
    process.env.GIT_CONFIG_SYSTEM = os.platform() === "win32" ? "NUL" : "/dev/null";
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ost-noident-"));
    try {
      await safeGit.gitInitIfAbsent(d);
      fs.writeFileSync(path.join(d, "a.md"), "one");
      const c = await safeGit.gitCommit(d, "first");
      expect(c.committed).toBe(true);
    } finally {
      if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prev.g;
      if (prev.s === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = prev.s;
      fs.rmSync(d, { recursive: true, force: true });
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  test("commit is a no-op when the tree is clean", async () => {
    await safeGit.gitInitIfAbsent(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "one");
    await safeGit.gitCommit(dir, "first");
    const again = await safeGit.gitCommit(dir, "noop");
    expect(again.committed).toBe(false);
  });
});

/**
 * P9 — what leaves the machine is determined by the vault's config, not by
 * ambient git state.
 *
 * `gitPush` defaulted its remote to `origin`, neither call site passed one, and
 * `config.remote.url` — the field an operator sets to say where their tree
 * publishes — was carried all the way into the pass context and **read by
 * nothing**. Whatever `git remote add` had been run in that directory decided
 * the destination.
 *
 * The check on this criterion is deliberately half static: a behaviour test can
 * show that a configured URL is honoured, and cannot show that the field has a
 * reader at all, which is the thing that was missing.
 *
 * **The criterion's own grep is the WEAK half, and the adversarial pass found it
 * green in the state it is supposed to fail on.** `grep -rn 'remote\.url' src/ |
 * grep -v src/config/` matched `src/runner/context.ts` before P9 shipped — the
 * line the criterion's own "not met" note cites *as the evidence that nothing
 * read the field*. A carrier is not a reader, so that file is excluded below, and
 * the assertion that actually holds the mechanism is the call-site one after it:
 * `gitPush`'s remote defaults to `origin`, and what P9 is about is that no shipped
 * call site takes the default. That check fails on the pre-P9 source (both sites
 * read `gitPush(dir)`) and on any future reintroduction of the ambient default.
 *
 * **Non-vacuity, by mutation:** putting `git_push` back on `gitPush(dir)` — the
 * ambient default, which is what shipped — turns the tool row red *and* the
 * call-site row red, and leaves the rest green (verified 2026-07-30, one failure
 * before the call-site row existed and two after).
 */
describe("P9 — the destination comes from the vault's config", () => {
  test("`remote.url` has a reader outside the config module and outside the carrier — the criterion's static check", () => {
    // `grep -rn 'remote\.url' src/ --include=*.ts | grep -v src/config/`, run as
    // an assertion. A field only the schema mentions is a field nothing obeys.
    //
    // `src/runner/context.ts` is excluded, and the exclusion is the difference
    // between this check and a check that passes on the defect. That file copies
    // `config.remote.url` into the pass context and is the line the criterion's
    // own "not met" entry cites to show the field was READ BY NOTHING — so a grep
    // that counts it is green in exactly the state it exists to catch. Carrying a
    // value is not obeying it.
    const CARRIER = path.join("src", "runner", "context.ts");
    const srcRoot = new URL("../../src", import.meta.url).pathname;
    const readers: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (p.includes(`${path.sep}config`)) continue;
          walk(p);
        } else if (e.name.endsWith(".ts") && /remote\.url/.test(fs.readFileSync(p, "utf8"))) {
          if (path.relative(path.join(srcRoot, ".."), p) === CARRIER) continue;
          readers.push(p);
        }
      }
    };
    walk(srcRoot);
    expect(readers, "config.remote.url is written by the operator and read by nothing").not.toEqual([]);
    // The exclusion has to actually exclude something, or it is decoration: the
    // carrier really does mention the field, and really is not counted above.
    expect(/remote\.url/.test(fs.readFileSync(path.join(srcRoot, "runner/context.ts"), "utf8"))).toBe(true);
    expect(readers.map((p) => path.basename(p))).not.toContain("context.ts");
  });

  test("no shipped call site takes `gitPush`'s ambient `origin` default — the half with teeth", () => {
    // What the grep above cannot see, and what P9 is actually about. `gitPush`'s
    // `remote` parameter still defaults to `origin`, deliberately (a direct
    // in-process caller — a test — gets it). The property is that no call site
    // the product ships takes that default: each one resolves its destination
    // through `pushTargetFor`, which reads the vault's config.
    //
    // This is the assertion that fails on the pre-P9 source. Both call sites read
    // `gitPush(dir)` then, and both are named in the criterion's own "not met"
    // note — including `src/runner/init.ts`, whose wiring no behavioural test in
    // this file reaches.
    const callSites: { file: string; args: string }[] = [];
    const srcRoot = new URL("../../src", import.meta.url).pathname;
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.name.endsWith(".ts")) continue;
        // safe-git.ts is where `gitPush` is DEFINED — its own signature is not a
        // call site, and matching it would make this test about itself.
        if (p.endsWith(path.join("git", "safe-git.ts"))) continue;
        const src = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        for (const m of src.matchAll(/\bgitPush\(([^)]*)\)/g)) callSites.push({ file: p, args: m[1] });
      }
    };
    walk(srcRoot);

    // Non-vacuity: there are call sites to check. A refactor that renamed the
    // function would otherwise leave this test asserting nothing, loudly green.
    expect(callSites.length, "no gitPush call site found in src/ — this test has stopped checking anything").toBe(2);
    for (const site of callSites) {
      expect(site.args.split(",").length, `${site.file} calls gitPush with no remote — it takes the ambient origin`).toBe(2);
      expect(site.args, `${site.file} passes a remote that does not come from pushTargetFor`).toContain("target.remote");
      expect(fs.readFileSync(site.file, "utf8"), `${site.file} never asks pushTargetFor where a push may go`).toContain("pushTargetFor(");
    }
  });

  test("enabled with a url: that url is the remote, and nothing else is consulted", () => {
    expect(safeGit.pushTargetFor({ enabled: true, url: "git@example.com:me/vault.git" })).toEqual({
      push: true,
      remote: "git@example.com:me/vault.git",
    });
  });

  test("disabled: no push, and it is not an error — the operator said so", () => {
    const decision = safeGit.pushTargetFor({ enabled: false, url: "git@example.com:me/vault.git" });
    expect(decision.push).toBe(false);
    expect(decision).toMatchObject({ reason: "disabled" });
  });

  test("enabled with no url: REFUSED rather than falling back to `origin` — the fail-closed call", () => {
    // The decision this criterion asks to be stated. Guessing a destination for
    // data whose destination the operator has explicitly said they care about is
    // the shape of mistake that is fine until the once it is not; a vault that
    // stops publishing and says why is the cheaper failure.
    const decision = safeGit.pushTargetFor({ enabled: true });
    expect(decision.push).toBe(false);
    expect(decision).toMatchObject({ reason: "no-url" });
    expect(decision.push ? "" : decision.why).toMatch(/remote\.url/);
  });

  test("a url of whitespace is not a url", () => {
    expect(safeGit.pushTargetFor({ enabled: true, url: "   " }).push).toBe(false);
  });

  test("the `git_push` tool pushes to the configured url, and refuses when there is none", async () => {
    // The other end of the wiring: `ToolContext.remote` is `config.remote`
    // (`src/runner/context.ts` → `src/mcp/server.ts`), so this is the whole path
    // from the operator's yaml to the process that leaves the machine. Driven
    // against a local bare repo, so the suite stays offline.
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-remote-"));
    await simpleGit(target).raw(["init", "--bare"]);
    try {
      await safeGit.gitInitIfAbsent(dir);
      fs.writeFileSync(path.join(dir, "a.md"), "one");
      await safeGit.gitCommit(dir, "first");

      const push = (remote: { enabled: boolean; url?: string }) => {
        const ctx: ToolContext = { vault: new Vault(dir), dir, remote };
        const tool = buildOstTools(ctx).find((t) => t.name === "git_push")!;
        return (tool as unknown as { run: (i: unknown) => Promise<string> }).run({});
      };

      await expect(push({ enabled: true })).rejects.toThrow(/remote\.url is unset/);
      expect((await simpleGit(target).raw(["for-each-ref"])).trim()).toBe("");

      await expect(push({ enabled: true, url: target })).resolves.toContain(target);
      expect((await simpleGit(target).raw(["for-each-ref"])).trim()).not.toBe("");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  test("NON-VACUITY: the resolved target is what git is actually handed", async () => {
    // The two halves have to meet. `pushTargetFor` returning a URL proves
    // nothing unless `gitPush` pushes to it — so this drives the real call with
    // the resolved value and reads the commit back out of the bare repo at that
    // path, while a decoy `origin` points somewhere else entirely.
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "ost-config-remote-"));
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ambient-origin-"));
    await simpleGit(target).raw(["init", "--bare"]);
    await simpleGit(decoy).raw(["init", "--bare"]);
    try {
      await safeGit.gitInitIfAbsent(dir);
      // Ambient state, of exactly the kind that used to decide this.
      await simpleGit(dir).addRemote("origin", decoy);
      fs.writeFileSync(path.join(dir, "a.md"), "one");
      await safeGit.gitCommit(dir, "first");
      const branch = (await simpleGit(dir).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();

      const decision = safeGit.pushTargetFor({ enabled: true, url: target });
      expect(decision.push).toBe(true);
      await safeGit.gitPush(dir, decision.push ? decision.remote : "origin");

      expect((await simpleGit(target).raw(["rev-list", "--count", branch])).trim()).toBe("1");
      // and the ambient remote never received it
      const decoyRefs = (await simpleGit(decoy).raw(["for-each-ref"])).trim();
      expect(decoyRefs).toBe("");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
      fs.rmSync(decoy, { recursive: true, force: true });
    }
  });
});

describe("gitPush", () => {
  test("fast-forward pushes to a local bare remote", async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "ost-remote-"));
    await simpleGit(remote).raw(["init", "--bare"]);
    try {
      await safeGit.gitInitIfAbsent(dir);
      await simpleGit(dir).addRemote("origin", remote);
      fs.writeFileSync(path.join(dir, "a.md"), "one");
      await safeGit.gitCommit(dir, "first");
      // read the branch only after a commit exists
      const branch = (await simpleGit(dir).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      await expect(safeGit.gitPush(dir, "origin")).resolves.toBeUndefined();
      const remoteCount = (await simpleGit(remote).raw(["rev-list", "--count", branch])).trim();
      expect(remoteCount).toBe("1");
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });
});
