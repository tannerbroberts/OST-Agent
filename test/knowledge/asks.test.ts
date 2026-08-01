/**
 * The ask ledger (P2): append-only JSONL under `.ost-agent/asks/`, read as a
 * HISTORY, never last-record-wins — the same shape `actor-trust.ts` uses for the
 * trust ledger, copied on purpose (B5).
 *
 * Every test here is offline and clock-injected — `appendAsk` takes its `now` —
 * for the same reason `test/knowledge/actor-trust.test.ts` gives: an assertion
 * about "how many days stale" cannot afford to race the wall clock.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendAsk, askLedgerPath, latestAsk, readAskLedger } from "../../src/knowledge/asks.js";

let dir: string;
const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-asks-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("appendAsk", () => {
  test("writes one JSONL line, stamped from the injected clock", () => {
    appendAsk(dir, { test: "A test", by: "tanner", why: "needs a contract signature" }, at(0));
    const lines = fs.readFileSync(askLedgerPath(dir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ ts: T0.toISOString(), test: "A test", by: "tanner", why: "needs a contract signature" });
  });

  test("refuses an ask with no test named", () => {
    expect(() => appendAsk(dir, { test: "  ", by: "tanner", why: "because" }, at(0))).toThrow(/test/i);
  });

  test("refuses an unattributed ask", () => {
    expect(() => appendAsk(dir, { test: "A test", by: " ", why: "because" }, at(0))).toThrow(/attribution|who/i);
  });

  test("a second ask for the same test APPENDS — the record only grows", () => {
    appendAsk(dir, { test: "A test", by: "tanner", why: "first ask" }, at(0));
    appendAsk(dir, { test: "A test", by: "tanner", why: "re-asked after a bounce" }, at(1000));
    const lines = fs.readFileSync(askLedgerPath(dir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("readAskLedger / latestAsk", () => {
  test("no file on disk reads as an empty ledger, not an error", () => {
    expect(fs.existsSync(askLedgerPath(dir))).toBe(false);
    const ledger = readAskLedger(dir);
    expect(ledger.damaged).toBe(0);
    expect(latestAsk(ledger, "Anything")).toBeNull();
  });

  test("latestAsk returns the most recent record for that test, oldest-first internally", () => {
    appendAsk(dir, { test: "A test", by: "tanner", why: "first ask" }, at(0));
    appendAsk(dir, { test: "A test", by: "tanner", why: "second ask" }, at(1000));
    appendAsk(dir, { test: "Another test", by: "tanner", why: "unrelated" }, at(500));

    const ledger = readAskLedger(dir);
    expect(latestAsk(ledger, "A test")?.why).toBe("second ask");
    expect(latestAsk(ledger, "Another test")?.why).toBe("unrelated");
    expect(latestAsk(ledger, "Never asked")).toBeNull();
  });

  test("a damaged line is dropped and counted, not thrown on — the read must survive it", () => {
    fs.mkdirSync(path.dirname(askLedgerPath(dir)), { recursive: true });
    fs.writeFileSync(
      askLedgerPath(dir),
      "not json\n" + JSON.stringify({ ts: T0.toISOString(), test: "A test", by: "tanner", why: "ok" }) + "\n",
    );
    const ledger = readAskLedger(dir);
    expect(ledger.damaged).toBe(1);
    expect(latestAsk(ledger, "A test")).not.toBeNull();
  });

  test("a line missing its test name is dropped and counted", () => {
    fs.mkdirSync(path.dirname(askLedgerPath(dir)), { recursive: true });
    fs.writeFileSync(askLedgerPath(dir), JSON.stringify({ ts: T0.toISOString(), by: "tanner", why: "no test field" }) + "\n");
    const ledger = readAskLedger(dir);
    expect(ledger.damaged).toBe(1);
  });
});
