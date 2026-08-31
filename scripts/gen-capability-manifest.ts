/**
 * Generate `dist/capability-manifest.json` from the artefact beside it.
 *
 * Run by `npm run manifest`, and chained onto `npm run bundle` so the manifest
 * cannot be forgotten: the one moment the artefact changes is the one moment the
 * manifest is wrong, and a step a person has to remember at that moment is a step
 * that gets remembered until the release that matters. `test/release/capability-manifest.test.ts`
 * re-derives everything here and fails the suite gate if the committed manifest
 * has drifted, so a forgotten regeneration is a red gate rather than a published
 * list that is quietly out of date.
 *
 * **Deterministic, and it has to be.** No dates, no randomness, no host paths:
 * the output is a pure function of the artefact's bytes and of what the artefact
 * answers when asked what it exposes. A timestamp here would make the drift
 * check unable to tell "the surface changed" from "somebody ran the generator",
 * which is the whole thing it is for.
 *
 * **Signing.** If `OST_RELEASE_SIGNING_KEY` names a PEM private key (or carries
 * one), the manifest is signed with it and the signature is written into the
 * file. Nothing here creates a key. A key this process could generate is a key
 * anyone with the repository could regenerate, and a signature that anyone can
 * forge is worse than no signature because it looks like one — so an unsigned
 * manifest is written with `"signature": null`, which is a stated position
 * rather than a missing field, and the release stays integrity-bound and
 * unauthenticated until a person provisions a key. See the custody note in
 * `src/release/capability-manifest.ts`.
 */
import { createPrivateKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_PATH,
  MANIFEST_PATH,
  MANIFEST_SCHEMA,
  publicKeyOf,
  sha256,
  signManifest,
  type CapabilityManifest,
  type ManifestBody,
} from "../src/release/capability-manifest.js";
import { observeArtifactSurface } from "../src/release/capability-surface.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** The env var a maintainer sets at release time: a path to a PEM key, or the PEM itself. */
export const SIGNING_KEY_ENV = "OST_RELEASE_SIGNING_KEY";

/** The manifest for the artefact currently in `dist/`, unsigned. */
export async function buildManifestBody(repoRoot: string): Promise<ManifestBody> {
  const artifactPath = path.join(repoRoot, ARTIFACT_PATH);
  const artifact = fs.readFileSync(artifactPath);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  return {
    schema: MANIFEST_SCHEMA,
    version: pkg.version,
    artifact: { path: ARTIFACT_PATH, bytes: artifact.byteLength, sha256: sha256(artifact) },
    capabilities: await observeArtifactSurface(artifactPath),
  };
}

/** The key named by the environment, or `undefined` when nobody provisioned one. */
function signingKey(): ReturnType<typeof createPrivateKey> | undefined {
  const raw = process.env[SIGNING_KEY_ENV];
  if (!raw || raw.trim() === "") return undefined;
  const pem = raw.includes("-----BEGIN") ? raw : fs.readFileSync(raw, "utf8");
  return createPrivateKey(pem);
}

/**
 * The file's bytes.
 *
 * Pretty-printed because the audience is a person auditing what the thing they
 * are about to run can do, and a one-line JSON blob is a file nobody reads. The
 * *signature* is over {@link canonicalManifest}'s compact form, never over this
 * rendering, so re-indenting the file cannot invalidate it.
 */
export function renderManifest(manifest: CapabilityManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main(): Promise<void> {
  const body = await buildManifestBody(REPO);
  const key = signingKey();
  const manifest: CapabilityManifest = { ...body, signature: key ? signManifest(body, key) : null };
  const target = path.join(REPO, MANIFEST_PATH);
  fs.writeFileSync(target, renderManifest(manifest), "utf8");

  const tools = body.capabilities.filter((c) => c.surface === "mcp-tool").length;
  const commands = body.capabilities.filter((c) => c.surface === "cli-command").length;
  const attribution = key ? `signed by ${publicKeyOf(key).slice(0, 16)}…` : `unsigned (set ${SIGNING_KEY_ENV} to sign)`;
  process.stdout.write(
    `wrote ${MANIFEST_PATH} — ${tools} tool(s), ${commands} command(s), artefact ${body.artifact.sha256.slice(0, 16)}…, ${attribution}\n`,
  );
}

// Run as a script, but stay importable by the drift test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
