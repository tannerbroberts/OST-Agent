/**
 * Derive the next release number from the registry and `origin`'s tags,
 * never from the local `package.json`.
 *
 * **The failure this exists to end.** On 2026-07-26 a builder session finished
 * work locally while, unpushed, the autonomous loop released v0.18.0 from
 * elsewhere. Both trains were reaching for the same next number because both
 * read it out of a local file that only knew what it had seen. A human caught
 * it on rebase. This module makes the next number a function of what is
 * externally true — what the registry has published, what `origin` has
 * tagged — so a second train landing after the first sees the first's number
 * and skips past it without anyone rebasing anything.
 *
 * **What this module does not do.** It does not talk to a network. Query the
 * registry and `git ls-remote --tags origin` at the call site, interpret the
 * response with {@link interpretRegistryResponse}, and pass the result in —
 * that keeps this pure and the test suite offline, per CONTRIBUTING.md.
 */

/** A released version as three non-negative integers; no pre-release/build metadata. */
export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parse `X.Y.Z`, optionally prefixed with `v`. Anything else (prereleases, build metadata,
 *  garbage) is not a released version this rule reasons about and parses to `null`. */
export function parseVersion(raw: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function formatVersion(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. */
export function compareVersions(a: Semver, b: Semver): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

/** The highest of a set of raw version strings, ignoring anything unparseable. `null` if none parse. */
export function maxVersion(raw: readonly string[]): Semver | null {
  let best: Semver | null = null;
  for (const r of raw) {
    const v = parseVersion(r);
    if (!v) continue;
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export function bumpVersion(base: Semver, bump: "major" | "minor" | "patch"): Semver {
  if (bump === "major") return { major: base.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: base.major, minor: base.minor + 1, patch: 0 };
  return { major: base.major, minor: base.minor, patch: base.patch + 1 };
}

/**
 * What is known about the registry at the moment of asking.
 *
 * `reachable: true` with an empty `versions` list means the query succeeded
 * and found nothing published — a real, positive answer, not the absence of
 * one. `reachable: false` means the query itself did not complete: a network
 * failure, a timeout, a 5xx. These are different failures and this type keeps
 * them different rather than collapsing both to "no versions".
 */
export type RegistryState =
  | { readonly reachable: true; readonly versions: readonly string[] }
  | { readonly reachable: false; readonly reason: string };

/**
 * Turn an npm registry HTTP response into a {@link RegistryState}.
 *
 * npm's registry answers a package that was never published and a package
 * that WAS published and then fully unpublished with the same 404 status —
 * but not the same body. A fully-unpublished package's body still carries
 * `time.unpublished.versions`, the numbers that were once live. Treating that
 * 404 the same as "never published" would let a burned number be chosen
 * again; treating it the same as "unreachable" would block every future
 * release of a package that has ever been unpublished once. Neither is what
 * happened — npm answered, and it named exactly what those old versions were.
 */
export function interpretRegistryResponse(status: number, body: unknown): RegistryState {
  if (status === 200 && body && typeof body === "object" && "versions" in body) {
    const versions = (body as { versions: unknown }).versions;
    if (versions && typeof versions === "object") {
      return { reachable: true, versions: Object.keys(versions as Record<string, unknown>) };
    }
    return { reachable: true, versions: [] };
  }
  if (status === 404) {
    const time = body && typeof body === "object" ? (body as { time?: unknown }).time : undefined;
    const unpublished =
      time && typeof time === "object" ? (time as { unpublished?: unknown }).unpublished : undefined;
    if (unpublished && typeof unpublished === "object" && Array.isArray((unpublished as { versions?: unknown }).versions)) {
      return { reachable: true, versions: (unpublished as { versions: string[] }).versions };
    }
    // A 404 with no `time.unpublished` is npm's answer for a name that has
    // never been published at all: a real, positive "nothing here yet".
    return { reachable: true, versions: [] };
  }
  return { reachable: false, reason: `registry responded ${status}` };
}

export interface DeriveNextVersionInput {
  /** What the registry query returned. */
  readonly registry: RegistryState;
  /** Raw tag names read from `git ls-remote --tags origin` (or equivalent) — never local-only tags. */
  readonly tags: readonly string[];
  /** Which segment this release bumps. Not this rule's decision — it is handed in. */
  readonly bump: "major" | "minor" | "patch";
}

export type DeriveNextVersionResult =
  | { readonly ok: true; readonly version: string; readonly base: string | null }
  | { readonly ok: false; readonly reason: "registry-unreachable"; readonly detail: string };

/**
 * The next version, or a refusal that says exactly why there isn't one yet.
 *
 * Base is the maximum of everything the registry has ever published
 * (including numbers later unpublished — see {@link interpretRegistryResponse})
 * and everything tagged on `origin`. The result is always strictly greater
 * than that base, so it can never coincide with a number either source has
 * already used.
 */
export function deriveNextVersion(input: DeriveNextVersionInput): DeriveNextVersionResult {
  if (!input.registry.reachable) {
    return { ok: false, reason: "registry-unreachable", detail: input.registry.reason };
  }
  const base = maxVersion([...input.registry.versions, ...input.tags]);
  const next = bumpVersion(base ?? { major: 0, minor: 0, patch: 0 }, input.bump);
  return { ok: true, version: formatVersion(next), base: base ? formatVersion(base) : null };
}
