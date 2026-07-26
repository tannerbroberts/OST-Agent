/**
 * Per-host trust for web sources — how a publisher earns a rung.
 *
 * Everything read from the web starts at the believability floor: a page is
 * one voice, however confident. When a claim from a host is later corroborated
 * by first-party evidence (an assumption test that moved a node to observed or
 * money), the agent may promote that HOST to `expert` — with the corroborating
 * result named in the reason. `expert` is the ceiling for publisher identity:
 * observed and money are earned by measurement, never by a byline.
 *
 * Storage is append-only jsonl (`.ost-agent/trust/hosts.jsonl`), last record
 * per host wins, malformed lines are skipped fail-closed. Nothing is ever
 * rewritten, so the whole promotion/demotion history stays auditable.
 */
import fs from "node:fs";
import path from "node:path";
import { type RungId } from "./believability.js";

/** The only rungs a publisher can hold. */
export const HOST_RUNGS = ["assertion", "expert"] as const;
export type HostRung = (typeof HOST_RUNGS)[number];

export interface HostTrustRecord {
  ts: string;
  host: string;
  rung: HostRung;
  reason: string;
  /** Who ranked it — stamped by the surface, not self-reported. */
  by: string;
}

export function hostTrustPath(dir: string): string {
  return path.join(dir, ".ost-agent", "trust", "hosts.jsonl");
}

/** Lowercased hostname only: scheme, path, port, and a leading `www.` are stripped. */
export function normalizeHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/.exec(h);
  if (m) h = m[1];
  h = h.split("/")[0].split("?")[0].split(":")[0];
  return h.replace(/^www\./, "");
}

/** Append one trust record. Throws on a rung above the ceiling or an empty reason. */
export function rankHost(dir: string, rec: { host: string; rung: string; reason: string; by: string }): HostTrustRecord {
  if (!(HOST_RUNGS as readonly string[]).includes(rec.rung)) {
    throw new Error(
      `a publisher can hold only "assertion" or "expert" — never "${rec.rung}". ` +
        `observed/money are earned by first-party measurement (AssumptionTests + ost_set_evidence), not by a byline.`,
    );
  }
  if (!rec.reason.trim()) {
    throw new Error("a trust change needs a reason — name the corroborating (or failed) first-party result");
  }
  const record: HostTrustRecord = {
    ts: new Date().toISOString(),
    host: normalizeHost(rec.host),
    rung: rec.rung as HostRung,
    reason: rec.reason.trim(),
    by: rec.by,
  };
  const file = hostTrustPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

/** Current trust per host: last record wins; malformed lines are skipped fail-closed. */
export function readHostTrust(dir: string): Map<string, HostRung> {
  const file = hostTrustPath(dir);
  const trust = new Map<string, HostRung>();
  if (!fs.existsSync(file)) return trust;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Partial<HostTrustRecord>;
      if (typeof rec.host === "string" && rec.host && (HOST_RUNGS as readonly string[]).includes(rec.rung as string)) {
        trust.set(rec.host, rec.rung as HostRung);
      }
    } catch {
      // fail-closed: an unreadable record grants nothing
    }
  }
  return trust;
}

/** A host's current rung — exact match only (trust never leaks to subdomains), floor otherwise. */
export function hostRung(trust: ReadonlyMap<string, string>, host: string): RungId {
  const r = trust.get(normalizeHost(host));
  return r === "expert" ? "expert" : "assertion";
}
