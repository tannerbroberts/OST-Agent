/**
 * The per-host trust map: append-only jsonl, last record wins, `expert` is
 * the ceiling for publisher identity — observed/money can only be earned by
 * first-party measurement, never by a byline.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hostTrustPath, normalizeHost, rankHost, readHostTrust, hostRung } from "../../src/knowledge/web-trust.js";
import { classifyProvenance } from "../../src/knowledge/believability.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-trust-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeHost", () => {
  test("lowercases, strips scheme/path/port/www", () => {
    expect(normalizeHost("https://Blog.Example.org:443/post?x=1")).toBe("blog.example.org");
    expect(normalizeHost("www.example.com")).toBe("example.com");
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });
});

describe("rankHost / readHostTrust", () => {
  test("appends records; last one wins; file is jsonl under .ost-agent/trust", () => {
    rankHost(dir, { host: "example.com", rung: "expert", reason: "acquisition claim corroborated by our own funnel test", by: "agent:mcp" });
    rankHost(dir, { host: "example.com", rung: "assertion", reason: "second claim failed replication", by: "agent:mcp" });
    const lines = fs.readFileSync(hostTrustPath(dir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2); // append-only: both records survive
    expect(readHostTrust(dir).get("example.com")).toBe("assertion");
  });

  test("refuses rungs above the expert ceiling and rungs off the ladder", () => {
    for (const rung of ["money", "observed", "stated", "gospel"]) {
      expect(() => rankHost(dir, { host: "example.com", rung, reason: "r", by: "t" })).toThrow(/expert|assertion/);
    }
  });

  test("requires a reason", () => {
    expect(() => rankHost(dir, { host: "example.com", rung: "expert", reason: "  ", by: "t" })).toThrow(/reason/i);
  });

  test("malformed lines are skipped fail-closed", () => {
    rankHost(dir, { host: "good.com", rung: "expert", reason: "r", by: "t" });
    fs.appendFileSync(hostTrustPath(dir), "not json\n" + JSON.stringify({ host: "bad.com", rung: "money" }) + "\n");
    const trust = readHostTrust(dir);
    expect(trust.get("good.com")).toBe("expert");
    expect(trust.has("bad.com")).toBe(false);
  });

  test("missing file means an empty map", () => {
    expect(readHostTrust(dir).size).toBe(0);
  });
});

describe("hostRung", () => {
  test("exact match only — trust never leaks to subdomains", () => {
    const trust = new Map([["github.io", "expert" as const]]);
    expect(hostRung(trust, "github.io")).toBe("expert");
    expect(hostRung(trust, "someone.github.io")).toBe("assertion");
    expect(hostRung(trust, "unknown.org")).toBe("assertion");
  });
});

describe("classifyProvenance WEB: branch", () => {
  test("an unranked web host lands on the floor", () => {
    expect(classifyProvenance("WEB:random-blog.net")).toBe("assertion");
  });

  test("a ranked host lands on its earned rung", () => {
    const hostTrust = new Map([["example.com", "expert" as const]]);
    expect(classifyProvenance("WEB:example.com https://example.com/post", { hostTrust })).toBe("expert");
    expect(classifyProvenance("WEB:other.com", { hostTrust })).toBe("assertion");
  });

  test("a poisoned trust map grants nothing — a rung a publisher cannot hold falls to the floor", () => {
    const hostTrust = new Map([["example.com", "money" as const]]);
    expect(classifyProvenance("WEB:example.com", { hostTrust })).toBe("assertion");
  });

  test("existing provenance classes are unchanged", () => {
    expect(classifyProvenance("TRANSCRIPT:abc")).toBe("observed");
    expect(classifyProvenance("JIRA:PROJ-1")).toBe("stated");
    expect(classifyProvenance("anything else")).toBe("assertion");
  });
});
