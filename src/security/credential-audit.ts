/**
 * Where the credential audit log lives, and the sink that writes it.
 *
 * **This one throws.** `recordUsageEvent` next door is fail-open by contract —
 * telemetry must never break a tool call, so an unwritable log costs an event.
 * The credential log is the opposite kind of thing: it is the reason the broker
 * is worth more than a scoped token, and a broker that acts when it cannot
 * record has silently become the cheaper design while still charging for the
 * expensive one. So the sink propagates its failure, and
 * `createCredentialBroker` turns that into a denial (`unauditable`) before the
 * credential is touched.
 *
 * It sits beside the usage trace inside the vault rather than in the repo: the
 * vault is the thing an operator already backs up, already commits, and already
 * reads when they want to know what happened.
 */
import fs from "node:fs";
import path from "node:path";
import type { AuditRecord, AuditSink } from "./broker.js";

export function credentialAuditPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "credentials", "audit.jsonl");
}

/** Append-only JSONL, one record per line, in the order the broker produced them. */
export function fileAuditSink(vaultDir: string): AuditSink {
  const file = credentialAuditPath(vaultDir);
  return (record: AuditRecord) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  };
}

/** Read the log back. Corrupt lines are skipped — one bad line must not hide the rest. */
export function readCredentialAudit(vaultDir: string): AuditRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(credentialAuditPath(vaultDir), "utf8");
  } catch {
    return [];
  }
  const out: AuditRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AuditRecord);
    } catch {
      // skip
    }
  }
  return out;
}
