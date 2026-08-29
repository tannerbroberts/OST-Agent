/**
 * Consent is load-bearing, not a promise.
 *
 * The instrument for "Will operators consent to shipping raw usage from their own
 * vault". It does NOT settle whether operators will consent — that is a person's
 * decision about their own data, the assumption test's own threshold (four of ten,
 * without a bespoke redaction feature) is unrun, and no exit code substitutes for
 * asking them. What it settles is the precondition, so that asking is safe to do:
 *
 *   1. The event log is local by default, with no outward path — recording an
 *      event reaches the operator's vault and nothing else, and no module the
 *      telemetry code can reach holds network capability at all.
 *   2. Raw export is refused unless a dated consent record exists in the vault.
 *   3. Revoking consent stops further export without touching what the operator
 *      already holds.
 *
 * And a fourth, which the node does not name but which the other three rest on:
 * consent is granted by a person, never by the agent. A pass that could append
 * its own grant has issued its own permit, and the first three properties would
 * then all be true of a system that ships everything anyway.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import {
  appendConsent,
  consentLedgerPath,
  ConsentRequiredError,
  exportRawUsage,
  hasConsent,
  readConsentLedger,
  standingConsent,
} from "../../src/telemetry/consent.js";
import { recordUsageEvent, usageLogPath, type UsageEvent } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let dir: string;

/** A fixed clock — `Date.now()` in a test is the flakiness CONTRIBUTING.md names. */
const at = (iso: string) => () => new Date(iso);

const event = (ts: string, tool: string): UsageEvent => ({
  ts,
  tool,
  ok: true,
  ms: 7,
  surface: "cli-tool",
  argBytes: 42,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-consent-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the log is local by default, with no outward path", () => {
  test("recording an event writes inside the vault and nowhere else", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));

    const log = usageLogPath(dir);
    expect(fs.existsSync(log)).toBe(true);
    // Everything the recorder produced is under the vault's own `.ost-agent`,
    // which is the operator's directory in the operator's git history.
    expect(path.relative(dir, log).split(path.sep)[0]).toBe(".ost-agent");
    // And nothing else has appeared in the vault — no outbox, no spool, no queue
    // that something else would later drain.
    expect(fs.readdirSync(path.join(dir, ".ost-agent"))).toEqual(["usage"]);
    expect(fs.readdirSync(path.join(dir, ".ost-agent", "usage"))).toEqual(["events.jsonl"]);
  });

  /**
   * A textual audit of the transitive local-import closure, and worth stating what
   * it can and cannot prove. It CAN prove no module reachable from the telemetry
   * code names a network API in code — the closure is walked, not just the folder,
   * because capability arrives through an import as easily as through a call. It
   * canNOT prove the absence of a dynamic `import()` of a computed specifier, or of
   * a caller elsewhere reading the log and posting it. The second is not this
   * test's to make impossible: the log is a file in the operator's vault and they
   * may do what they like with it. What must never exist is a path THIS code opens.
   */
  test("nothing the telemetry code can reach holds network capability", () => {
    const stripped = (src: string) =>
      src
        // Block comments then line comments, so prose that discusses `fetch` or
        // `node:http` — including this module's own header — is not read as code.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");

    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file) || !fs.existsSync(file)) return;
      seen.add(file);
      const code = stripped(fs.readFileSync(file, "utf8"));
      for (const m of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
        walk(path.resolve(path.dirname(file), m[1].replace(/\.js$/, ".ts")));
      }
    };
    walk(path.join(repoRoot, "src/telemetry/consent.ts"));
    walk(path.join(repoRoot, "src/telemetry/usage.ts"));
    // The walk found the closure, not just the two entry points.
    expect(seen.size).toBeGreaterThan(2);

    const offenders: string[] = [];
    for (const file of seen) {
      const code = stripped(fs.readFileSync(file, "utf8"));
      for (const pattern of [
        /from\s+"(node:)?(http|https|net|tls|dgram|http2)"/,
        /\bfetch\s*\(/,
        /\bnew\s+(WebSocket|XMLHttpRequest)\b/,
        /\bnavigator\.sendBeacon\b/,
      ]) {
        if (pattern.test(code)) offenders.push(`${path.relative(repoRoot, file)} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("exportRawUsage hands the bundle back rather than sending it", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    appendConsent(dir, { decision: "granted", by: "tanner" }, at("2026-08-29T09:30:00.000Z"));

    const bundle = exportRawUsage(dir, { now: at("2026-08-29T10:00:00.000Z") });

    // The operator's own hands are the transport: the return value IS the export,
    // and the vault gained no artifact from producing it.
    expect(bundle.events).toHaveLength(1);
    expect(bundle.exportedAt).toBe("2026-08-29T10:00:00.000Z");
    expect(fs.readdirSync(path.join(dir, ".ost-agent", "usage")).sort()).toEqual(["consent.jsonl", "events.jsonl"]);
  });
});

describe("raw export is refused without a dated consent record", () => {
  test("a vault nobody asked exports nothing", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    expect(fs.existsSync(consentLedgerPath(dir))).toBe(false);

    expect(() => exportRawUsage(dir)).toThrow(ConsentRequiredError);
    // The refusal names the command that clears it, so the operator is not left
    // guessing where consent is supposed to be written.
    expect(() => exportRawUsage(dir)).toThrow(/usage-consent grant/);
  });

  test("consent is dated and attributed, and the export carries it", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    recordUsageEvent(dir, event("2026-08-29T09:05:00.000Z", "ost_create_node"));
    const granted = appendConsent(
      dir,
      { decision: "granted", by: "tanner", note: "happy to send the raw trace" },
      at("2026-08-29T09:30:00.000Z"),
    );

    expect(granted.ts).toBe("2026-08-29T09:30:00.000Z");
    expect(granted.by).toBe("tanner");

    const bundle = exportRawUsage(dir, { now: at("2026-08-29T10:00:00.000Z") });
    expect(bundle.events.map((e) => e.tool)).toEqual(["ost_annotate", "ost_create_node"]);
    // Provenance survives the trip: a receiver holding raw events can say who
    // consented and when, without taking the sender's word for it.
    expect(bundle.consent).toEqual(granted);
    expect(bundle.scope).toBe("raw-usage");
  });

  test("a record that cannot be parsed licenses nothing", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    const file = consentLedgerPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A truncated append — the shape a crashed write or a merge conflict leaves.
    fs.writeFileSync(file, '{"ts":"2026-08-29T09:30:00.000Z","decision":"gran\n', "utf8");

    const ledger = readConsentLedger(dir);
    expect(ledger.damaged).toBe(1);
    expect(hasConsent(ledger)).toBe(false);
    // Fails CLOSED, unlike the suppression ledger: the cost of misreading here is
    // somebody's raw trace leaving their machine.
    expect(() => exportRawUsage(dir)).toThrow(ConsentRequiredError);
    expect(() => exportRawUsage(dir)).toThrow(/could not parse/);
  });

  test("an unsigned or out-of-vocabulary record is refused at the write funnel", () => {
    expect(() => appendConsent(dir, { decision: "granted", by: "  " })).toThrow(/attribution/);
    expect(() => appendConsent(dir, { decision: "maybe", by: "tanner" })).toThrow(/granted or revoked/);
    expect(() => appendConsent(dir, { decision: "granted", scope: "everything", by: "tanner" })).toThrow(/raw-usage/);
    // Nothing reached the ledger, so a refused write cannot half-license anything.
    expect(fs.existsSync(consentLedgerPath(dir))).toBe(false);
  });
});

describe("revoking stops further export and touches nothing already held", () => {
  test("after revocation the export is refused, and the operator keeps every event", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    appendConsent(dir, { decision: "granted", by: "tanner" }, at("2026-08-29T09:30:00.000Z"));
    expect(exportRawUsage(dir, { now: at("2026-08-29T10:00:00.000Z") }).events).toHaveLength(1);

    const logBefore = fs.readFileSync(usageLogPath(dir), "utf8");

    appendConsent(dir, { decision: "revoked", by: "tanner", note: "changed my mind" }, at("2026-08-29T11:00:00.000Z"));

    expect(() => exportRawUsage(dir)).toThrow(ConsentRequiredError);
    expect(() => exportRawUsage(dir)).toThrow(/revoked on 2026-08-29T11:00:00.000Z/);

    // Withdrawing consent means "stop giving it to me", not "destroy your own
    // records" — the log is byte-for-byte what it was, and still collecting.
    expect(fs.readFileSync(usageLogPath(dir), "utf8")).toBe(logBefore);
    recordUsageEvent(dir, event("2026-08-29T11:05:00.000Z", "ost_annotate"));
    expect(fs.readFileSync(usageLogPath(dir), "utf8").trim().split("\n")).toHaveLength(2);
  });

  test("revocation is an append, so the grant it supersedes stays readable", () => {
    appendConsent(dir, { decision: "granted", by: "tanner" }, at("2026-08-29T09:30:00.000Z"));
    appendConsent(dir, { decision: "revoked", by: "tanner" }, at("2026-08-29T11:00:00.000Z"));

    const ledger = readConsentLedger(dir);
    expect(ledger.records.map((r) => r.decision)).toEqual(["granted", "revoked"]);
    expect(standingConsent(ledger)?.decision).toBe("revoked");
    expect(hasConsent(ledger)).toBe(false);
  });

  test("granting again after a revocation re-licenses the export", () => {
    recordUsageEvent(dir, event("2026-08-29T09:00:00.000Z", "ost_annotate"));
    appendConsent(dir, { decision: "granted", by: "tanner" }, at("2026-08-29T09:30:00.000Z"));
    appendConsent(dir, { decision: "revoked", by: "tanner" }, at("2026-08-29T11:00:00.000Z"));
    const regranted = appendConsent(dir, { decision: "granted", by: "tanner" }, at("2026-08-30T08:00:00.000Z"));

    const bundle = exportRawUsage(dir, { now: at("2026-08-30T08:01:00.000Z") });
    // The licence is the LATEST record, not the first one ever written.
    expect(bundle.consent).toEqual(regranted);
  });
});

describe("consent is a person's to give", () => {
  test("no tool on the agent's surface can write a consent record", () => {
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/consent/i);
    }
  });

  test("the write path lives on the CLI, not in the tool builder", () => {
    // Same shape as `dispose`, `result` and `promote`: the grant is typed by a
    // person into a terminal. Asserted against the source rather than the docs,
    // because a comment saying "human-only" is not a mechanism.
    const cli = fs.readFileSync(path.join(repoRoot, "src/cli/index.ts"), "utf8");
    expect(cli).toContain('.command("usage-consent")');
    const tools = fs.readFileSync(path.join(repoRoot, "src/security/tools.ts"), "utf8");
    expect(tools).not.toMatch(/appendConsent/);
  });
});
