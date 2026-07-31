/**
 * The LEGACY host-keyed trust file — read once, by the migration, and never written.
 *
 * This module used to be the live trust store: `rankHost` wrote the rung the agent
 * named into `.ost-agent/trust/hosts.jsonl`, `readHostTrust` folded it last-record-wins,
 * and `hostRung` handed the stored value back. Two things were wrong with that, and
 * both are why the live ledger is now `knowledge/actor-trust.ts`:
 *
 * - **the stored rung** — a promotion was an assertion about an assertion, and the word
 *   "earned" in `ost_rank_source`'s description was a word in a tool description (B5);
 * - **the namespace** — `normalizeHost` is a no-op on a bare word, so
 *   `rankHost({host: 'stripe-webhook-feed', rung: 'expert'})` succeeded: a commissioned
 *   first-party pipeline and a publisher shared one namespace and one ceiling (B6).
 *
 * `rankHost`, `readHostTrust` and `hostRung` are **deleted**; that absence is B5(b)'s
 * check, since there is now no function anywhere that returns a stored rung. What
 * survives is exactly what the migration needs to read the old file exactly the way it
 * was written — the same normalizer, so a host that keyed a legacy record keys the same
 * actor row — plus `isHostRung`, which `checkCorroboration` (B4) still uses to decide
 * whether a change is a promotion.
 *
 * The file itself is never rewritten, renamed or deleted: corrections are appends, and
 * a vault rolled back to an earlier version must still find its trust file where it
 * left it.
 */
import fs from "node:fs";
import path from "node:path";

/** The only rungs a publisher could hold in the legacy file. */
export const HOST_RUNGS = ["assertion", "expert"] as const;
export type HostRung = (typeof HOST_RUNGS)[number];

/**
 * Is this one of the rungs a publisher can hold?
 *
 * Exported rather than inlined at each site because two spellings of one membership
 * test is how the pair of health gates drifted before R4 — and the live caller
 * (`checkCorroboration`, B4) has to agree with this module about what counts as a
 * promotion or it will refuse a call for the wrong reason.
 */
export function isHostRung(rung: string): rung is HostRung {
  return (HOST_RUNGS as readonly string[]).includes(rung);
}

/** A record as the legacy file holds it. Kept verbatim so the fold reads what was written. */
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

/**
 * Every legacy record, in file order, malformed lines skipped.
 *
 * ORDER, not last-record-wins: the fold needs to know whether a host that now sits at
 * `assertion` was ever at `expert`, because that is the difference between "never
 * promoted" (nothing to migrate) and "demoted" (a strike). The old reader collapsed
 * exactly that distinction, which is why this returns the history instead of a map.
 */
export function readLegacyHostRecords(dir: string): HostTrustRecord[] {
  const file = hostTrustPath(dir);
  const out: HostTrustRecord[] = [];
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Partial<HostTrustRecord>;
      // Fail-closed, as the old reader was: a record whose host or rung is not one this
      // module recognises grants and revokes nothing.
      if (typeof rec.host === "string" && rec.host && typeof rec.rung === "string" && isHostRung(rec.rung)) {
        out.push({
          ts: typeof rec.ts === "string" ? rec.ts : "",
          host: normalizeHost(rec.host),
          rung: rec.rung,
          reason: typeof rec.reason === "string" ? rec.reason : "",
          by: typeof rec.by === "string" ? rec.by : "",
        });
      }
    } catch {
      // fail-closed: an unreadable record grants nothing
    }
  }
  return out;
}
