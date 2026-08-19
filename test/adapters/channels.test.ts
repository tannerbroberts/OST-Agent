/**
 * `resolveChannels` — the one place drop-folder back-compat lives — and the
 * silence verdict built on top of it (S2).
 *
 * The assertions that matter most here are the negative ones: an existing vault's
 * `adapters.inbox` must resolve to exactly the folder it always did, and a channel
 * with no declared cadence must never be reported dead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";
import {
  CHANNEL_ZERO,
  DEPOSIT_CHANNEL,
  FRICTION_CHANNEL,
  RETROSPECTIVE_CHANNEL,
  channelHealth,
  channelIdPrefix,
  isInsideVault,
  renderChannels,
  resolveChannels,
  silentChannels,
} from "../../src/adapters/channels.js";
import { saveCursor } from "../../src/adapters/source.js";

let dir: string;
let outside: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-chan-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "ost-chan-out-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function config(raw: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ outcome: "X", ...raw });
}

const DAY = 24 * 60 * 60 * 1000;
const item = (id: string) => ({ id, source: id, title: id, body: "b", timestamp: "2026-01-01T00:00:00.000Z" });

describe("channel zero is the key every existing vault already carries", () => {
  test("a config with no adapters key at all resolves the historical folder", () => {
    const { channels, problems } = resolveChannels(dir, config());
    const zero = channels.find((c) => c.name === CHANNEL_ZERO);
    expect(problems).toEqual([]);
    expect(zero?.dir).toBe(path.join(dir, ".ost-agent", "inbox"));
    expect(zero?.enabled).toBe(true);
    // Non-vacuity: the resolver really reads the config — a different path lands
    // somewhere different rather than always producing the default.
    const moved = resolveChannels(dir, config({ adapters: { inbox: { path: "../elsewhere" } } }));
    expect(moved.channels.find((c) => c.name === CHANNEL_ZERO)?.dir).toBe(path.resolve(dir, "../elsewhere"));
  });

  /**
   * The grandfather clause, and the asymmetry that makes the safety property
   * enforceable without breaking a single existing vault.
   */
  test("an inside-vault channel zero is accepted and labelled; an inside-vault NEW channel is refused", () => {
    const grandfathered = resolveChannels(dir, config());
    const zero = grandfathered.channels.find((c) => c.name === CHANNEL_ZERO);
    expect(zero?.confined).toBe(false); // inside the vault
    expect(grandfathered.problems).toEqual([]); // accepted, not refused

    const refused = resolveChannels(
      dir,
      config({ adapters: { inbox: { channels: [{ name: "support", path: ".ost-agent/support" }] } } }),
    );
    expect(refused.channels.map((c) => c.name)).not.toContain("support");
    expect(refused.problems.join("\n")).toMatch(/support/);
    expect(refused.problems.join("\n")).toMatch(/inside the vault/);

    // Non-vacuity: the same new channel pointed OUTSIDE is accepted, so the
    // refusal is about confinement rather than about the key being rejected.
    const ok = resolveChannels(dir, config({ adapters: { inbox: { channels: [{ name: "support", path: outside }] } } }));
    expect(ok.problems).toEqual([]);
    expect(ok.channels.find((c) => c.name === "support")?.confined).toBe(true);
  });

  test("a refused channel costs only itself — channel zero survives it", () => {
    const { channels, problems } = resolveChannels(
      dir,
      config({ adapters: { inbox: { channels: [{ name: "support", path: ".ost-agent/support" }] } } }),
    );
    expect(problems).toHaveLength(1);
    expect(channels.map((c) => c.name)).toEqual([CHANNEL_ZERO, FRICTION_CHANNEL, DEPOSIT_CHANNEL, RETROSPECTIVE_CHANNEL]);
  });

  test("the friction channel is first-party, inside the vault, and follows the inbox switch", () => {
    const friction = resolveChannels(dir, config()).channels.find((c) => c.name === FRICTION_CHANNEL);
    // Inside on purpose: a filing written outside the git working tree would stop
    // being committed by the vault's own `git add -A`.
    expect(friction?.confined).toBe(false);
    expect(friction?.dir).toBe(path.join(dir, ".ost-agent", "friction"));
    expect(friction?.origin).toBe("first-party");
    // Non-vacuity: it is not unconditionally enabled.
    const off = resolveChannels(dir, config({ adapters: { inbox: { enabled: false } } }));
    expect(off.channels.find((c) => c.name === FRICTION_CHANNEL)?.enabled).toBe(false);
  });
});

describe("confinement is decided through symlinks, not lexically", () => {
  test("a symlink that points back into the vault is not outside it", () => {
    const link = path.join(outside, "looks-outside");
    fs.mkdirSync(path.join(dir, ".ost-agent"), { recursive: true });
    fs.symlinkSync(path.join(dir, ".ost-agent"), link, "dir");
    // Lexically `link` is outside the vault; really it is the vault's own folder.
    expect(path.relative(dir, link).startsWith("..")).toBe(true);
    expect(isInsideVault(dir, link)).toBe(true);
    // Non-vacuity: a genuinely outside folder in the same parent reads as outside.
    expect(isInsideVault(dir, path.join(outside, "genuinely-elsewhere"))).toBe(false);
  });

  test("a folder that does not exist yet is judged by where its parent really is", () => {
    const link = path.join(outside, "into-vault");
    fs.symlinkSync(dir, link, "dir");
    expect(isInsideVault(dir, path.join(link, "not-created-yet"))).toBe(true);
  });
});

describe("id namespaces", () => {
  test("channel zero's id shape is frozen and every other channel is prefixed", () => {
    // If `INBOX:note.md` ever became `INBOX:inbox/note.md`, every existing cursor
    // (a JSON set of ids) would stop matching and every note in every existing
    // vault would re-ingest. That is a data event, not a refactor.
    expect(channelIdPrefix(CHANNEL_ZERO)).toBe("INBOX:");
    expect(channelIdPrefix("support")).toBe("INBOX:support/");
    // The friction channel's ids still contain the word `friction`, which is what
    // today's above-floor inbox rule keys on — so its behaviour is unchanged.
    expect(channelIdPrefix(FRICTION_CHANNEL)).toBe("INBOX:friction/");
  });

  test("a name that could escape the state directory cannot mint ids either", () => {
    expect(() => channelIdPrefix("../../etc")).toThrow(/channel name/);
    // Non-vacuity: a legal name does not throw.
    expect(channelIdPrefix("a-1")).toBe("INBOX:a-1/");
  });
});

describe("silence is read off deliveries, never off fetches (S2)", () => {
  function channelWithCadence(cadence: string | null) {
    return resolveChannels(dir, config({ adapters: { inbox: { path: outside, ...(cadence ? { cadence } : {}) } } }))
      .channels.filter((c) => c.name === CHANNEL_ZERO);
  }

  test("a channel past its declared cadence is flagged; the same channel with no cadence never is", () => {
    const now = Date.now();
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:a.md")], now: new Date(now - 2 * DAY) });

    const flagged = channelHealth(dir, channelWithCadence("1d"), { now });
    expect(flagged[0].status).toBe("silent");
    expect(silentChannels(flagged).map((h) => h.name)).toEqual([CHANNEL_ZERO]);

    // The control the criterion turns on: same state file, no declared cadence,
    // never flagged. Nobody but the operator can say what dead means for a channel.
    const undeclared = channelHealth(dir, channelWithCadence(null), { now });
    expect(undeclared[0].status).toBe("live");
    expect(silentChannels(undeclared)).toEqual([]);
  });

  /**
   * The whole criterion in one assertion: a healthy poller over a dead pipeline
   * advances `lastFetchedAt` forever. If silence were computed off that, a dead
   * channel and an idle one would be the same observable.
   */
  test("a fresh fetch over a stale delivery still reads silent", () => {
    const now = Date.now();
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:a.md")], now: new Date(now - 5 * DAY) });
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [], now: new Date(now - 60_000) });

    const [health] = channelHealth(dir, channelWithCadence("1d"), { now });
    expect(health.lastFetchedAt).toBeDefined();
    expect(Date.parse(health.lastFetchedAt as string)).toBeGreaterThan(now - 2 * 60_000);
    expect(health.status).toBe("silent");

    // Non-vacuity: a fresh DELIVERY over the same channel reads live, so the
    // verdict is not simply "always silent once a cadence is declared".
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:b.md")], now: new Date(now - 60_000) });
    expect(channelHealth(dir, channelWithCadence("1d"), { now })[0].status).toBe("live");
  });

  test("a channel that has fetched and never delivered ages, and can go silent", () => {
    const now = Date.now();
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [], now: new Date(now - 3 * DAY) });
    // Configured and never once productive is the most likely real failure; it must
    // not read as "no news yet".
    expect(channelHealth(dir, channelWithCadence(null), { now })[0].status).toBe("never-delivered");
    expect(channelHealth(dir, channelWithCadence("1d"), { now })[0].status).toBe("silent");
    // Non-vacuity: within the cadence it is not silent.
    expect(channelHealth(dir, channelWithCadence("30d"), { now })[0].status).toBe("never-delivered");
  });

  test("a pre-timestamp state file reads `undated`, never `silent`", () => {
    const now = Date.now();
    fs.mkdirSync(path.join(dir, ".ost-agent", "state"), { recursive: true });
    // Exactly what every shipped version wrote until this change.
    fs.writeFileSync(path.join(dir, ".ost-agent", "state", "inbox.json"), JSON.stringify({ cursor: "[]" }), "utf8");

    const [health] = channelHealth(dir, channelWithCadence("1d"), { now });
    expect(health.status).toBe("undated");
    expect(silentChannels([health])).toEqual([]);

    // Non-vacuity: the same channel with a stale delivery DOES read silent, so
    // `undated` is a decision about the missing stamp and not a blanket amnesty.
    saveCursor(dir, CHANNEL_ZERO, "[]", { delivered: [item("INBOX:a.md")], now: new Date(now - 9 * DAY) });
    expect(channelHealth(dir, channelWithCadence("1d"), { now })[0].status).toBe("silent");
  });

  test("a never-fetched channel says so rather than borrowing a verdict", () => {
    const [health] = channelHealth(dir, channelWithCadence("1d"), { now: Date.now() });
    expect(health.status).toBe("never-fetched");
    expect(health.reason).toMatch(/never fetched/);
  });

  test("a disabled channel is reported as off, not as dead", () => {
    const off = resolveChannels(dir, config({ adapters: { inbox: { enabled: false, cadence: "1d" } } })).channels;
    const health = channelHealth(dir, off, { now: Date.now() });
    expect(health.every((h) => h.status === "disabled")).toBe(true);
    expect(silentChannels(health)).toEqual([]);
  });

  /**
   * `src/loop/cadence.ts`'s argument, verbatim: a future stamp otherwise pins a
   * channel "fresh" until the wall clock catches up, clearable only by hand-editing
   * a state file.
   */
  test("a delivery stamped in the future is ignored for the age and reported separately", () => {
    const now = Date.now();
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:a.md")], now: new Date(now - 9 * DAY) });
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:b.md")], now: new Date(now + 30 * DAY) });

    const [health] = channelHealth(dir, channelWithCadence("1d"), { now });
    expect(health.ignoredFuture).toBeGreaterThan(0);
    expect(health.status).toBe("silent"); // the future stamp did not buy freshness
    // Non-vacuity: without the future stamp the same channel is silent for the same
    // reason, and with a fresh REAL delivery it is live — so `ignoredFuture` is the
    // only thing the future record changed.
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:c.md")], now: new Date(now - 60_000) });
    expect(channelHealth(dir, channelWithCadence("1d"), { now })[0].status).toBe("live");
  });
});

describe("the report", () => {
  test("names the silent channel and says what to do about it", () => {
    const now = Date.now();
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:a.md")], now: new Date(now - 4 * DAY) });
    const channels = resolveChannels(dir, config({ adapters: { inbox: { path: outside, cadence: "1d" } } })).channels;
    const text = renderChannels({ health: channelHealth(dir, channels, { now }) });
    expect(text).toMatch(/\[inbox\]/);
    expect(text).toMatch(/past declared cadence/);
    // Non-vacuity: a live channel produces the opposite trailer.
    saveCursor(dir, CHANNEL_ZERO, "c", { delivered: [item("INBOX:b.md")], now: new Date(now - 60_000) });
    expect(renderChannels({ health: channelHealth(dir, channels, { now }) })).toMatch(/No channel is past/);
  });

  test("on a config problem it lists nothing rather than listing defaults nobody wrote", () => {
    const text = renderChannels({ health: [], problems: ["ost.config.yaml is not valid YAML"] });
    expect(text).toMatch(/not valid YAML/);
    expect(text).toMatch(/could not be read/);
    expect(text).not.toMatch(/\.ost-agent\/inbox/);
  });
});
