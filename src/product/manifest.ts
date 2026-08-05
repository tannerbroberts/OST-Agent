/**
 * The declared resource manifest — what the operator says they actually have,
 * stated once, so the planner stops guessing.
 *
 * Every ranking of candidate work rests on a picture of the operator: how many
 * hours they can spend this week, whether they will contact a stranger at all,
 * what money is available and by when, what compute costs and when it resets,
 * and which credentials an unattended run may hold. Nothing in this repository
 * ever asked. The picture was still being used — it was simply *assumed*, and an
 * assumption nobody wrote down cannot be checked, contradicted, or updated.
 *
 * So this file holds one thing: fields the operator declares, and nothing
 * inferred. The mechanism is declaration. If the operator does not say, the
 * answer is a **blank** — never a default, never a guess, and never silence.
 * {@link blankResources} is what makes a blank loud: the planner cites it, and a
 * resource nobody declared reads as "unstated" rather than as "zero".
 *
 * **Why this is its own file and not a section of `ost.config.yaml`.** That
 * schema is full of defaults, and it must be — a vault with no `remote:` key
 * genuinely has no remote. A resource with a default is a resource the planner
 * would silently condition on, which is exactly the failure this exists to
 * close. A separate file lets "absent" mean absent: no file at all is a manifest
 * in which every field is blank, and the planner says so out loud.
 *
 * **What it cannot do, stated where the fields are.** It holds only facts the
 * operator thought to declare, and it decays silently: a round closes, an
 * appetite shifts, a credential is granted, and the file keeps asserting last
 * month's world with full confidence. Nothing here can detect that, and a stale
 * manifest the planner is *required* to cite is worse than no manifest, because
 * it launders a guess into a citation. There is no `checkedAt` field pretending
 * otherwise — see {@link ResourceManifest.declaredOn}, which records when the
 * operator wrote it and makes no claim about whether it is still true.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** The file an operator writes, beside `ost.config.yaml` in the vault. */
export const MANIFEST_FILENAME = "ost.resources.yaml";

export function manifestPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), MANIFEST_FILENAME);
}

/**
 * The five resources, named exactly as the solution that asked for them named
 * them. This list is the vocabulary: a planner may cite these and nothing else,
 * and a field added here is a field every citation has to account for.
 */
export type ResourceId = "capital" | "hours" | "social-reach" | "compute" | "credentials";

export interface ResourceDef {
  id: ResourceId;
  /** The manifest key that declares it. */
  key: string;
  /** What the operator is being asked, in a sentence. */
  declares: string;
  /**
   * What the planner does with it once declared — and therefore what is NOT
   * being done while it is blank. Written to follow "declared, it would …",
   * because this string is what a citation prints beside an undeclared
   * resource: the cost of the silence has to be legible at the point the
   * silence is reported, not in a footnote a reader has to go and find.
   */
  conditions: string;
}

export const RESOURCES: readonly ResourceDef[] = [
  {
    id: "capital",
    key: "capital",
    declares: "money available to this project, and the date by which it has to be deployed",
    conditions: "defer work that names a sum to spend, when no capital is declared available",
  },
  {
    id: "hours",
    key: "hours",
    declares: "human hours per week, and the appetite those hours are offered with",
    conditions: "defer work that needs a person in the loop, when no human hours are declared",
  },
  {
    id: "social-reach",
    key: "socialReach",
    declares: "whether this operator will contact strangers at all, and how many they can reach",
    conditions:
      "defer work whose test needs people outside the building, when the operator will not contact them",
  },
  {
    id: "compute",
    key: "compute",
    declares: "the token budget per window and how often that window resets",
    conditions:
      "condition nothing — no candidate carries a signal that distinguishes what it costs in compute, and " +
      "a fabricated cost model would make the citation claim a conditioning that never happened",
  },
  {
    id: "credentials",
    key: "credentials",
    declares: "which credentials an unattended run may hold, and which are withheld from it",
    conditions: "defer work that names a withheld credential",
  },
] as const;

const BY_ID = new Map<ResourceId, ResourceDef>(RESOURCES.map((r) => [r.id, r]));

export function resourceDef(id: ResourceId): ResourceDef {
  return BY_ID.get(id)!;
}

/**
 * Capital, and the deadline that makes it a resource rather than a number. An
 * amount with no `deployBy` is still a declaration; a `deployBy` with no amount
 * is not, which is why `amount` is the required half.
 */
const CapitalSchema = z.object({
  amount: z.number().min(0),
  currency: z.string().min(1).default("USD"),
  /** ISO date. Kept as a string: nothing here does date arithmetic on it. */
  deployBy: z.string().min(1).optional(),
});

const HoursSchema = z.object({
  perWeek: z.number().min(0),
  /** The operator's own words for what those hours are for. Never parsed. */
  appetite: z.string().min(1).optional(),
});

const SocialReachSchema = z.object({
  /**
   * The question the cold-offer test needed answered a day before it was
   * sequenced, and nobody had asked.
   */
  contactStrangers: z.boolean(),
  /** How many people this operator can actually reach, when they know. */
  audience: z.number().min(0).optional(),
});

const ComputeSchema = z.object({
  tokensPerWindow: z.number().min(0),
  /** How often the window resets, in the operator's words ("5h", "daily"). Never parsed. */
  resetEvery: z.string().min(1).optional(),
});

/**
 * Credential names, as the operator calls them.
 *
 * These are the ONLY credential vocabulary the planner has. It matches them
 * literally against candidate text (see `credentialDemands` in `planner.ts`), so
 * an operator who writes `publish` is saying "work that talks about publishing
 * is work that needs the credential I am withholding". That is coarse, and the
 * coarseness is the operator's to tune by choosing the word — a built-in list of
 * credential-sounding words would be this file inferring, which is the one thing
 * it does not do.
 */
const CredentialsSchema = z.object({
  granted: z.array(z.string().min(1)).default([]),
  withheld: z.array(z.string().min(1)).default([]),
});

/**
 * Every field optional and nothing defaulted at the top level. An omitted key is
 * a blank the planner reports; there is deliberately no way to spell "I decline
 * to say" that reads differently from saying nothing.
 */
export const ResourceManifestSchema = z.object({
  /**
   * When the operator wrote this. Recorded, never checked: this file has no way
   * to know whether the facts are still true, and a freshness field that nothing
   * enforces would be worse than an honest date.
   */
  declaredOn: z.string().min(1).optional(),
  capital: CapitalSchema.optional(),
  hours: HoursSchema.optional(),
  socialReach: SocialReachSchema.optional(),
  compute: ComputeSchema.optional(),
  credentials: CredentialsSchema.optional(),
});

export type ResourceManifest = z.infer<typeof ResourceManifestSchema>;

/** The manifest a vault with no `ost.resources.yaml` has: every field blank. */
export const EMPTY_MANIFEST: ResourceManifest = Object.freeze({});

/** Which resources this manifest actually declares, in {@link RESOURCES} order. */
export function declaredResources(m: ResourceManifest): ResourceId[] {
  return RESOURCES.filter((r) => declaredValue(m, r.id) !== undefined).map((r) => r.id);
}

/** Which resources are blank — the planner's visible unknowns. */
export function blankResources(m: ResourceManifest): ResourceId[] {
  return RESOURCES.filter((r) => declaredValue(m, r.id) === undefined).map((r) => r.id);
}

/** The declared value for one resource, or `undefined` when it is blank. */
export function declaredValue(m: ResourceManifest, id: ResourceId): unknown {
  switch (id) {
    case "capital":
      return m.capital;
    case "hours":
      return m.hours;
    case "social-reach":
      return m.socialReach;
    case "compute":
      return m.compute;
    case "credentials":
      return m.credentials;
  }
}

/**
 * The declared value in one line, for a citation a human reads.
 *
 * Returns `undefined` for a blank rather than a phrase like "not declared" —
 * the caller decides how loudly to say that, and only the caller knows whether
 * it is printing a citation or a summary.
 */
export function summarizeDeclared(m: ResourceManifest, id: ResourceId): string | undefined {
  switch (id) {
    case "capital": {
      if (!m.capital) return undefined;
      const by = m.capital.deployBy ? `, to be deployed by ${m.capital.deployBy}` : "";
      return `${m.capital.amount} ${m.capital.currency}${by}`;
    }
    case "hours": {
      if (!m.hours) return undefined;
      const appetite = m.hours.appetite ? ` (${m.hours.appetite})` : "";
      return `${m.hours.perWeek} human hour(s) per week${appetite}`;
    }
    case "social-reach": {
      if (!m.socialReach) return undefined;
      const reach = m.socialReach.audience === undefined ? "" : `, ${m.socialReach.audience} reachable`;
      return `${m.socialReach.contactStrangers ? "will" : "will NOT"} contact strangers${reach}`;
    }
    case "compute": {
      if (!m.compute) return undefined;
      const reset = m.compute.resetEvery ? `, resetting every ${m.compute.resetEvery}` : "";
      return `${m.compute.tokensPerWindow} token(s) per window${reset}`;
    }
    case "credentials": {
      if (!m.credentials) return undefined;
      const granted = m.credentials.granted.length ? m.credentials.granted.join(", ") : "none";
      const withheld = m.credentials.withheld.length ? m.credentials.withheld.join(", ") : "none";
      return `granted: ${granted}; withheld: ${withheld}`;
    }
  }
}

/** What a read produced, and — when a file exists and could not be used — why. */
export interface ManifestLoad {
  manifest: ResourceManifest;
  /**
   * Set only when the file is present and unusable. `manifest` is then
   * {@link EMPTY_MANIFEST}, which is a REFUSAL rather than a fallback: a broken
   * manifest must rank as if nothing were declared, because the alternative is a
   * planner conditioning on half a file the operator never got to finish.
   */
  problem?: string;
}

/**
 * Read the manifest from a vault directory.
 *
 * A missing file is not a problem — it is the ordinary state of a vault whose
 * operator has not declared anything yet, and the planner is required to handle
 * it by naming every blank. A file that exists and does not parse IS a problem,
 * reported rather than thrown, on the same rule `readConfig` follows (G1): a
 * question that never needed the file must not fail because of it.
 */
export function readResourceManifest(vaultDir: string): ManifestLoad {
  const p = manifestPath(vaultDir);
  if (!fs.existsSync(p)) return { manifest: EMPTY_MANIFEST };
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  } catch (e) {
    return {
      manifest: EMPTY_MANIFEST,
      problem: `${MANIFEST_FILENAME} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const result = ResourceManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return { manifest: EMPTY_MANIFEST, problem: `invalid ${MANIFEST_FILENAME}:\n${issues}` };
  }
  return { manifest: result.data };
}
