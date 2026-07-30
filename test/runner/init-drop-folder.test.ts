/**
 * W1 — the drop folder a new vault gets resolves OUTSIDE the vault root, so "may
 * write the drop folder" and "may write the tree" are different grants.
 *
 * The first assertion is the criterion's check, transcribed rather than
 * paraphrased: `path.relative(vaultDir, path.resolve(vaultDir,
 * loadConfig(vaultDir).adapters.inbox.path))` starts with `..`, for a vault created
 * by `init` with no hand editing. Everything else here is about the vaults that
 * already exist, which is the half a relocation usually breaks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { defaultConfigYaml } from "../../src/config/schema.js";
import { initVault } from "../../src/runner/init.js";
import { CHANNEL_ZERO, FRICTION_CHANNEL, resolveChannels } from "../../src/adapters/channels.js";

let parent: string;
let dir: string;
beforeEach(() => {
  // A parent of our own: the drop folder is a SIBLING of the vault, so the
  // cleanup has to own the level above it.
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-init-drop-"));
  dir = path.join(parent, "my-vault");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

describe("a vault created by init", () => {
  test("W1: its configured drop folder resolves outside the vault", async () => {
    await initVault(dir, "Reach ten returning operators.", "Retention");

    const relative = path.relative(dir, path.resolve(dir, loadConfig(dir).adapters.inbox.path));
    expect(relative.startsWith("..")).toBe(true);

    // The control the criterion needs: the same check over the historical
    // in-vault config does NOT start with `..`, so the assertion above is a
    // statement about where the folder is and not about `path.relative`.
    const legacy = path.join(parent, "legacy");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "ost.config.yaml"), defaultConfigYaml("X"), "utf8");
    const legacyRelative = path.relative(legacy, path.resolve(legacy, loadConfig(legacy).adapters.inbox.path));
    expect(legacyRelative.startsWith("..")).toBe(false);
  });

  test("the folder is named for the vault, so two vaults under one parent never share one", async () => {
    await initVault(dir, "A", "A");
    const other = path.join(parent, "other-vault");
    await initVault(other, "B", "B");

    const a = path.resolve(dir, loadConfig(dir).adapters.inbox.path);
    const b = path.resolve(other, loadConfig(other).adapters.inbox.path);
    expect(a).not.toBe(b);
    // Non-vacuity: both really are siblings of their vaults — the paths differ
    // because of the naming, not because one of them failed to escape.
    expect(path.dirname(a)).toBe(path.dirname(path.resolve(dir)));
    expect(path.dirname(b)).toBe(path.dirname(path.resolve(other)));
  });

  test("init creates the folder it told the operator to use", async () => {
    const result = await initVault(dir, "A", "A");
    // The operator is told an absolute path off the result, and that folder exists.
    expect(fs.existsSync(result.inboxDir)).toBe(true);
    expect(result.inboxConfined).toBe(true);
    expect(result.inboxDir).toBe(path.resolve(dir, loadConfig(dir).adapters.inbox.path));
    // …and the first-party friction folder, which stays inside so filings are committed
    expect(fs.existsSync(path.join(dir, ".ost-agent", FRICTION_CHANNEL))).toBe(true);
    // Non-vacuity: a folder that is not a channel is not created, so "exists" is
    // the resolver's doing rather than init making every directory it can think of.
    expect(fs.existsSync(path.join(dir, ".ost-agent", "not-a-channel"))).toBe(false);
  });

  /**
   * A refused channel gets no folder and is never read. `init` is what an operator
   * runs right after adding the entry, so silence here would make "refused" and
   * "working" the same observable at the moment they are looking.
   */
  test("a refused channel is reported by init rather than silently dropped", async () => {
    await initVault(dir, "A", "A");
    const cfg = fs.readFileSync(path.join(dir, "ost.config.yaml"), "utf8");
    fs.writeFileSync(
      path.join(dir, "ost.config.yaml"),
      cfg.replace(
        /(adapters:\n  inbox:\n)/,
        `$1    channels:\n      - name: support\n        path: ".ost-agent/support"\n`,
      ),
      "utf8",
    );
    const refused = await initVault(dir, "A", "A");
    expect(refused.channelProblems.join("\n")).toMatch(/support/);
    expect(refused.channelProblems.join("\n")).toMatch(/inside the vault/);
    // …and it really is not read: no folder was scaffolded for it.
    expect(fs.existsSync(path.join(dir, ".ost-agent", "support"))).toBe(false);
    // The refusal costs that channel and nothing else — the vault still initialises.
    expect(refused.inboxConfined).toBe(true);

    // Non-vacuity: the same channel pointed outside is accepted silently, so the
    // report is about the refusal and not something init always prints.
    fs.writeFileSync(
      path.join(dir, "ost.config.yaml"),
      cfg.replace(/(adapters:\n  inbox:\n)/, `$1    channels:\n      - name: support\n        path: "../support-drop"\n`),
      "utf8",
    );
    expect((await initVault(dir, "A", "A")).channelProblems).toEqual([]);
  });

  test("it creates a folder for an extra declared channel too", async () => {
    await initVault(dir, "A", "A");
    const cfg = fs.readFileSync(path.join(dir, "ost.config.yaml"), "utf8");
    fs.writeFileSync(
      path.join(dir, "ost.config.yaml"),
      `${cfg}\n# appended by the operator\n`.replace(
        /(adapters:\n  inbox:\n)/,
        `$1    channels:\n      - name: support\n        path: "../support-drop"\n`,
      ),
      "utf8",
    );
    // Re-running init adopts the vault rather than rewriting its config.
    await initVault(dir, "A", "A");
    expect(fs.existsSync(path.join(parent, "support-drop"))).toBe(true);
    expect(loadConfig(dir).adapters.inbox.channels.map((c) => c.name)).toEqual(["support"]);
  });
});

describe("a vault that already exists is adopted, never relocated", () => {
  /** Exactly what every shipped version left behind. */
  function legacyVault(): string {
    const legacy = path.join(parent, "legacy");
    fs.mkdirSync(path.join(legacy, ".ost-agent", "inbox"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "ost.config.yaml"), defaultConfigYaml("Old mandate", "Old"), "utf8");
    fs.writeFileSync(path.join(legacy, ".ost-agent", "inbox", "already.md"), "captured last month\n");
    return legacy;
  }

  test("re-running init leaves its in-vault drop folder exactly where it is", async () => {
    const legacy = legacyVault();
    const result = await initVault(legacy, "ignored — the config wins", "ignored");

    expect(loadConfig(legacy).adapters.inbox.path).toBe(".ost-agent/inbox");
    expect(result.inboxDir).toBe(path.join(legacy, ".ost-agent", "inbox"));
    expect(result.inboxConfined).toBe(false);
    // and the note that was already there is untouched
    expect(fs.existsSync(path.join(legacy, ".ost-agent", "inbox", "already.md"))).toBe(true);
    // Non-vacuity: a fresh vault under the same parent DOES get the escaping path,
    // so "not relocated" is adoption and not the feature failing to apply.
    await initVault(dir, "A", "A");
    expect(loadConfig(dir).adapters.inbox.path.startsWith("..")).toBe(true);
  });

  test("the grandfathered folder is named as unconfined and given a remedy", async () => {
    const legacy = legacyVault();
    await initVault(legacy, "x", "x");
    const zero = resolveChannels(legacy, loadConfig(legacy)).channels.find((c) => c.name === CHANNEL_ZERO);
    expect(zero?.confined).toBe(false);
    expect(zero?.origin).toBe("channel-zero");
  });

  test("a `.gitignore` line is appended for the grandfathered folder, and only once", async () => {
    const legacy = legacyVault();
    const first = await initVault(legacy, "x", "x");
    expect(first.gitignored).toBe(".ost-agent/inbox/");
    const after = fs.readFileSync(path.join(legacy, ".gitignore"), "utf8");
    expect(after).toContain(".ost-agent/inbox/");

    const second = await initVault(legacy, "x", "x");
    expect(second.gitignored).toBeUndefined();
    // Appended, never rewritten — and never twice.
    expect(fs.readFileSync(path.join(legacy, ".gitignore"), "utf8")).toBe(after);

    // Non-vacuity: a fresh vault, whose folder is already outside, gets no line
    // at all — so the append is a response to the grandfathered case.
    await initVault(dir, "A", "A");
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
  });
});
