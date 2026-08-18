/**
 * Detect the authentication that already exists and say exactly which one will
 * be used — before anything spends it.
 *
 * The friction this answers is informational, not functional: being asked for a
 * credential is bearable, being asked while already holding one, with no
 * explanation of why the existing one will not do, is what makes it feel
 * absurd. `credential-forms.ts` already resolves each of this repository's
 * credentials from an ordered list of offers, first usable one wins, and
 * already refuses to print anything but the non-secret surfaces (`form`,
 * `source`, `problem`). This module adds nothing new to *how* a credential is
 * found — it only asks that question early, before a broker is built or a
 * request is spent, and renders the answer.
 *
 * **What this settles and what it does not.** It settles legibility: an
 * operator or a script reading this report learns which credential answers for
 * each adapter and why, without probing anything itself and without spending
 * anything. It settles nothing about consent to the probe running at all —
 * that is the assumption `test/security/auth-detection-report.test.ts` hangs
 * beneath ("Operators consent to a probe that looks in the places their
 * credentials live"), and no test here can answer it. It also does not
 * unblock anyone: an operator with no usable credential is told exactly why,
 * not handed one.
 */
import { atlassianOffers, githubOffers, searchOffers, slackOffers } from "../runner/credentials.js";
import { resolveCredential, type CredentialFormName, type CredentialOffer } from "./credential-forms.js";

/** One credential this repository's adapters read, and how detection resolves it. */
export type AuthDetectionEntry =
  | {
      name: string;
      status: "will-use";
      /** The form the winning offer arrived in — never the secret. */
      form: CredentialFormName;
      /** Where it came from, safe to print — a variable name, a stored-auth path. */
      source: string;
    }
  | {
      name: string;
      status: "rejected";
      /** Every route tried and why each failed, in the operator's terms. Never the value. */
      reason: string;
    };

export interface AuthDetectionReport {
  entries: AuthDetectionEntry[];
}

/** name → the offers `credentialBrokerFromEnv` resolves it from, in the same order. */
function registry(env: NodeJS.ProcessEnv): { name: string; offers: CredentialOffer[] }[] {
  return [
    { name: "slack", offers: slackOffers(env) },
    { name: "atlassian", offers: atlassianOffers(env) },
    { name: "search", offers: searchOffers(env) },
    { name: "github", offers: githubOffers(env) },
  ];
}

/**
 * Probe every credential this repository's adapters read and say which will
 * answer, or which forms were found and why each was rejected.
 *
 * Pure: reads the environment it is given and nothing else. It never
 * constructs a broker, never opens a network connection, never reads or
 * writes the vault — so calling it is safe at the very start of a run, before
 * anything else has asked a credential for anything.
 */
export function detectAuthentication(env: NodeJS.ProcessEnv = process.env): AuthDetectionReport {
  const entries: AuthDetectionEntry[] = registry(env).map(({ name, offers }) => {
    const intake = resolveCredential(offers);
    return intake.accepted
      ? { name, status: "will-use", form: intake.accepted.form, source: intake.accepted.source }
      : { name, status: "rejected", reason: intake.problem };
  });
  return { entries };
}

/** The report `ost-agent auth` prints. Pure — no vault, no network, no secret. */
export function renderAuthDetectionReport(report: AuthDetectionReport): string {
  const willUse = report.entries.filter((e) => e.status === "will-use").length;
  const lines: string[] = [
    `Authentication detected: ${report.entries.length} credential(s) checked, ${willUse} will be used, ` +
      `${report.entries.length - willUse} rejected`,
  ];
  for (const e of report.entries) {
    lines.push("");
    lines.push(`[${e.name}]`);
    lines.push(e.status === "will-use" ? `  WILL USE — ${e.form}, from ${e.source}` : `  not available — ${e.reason}`);
  }
  return lines.join("\n");
}
