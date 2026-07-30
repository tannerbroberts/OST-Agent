/**
 * S2 — **every** commissioned channel is enumerable, and its silence is detectable.
 *
 * The criterion asks for "a read-only command", and both halves of that are
 * asserted here through the real CLI: the verdict is a process exit code (the only
 * kind an unattended wrapper can act on), and running it leaves the vault
 * byte-identical (a reporting command that writes the thing it reports on is not a
 * report).
 *
 * "Every" is the word this file now has to earn. `transcript`, `usage`, `atlassian`
 * and `slack` are commissioned channels with their own cursor records, so a report
 * covering the drop folders alone left four pipelines whose death had no observable
 * at all — and it is the *pipelines* that die quietly, since a drop folder failing
 * usually means a person stopped writing notes and knows it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { saveCursor } from "../../src/adapters/source.js";
import { allChannels, channelHealth } from "../../src/adapters/channels.js";
import { buildPassContext } from "../../src/runner/context.js";

// The local tsx binary, invoked directly rather than through `npx`: `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

let parent: string;
let dir: string;

beforeEach(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-chan-"));
  dir = path.join(parent, "vault");
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

/** Exit code + stdout, without execFile's throw-on-nonzero getting in the way. */
async function channels(env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string }> {
  const opts = { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, ...env } };
  try {
    const { stdout } = await run(TSX, [CLI, "channels", "--vault", dir], opts);
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function declareCadence(cadence: string) {
  const cfg = fs.readFileSync(path.join(dir, "ost.config.yaml"), "utf8");
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    cfg.replace(/(adapters:\n  inbox:\n    enabled: true\n)/, `$1    cadence: ${JSON.stringify(cadence)}\n`),
    "utf8",
  );
}

function writeConfig(adapters: string) {
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    `outcome: "Reach ten returning operators."\noutcomeTitle: "Retention"\nadapters:\n${adapters}`,
    "utf8",
  );
}

/** Channel name → the status the report printed for it. */
function statuses(out: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const block of out.split("\n\n")) {
    const name = /^\[([a-z0-9-]+)\]/.exec(block)?.[1];
    const status = /\n\s*status: (\S+)/.exec(block)?.[1];
    if (name && status) found[name] = status;
  }
  return found;
}

const DAY = 24 * 60 * 60 * 1000;
const item = (id: string) => ({ id, source: id, title: id, body: "b", timestamp: "2026-01-01T00:00:00.000Z" });

/** Every file under the vault, with its bytes — the read-only assertion's subject. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.name === ".git") continue; // git's own bookkeeping is not the vault
      if (entry.isDirectory()) walk(p);
      else out[path.relative(root, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(root);
  return out;
}

describe("ost-agent channels", () => {
  test("lists every channel with where it points and when it last delivered", async () => {
    const { code, out } = await channels();
    expect(code).toBe(0);
    expect(out).toMatch(/\[inbox\]/);
    expect(out).toMatch(/\[friction\]/);
    // the escaping path an init'ed vault actually got, named so it is recognisable
    expect(out).toContain(path.resolve(dir, "../vault.inbox"));
    expect(out).toMatch(/last delivered/);
  });

  /**
   * The enumeration half of the criterion. A default vault commissions six
   * channels; a report that names three of them cannot be the thing that tells an
   * operator a pipeline died, because it never mentions four of the pipelines.
   */
  test("names every commissioned channel, not only the drop folders", async () => {
    const { out } = await channels();
    for (const name of ["inbox", "friction", "transcript", "usage", "atlassian", "slack"]) {
      expect(Object.keys(statuses(out)), `${name} must be enumerated`).toContain(name);
    }
    // Non-vacuity: the parser reads real blocks, not any word in the text — a name
    // nothing declares is absent from the same map.
    expect(Object.keys(statuses(out))).not.toContain("support");
  });

  /**
   * The distinction the criterion exists to destroy, in one run: five channels,
   * five different answers, none of them collapsible into "nothing to report".
   *
   * Collapsing any pair here is a specific failure. "turned off" read as quiet
   * sends the operator to look at a producer they themselves disconnected;
   * "unavailable" read as quiet sends them to look at a producer that is working;
   * "undated" read as silent flags every vault as dead the day it upgrades.
   */
  test("disabled, unavailable, silent, undated and live are five distinct named states", async () => {
    writeConfig(
      `  inbox:\n    enabled: true\n    path: "../${path.basename(dir)}.inbox"\n    cadence: "1d"\n` +
        `  transcript:\n    enabled: true\n` + // enabled, but no path and no projectDir
        `  usage:\n    enabled: true\n` +
        `  atlassian:\n    enabled: false\n` +
        `  slack:\n    enabled: false\n`,
    );
    // inbox: delivered once, two days ago, over a one-day cadence.
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 2 * DAY) });
    // usage: delivered a minute ago.
    saveCursor(dir, "usage", "c", { delivered: [item("USAGE:2026-01-01")], now: new Date() });
    // friction: a state file from before channels carried timestamps.
    fs.writeFileSync(
      path.join(dir, ".ost-agent", "state", "friction.json"),
      JSON.stringify({ cursor: "[]" }),
      "utf8",
    );

    const { code, out } = await channels({ SLACK_BOT_TOKEN: undefined });
    const s = statuses(out);
    expect(s.atlassian).toBe("disabled");
    expect(s.transcript).toBe("unavailable");
    expect(s.inbox).toBe("silent");
    expect(s.friction).toBe("undated");
    expect(s.usage).toBe("live");
    // Five answers, five words — the assertion the criterion actually turns on.
    expect(new Set([s.atlassian, s.transcript, s.inbox, s.friction, s.usage]).size).toBe(5);

    // The verdict an unattended wrapper reads. Both a silent channel and an
    // enabled-but-unrunnable one are non-zero; the report says which is which.
    expect(code).toBe(1);
    expect(out).toMatch(/enabled and CANNOT run: transcript/);
    expect(out).toMatch(/past declared cadence: inbox/);
  });

  /**
   * The one that a report covering drop folders only could never have said: a
   * commissioned pipeline with a revoked credential is neither off nor quiet.
   */
  test("a credential that is present makes the same channel stop being unavailable", async () => {
    writeConfig(`  inbox:\n    enabled: true\n  slack:\n    enabled: true\n    channels: ["general"]\n`);

    const missing = await channels({ SLACK_BOT_TOKEN: undefined });
    expect(statuses(missing.out).slack).toBe("unavailable");
    expect(missing.out).toMatch(/SLACK_BOT_TOKEN/);
    expect(missing.code).toBe(1);

    // Non-vacuity: nothing about the config changed, only the environment — so the
    // verdict is about the credential and not about Slack being reported broken
    // whenever it is switched on.
    const present = await channels({ SLACK_BOT_TOKEN: "xoxb-not-a-real-token" });
    expect(statuses(present.out).slack).not.toBe("unavailable");
    expect(present.code).toBe(0);

    // …and turning it off is a third answer again, not a return to the first.
    writeConfig(`  inbox:\n    enabled: true\n  slack:\n    enabled: false\n`);
    const off = await channels({ SLACK_BOT_TOKEN: undefined });
    expect(statuses(off.out).slack).toBe("disabled");
    expect(off.code).toBe(0);
  });

  test("exits 1 when a channel is past its declared cadence, and 0 when it is not", async () => {
    declareCadence("1d");
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 2 * DAY) });

    const stale = await channels();
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/past declared cadence: inbox/);

    // Non-vacuity, half one: a fresh DELIVERY over the same declared cadence exits 0.
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:b.md")], now: new Date() });
    const fresh = await channels();
    expect(fresh.code).toBe(0);
    expect(fresh.out).toMatch(/No channel is past/);
  });

  /** The distinction the criterion exists for, driven end to end. */
  test("a healthy poller over a dead channel still exits 1", async () => {
    declareCadence("1d");
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 4 * DAY) });
    // …and then keeps fetching, successfully, delivering nothing. Right now.
    saveCursor(dir, "inbox", "c", { delivered: [], now: new Date() });

    const { code, out } = await channels();
    expect(code).toBe(1);
    expect(out).toMatch(/SILENT/);
  });

  test("a channel with no declared cadence is never flagged, however old it is", async () => {
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 400 * DAY) });
    const { code, out } = await channels();
    expect(code).toBe(0);
    expect(out).toMatch(/never reported silent/);
  });

  test("it writes nothing — the vault is byte-identical after the report", async () => {
    // Every state the report can reach, in one run: a silent drop folder AND an
    // enabled-but-unrunnable pipeline. A read-only claim asserted only over the
    // quiet path says nothing about the paths that have something to say.
    writeConfig(
      `  inbox:\n    enabled: true\n    path: "../${path.basename(dir)}.inbox"\n    cadence: "1d"\n` +
        `  transcript:\n    enabled: true\n` +
        `  slack:\n    enabled: true\n`,
    );
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 2 * DAY) });
    const before = snapshot(dir);
    const { code, out } = await channels({ SLACK_BOT_TOKEN: undefined });
    expect(code).toBe(1); // it really did the work whose side effects we are denying
    expect(statuses(out).slack).toBe("unavailable");
    expect(snapshot(dir)).toEqual(before);

    // Non-vacuity: the snapshot can see a change at all.
    fs.writeFileSync(path.join(dir, "Planted.md"), "x\n");
    expect(snapshot(dir)).not.toEqual(before);
  });

  /**
   * G1, on the surface it matters most for: a broken `ost.config.yaml` is the most
   * likely reason somebody runs this command, so it is the one command that must not
   * die of it. It reports the line that broke, lists no channels — schema defaults
   * here would show a drop folder the operator never wrote — and still exits
   * non-zero, because a report that could not be produced is not a clean report.
   */
  test("a broken config is reported, not thrown, and still exits non-zero", async () => {
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: X\nadapters:\n  inbox:\n    cadence: soon\n", "utf8");
    const { code, out } = await channels();
    expect(code).toBe(1);
    expect(out).toMatch(/cadence/);
    expect(out).toMatch(/could not be read/);
    // The defaults are a fallback, not a substitute — no invented channel list, and
    // that goes for the commissioned channels too: `usage` is on by default, and
    // listing it from defaults would claim a channel this vault may not run.
    expect(out).not.toMatch(/\[inbox\]/);
    expect(out).not.toMatch(/\[usage\]/);

    // Non-vacuity: repair the same file and the same command lists channels and
    // exits 0, so the failure above is about the file and not about this command
    // having stopped working.
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), 'outcome: X\nadapters:\n  inbox:\n    cadence: "7d"\n', "utf8");
    const fixed = await channels();
    expect(fixed.code).toBe(0);
    expect(fixed.out).toMatch(/\[inbox\]/);
    expect(fixed.out).toMatch(/\[usage\]/);
  });

  /**
   * The ranking between the two ailing states, which no config can currently
   * produce: the four commissioned pipelines carry no `cadence` key in
   * `src/config/schema.ts`, so nothing today can be unavailable AND past a cadence
   * at once. It becomes reachable the moment that key is added, and the order is the
   * whole point of having two words — a revoked token is past any cadence you like,
   * and calling that channel `silent` sends the operator to inspect a producer that
   * is working fine. Asserted here rather than through the CLI because the CLI
   * cannot yet express the state; the report's own function can.
   */
  test("unavailable outranks the age: a channel that is both reports unavailable", () => {
    saveCursor(dir, "inbox", "c", { delivered: [item("INBOX:a.md")], now: new Date(Date.now() - 30 * DAY) });
    const base = {
      name: "inbox",
      declaredPath: "adapters.inbox",
      enabled: true,
      cadence: "1d",
      origin: "channel-zero" as const,
      dir,
      confined: true,
    };

    const broken = channelHealth(dir, [{ ...base, unavailable: "its token was revoked a month ago" }])[0];
    expect(broken.status).toBe("unavailable");
    // The stamps still ride along, so "it was delivering right up until the token
    // went" stays readable — that is what makes the remedy actionable.
    expect(broken.lastItemAt).toBeDefined();

    // Non-vacuity: the identical channel WITHOUT the unavailability reads silent, so
    // the answer above is the ranking and not a channel that can never read silent.
    expect(channelHealth(dir, [base])[0].status).toBe("silent");
  });

  test("run against a directory that is not a vault, it creates nothing", async () => {
    const empty = path.join(parent, "not-a-vault");
    fs.mkdirSync(empty);
    const result = await run(TSX, [CLI, "channels", "--vault", empty], {
      cwd: path.resolve(__dirname, "../.."),
    }).catch((e: { stderr?: string }) => ({ stdout: "", stderr: e.stderr ?? "" }));
    expect(`${result.stdout}${"stderr" in result ? result.stderr : ""}`).toMatch(/ost-agent init/);
    // A reporting command must not scaffold the thing it failed to find.
    expect(fs.readdirSync(empty)).toEqual([]);
  });
});

/**
 * The report's availability probe and `buildSources` are two implementations of one
 * question, and they are separate on purpose — the report must not construct
 * sources, because it runs against a vault it may not touch and a config it may not
 * be able to parse. That leaves drift as the standing risk: a report that calls a
 * channel healthy when no pass can run it is exactly the "success and failure share
 * one observable" shape S2 exists to end.
 *
 * So the two are pinned together here, channel by channel, over the switches and
 * credentials that decide it. An adapter added to one and not the other fails here.
 */
describe("the report's verdict agrees with what a pass can actually build", () => {
  const CREDENTIALS = ["SLACK_BOT_TOKEN", "ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(CREDENTIALS.map((k) => [k, process.env[k]]));
    for (const k of CREDENTIALS) delete process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  type Verdict = "disabled" | "unavailable" | "available";
  const CASES: { channel: string; adapters: string; env?: Record<string, string>; expect: Verdict }[] = [
    { channel: "transcript", adapters: "  transcript:\n    enabled: false\n", expect: "disabled" },
    { channel: "transcript", adapters: "  transcript:\n    enabled: true\n", expect: "unavailable" },
    { channel: "transcript", adapters: '  transcript:\n    enabled: true\n    projectDir: "/tmp/some-repo"\n', expect: "available" },
    { channel: "usage", adapters: "  usage:\n    enabled: false\n", expect: "disabled" },
    { channel: "usage", adapters: "  usage:\n    enabled: true\n", expect: "available" },
    { channel: "slack", adapters: "  slack:\n    enabled: false\n", expect: "disabled" },
    { channel: "slack", adapters: "  slack:\n    enabled: true\n", expect: "unavailable" },
    { channel: "slack", adapters: "  slack:\n    enabled: true\n", env: { SLACK_BOT_TOKEN: "xoxb-x" }, expect: "available" },
    { channel: "atlassian", adapters: "  atlassian:\n    enabled: false\n", expect: "disabled" },
    { channel: "atlassian", adapters: "  atlassian:\n    enabled: true\n", expect: "unavailable" },
    // Two of three set is still unavailable — the probe must read the same
    // conjunction `buildSources` does, not merely "some Atlassian variable exists".
    {
      channel: "atlassian",
      adapters: "  atlassian:\n    enabled: true\n",
      env: { ATLASSIAN_BASE_URL: "https://x.atlassian.net", ATLASSIAN_EMAIL: "a@b.c" },
      expect: "unavailable",
    },
    {
      channel: "atlassian",
      adapters: "  atlassian:\n    enabled: true\n",
      env: { ATLASSIAN_BASE_URL: "https://x.atlassian.net", ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "t" },
      expect: "available",
    },
  ];

  test("every commissioned channel, over every switch and credential that decides it", () => {
    const seen = new Set<Verdict>();
    for (const c of CASES) {
      writeConfig(c.adapters);
      for (const [k, v] of Object.entries(c.env ?? {})) process.env[k] = v;

      const ctx = buildPassContext(dir);
      const built = ctx.sources.some((s) => s.name === c.channel);
      const entry = ctx.unavailableSources.find((u) => u.name === c.channel);
      const health = channelHealth(dir, allChannels(dir, ctx.config).channels).find((h) => h.name === c.channel);
      const label = `${c.channel} expecting ${c.expect}`;

      if (c.expect === "available") {
        expect(built, label).toBe(true);
        expect(entry, label).toBeUndefined();
        expect(["disabled", "unavailable"], label).not.toContain(health?.status);
      } else {
        expect(built, label).toBe(false);
        expect(entry?.kind, label).toBe(c.expect);
        expect(health?.status, label).toBe(c.expect);
      }
      seen.add(c.expect);

      for (const k of Object.keys(c.env ?? {})) delete process.env[k];
    }
    // Non-vacuity: all three verdicts really occurred, so the loop is not asserting
    // one answer twelve times.
    expect([...seen].sort()).toEqual(["available", "disabled", "unavailable"]);
  });
});
