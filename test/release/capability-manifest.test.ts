/**
 * The published capability manifest is checkable, not merely published.
 *
 * The assumption test this file is the instrument for asks whether an
 * inspectable manifest and a signed build move a security-conscious operator's
 * willingness to run this unattended. That question is a person's to answer and
 * nothing here answers it. What this file settles is the half without which the
 * question is not worth asking: **a manifest that cannot be checked measures a
 * reader's credulity rather than their trust.** So three properties, each with
 * teeth:
 *
 *  1. The manifest is **bound to the artefact** — its `sha256` is the digest of
 *     the `dist/ost-agent.mjs` committed beside it, so an operator with `shasum`
 *     can confirm the file they are about to launch is the file the list
 *     describes.
 *  2. The manifest is **true of the artefact** — the surface is observed by
 *     running the committed binary and asking it (`tools/list`, `--help`), not by
 *     re-reading the source lists the manifest was generated from. A comparison
 *     of `MCP_TOOL_NAMES` against `MCP_TOOL_NAMES` is a list agreeing with itself.
 *  3. A **divergence fails the release** — every mutation below is one a build
 *     could ship, and each must come out as a named failure with `ok: false`.
 *     This file runs inside `npx vitest run`, which is a core gate in
 *     `gates.declared.ts` and therefore the thing standing between a divergent
 *     build and `main`; the last test asserts that wiring rather than assuming it.
 *
 * **The signature is the one property that is not fully ours.** Ed25519 signing
 * and verification are exercised here end to end with a keypair generated in the
 * test, including every way a signature can be wrong — because the mechanism has
 * to be right and testable before a key exists, or the day the key arrives is the
 * day the mechanism is first run. What the repository cannot do is *hold* a
 * release key: a private key committed here could be used by anyone who cloned it
 * to re-sign a rewritten manifest, which is worse than being unsigned because it
 * looks signed. So the shipped manifest is unsigned, `authenticity` says so, and
 * the test that matters for the future is the one asserting that the moment a
 * human publishes a trusted key, an unsigned build stops shipping.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import {
  ARTIFACT_PATH,
  MANIFEST_PATH,
  MANIFEST_SCHEMA,
  RELEASE_KEY_PATH,
  canonicalManifest,
  publicKeyOf,
  sha256,
  signManifest,
  signatureVerifies,
  verifyRelease,
  type Capability,
  type CapabilityManifest,
  type ReleaseInput,
} from "../../src/release/capability-manifest.js";
import { loadRelease, parseCommandTable, parseToolsList } from "../../src/release/capability-surface.js";
import { CORE_GATES, SUITE_EXCLUSIONS } from "../../src/release/gates.declared.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

/**
 * The real release, loaded once: the committed manifest, the committed artefact,
 * and the surface that artefact reports when it is actually run. Two spawns, so
 * they are paid for once for the whole file.
 */
let release: ReleaseInput;
beforeAll(async () => {
  release = await loadRelease(root);
}, 60_000);

/** The committed manifest with one field replaced — every mutation below is a build that could ship. */
function mutated(patch: Partial<CapabilityManifest>): ReleaseInput {
  return { ...release, manifest: { ...release.manifest, ...patch } };
}

describe("the manifest is published where an operator can find it", () => {
  test("it ships beside the artefact it describes, and is committed rather than ignored", () => {
    expect(fs.existsSync(path.join(root, MANIFEST_PATH))).toBe(true);
    // `dist/*` is gitignored with a negation for each shipped file. A manifest
    // that ships to nobody is the one failure this whole file would not notice:
    // every assertion here reads the working tree, which has the file whether or
    // not git does.
    const ignored = spawnSync("git", ["check-ignore", "-q", MANIFEST_PATH], { cwd: root });
    expect(ignored.status, `${MANIFEST_PATH} is gitignored, so no operator would ever receive it`).not.toBe(0);
    const tracked = execFileSync("git", ["ls-files", MANIFEST_PATH], { cwd: root, encoding: "utf8" }).trim();
    expect(tracked, `${MANIFEST_PATH} is not committed — run \`npm run bundle\` and commit it`).toBe(MANIFEST_PATH);
  });

  test("the README's tool count is the number the artefact actually exposes", () => {
    // The failure this pins, found while building the manifest and the reason
    // the manifest is worth having: README.md read "exactly 22 registered MCP
    // tools (pinned by test)" from 2026-08-05, and `ost_deposit` made that 23 on
    // 2026-08-12 (80d69b8). Eighteen days of an operator-facing document
    // under-reporting the surface, with the words "pinned by test" beside a
    // number nothing was pinning. A count in prose is a claim; this is the test
    // the parenthesis promised.
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const claimed = Number(readme.match(/exactly (\d+) registered\n\s*MCP tools/)![1]);
    expect(claimed).toBe(release.observed.filter((c) => c.surface === "mcp-tool").length);
  });

  test("it declares the schema and version this reader understands", () => {
    expect(release.manifest.schema).toBe(MANIFEST_SCHEMA);
    expect(release.manifest.version).toBe(readJson("package.json").version);
    expect(release.manifest.version).toBe(readJson(".claude-plugin/plugin.json").version);
  });
});

describe("the manifest is bound to the artefact, so it describes the running binary", () => {
  test("its digest and size are the committed artefact's", () => {
    const bytes = fs.readFileSync(path.join(root, ARTIFACT_PATH));
    expect(release.manifest.artifact.path).toBe(ARTIFACT_PATH);
    expect(release.manifest.artifact.sha256).toBe(sha256(bytes));
    expect(release.manifest.artifact.bytes).toBe(bytes.byteLength);
  });

  test("an artefact that is not the one described fails the release", () => {
    const verdict = verifyRelease({ ...release, artifact: Buffer.concat([release.artifact, Buffer.from("\n")]) });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.kind)).toContain("artifact-digest-mismatch");
    expect(verdict.failures.map((f) => f.kind)).toContain("artifact-size-mismatch");
  });
});

describe("the manifest enumerates what the artefact actually exposes", () => {
  test("the committed release matches, both directions and by argument shape", () => {
    const verdict = verifyRelease(release);
    expect(verdict.failures.map((f) => f.kind)).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("it covers both doors into the agent — the tool surface and the command surface", () => {
    const kinds = new Set(release.observed.map((c) => c.surface));
    expect(kinds).toEqual(new Set(["mcp-tool", "cli-command"]));
    // Non-vacuity for the observation itself: an empty or one-item surface would
    // make every comparison in this file trivially true, and the probe returning
    // nothing is exactly how that would happen.
    expect(release.observed.filter((c) => c.surface === "mcp-tool").length).toBeGreaterThan(10);
    expect(release.observed.filter((c) => c.surface === "cli-command").length).toBeGreaterThan(10);
    for (const c of release.observed) expect(c.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a capability the artefact exposes and the manifest omits fails the release", () => {
    const dropped = release.manifest.capabilities.find((c) => c.surface === "mcp-tool")!;
    const verdict = verifyRelease(
      mutated({ capabilities: release.manifest.capabilities.filter((c) => c !== dropped) }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({
      kind: "capability-undeclared",
      name: dropped.name,
      surface: "mcp-tool",
    });
  });

  test("a capability the manifest claims and the artefact does not answer to fails the release", () => {
    const invented: Capability = { name: "ost_send_email", surface: "mcp-tool", fingerprint: sha256("invented") };
    const verdict = verifyRelease(mutated({ capabilities: [...release.manifest.capabilities, invented] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({ kind: "capability-absent", name: "ost_send_email", surface: "mcp-tool" });
  });

  test("a tool that kept its name and changed its arguments fails the release", () => {
    // The case a name-only manifest calls unchanged: audited as one thing,
    // shipping as another.
    const target = release.manifest.capabilities.find((c) => c.surface === "mcp-tool")!;
    const verdict = verifyRelease(
      mutated({
        capabilities: release.manifest.capabilities.map((c) =>
          c === target ? { ...c, fingerprint: sha256("a widened schema") } : c,
        ),
      }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({
      kind: "capability-changed",
      name: target.name,
      surface: "mcp-tool",
      declared: sha256("a widened schema"),
      actual: target.fingerprint,
    });
  });

  test("a release stamped with the wrong version fails", () => {
    const verdict = verifyRelease(mutated({ version: "9.9.9" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.kind)).toContain("version-mismatch");
  });
});

describe("the signature, whose key is a human's to hold", () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");

  test("a signed manifest verifies against the key that signed it", () => {
    const signature = signManifest(release.manifest, keys.privateKey);
    expect(signature.algorithm).toBe("ed25519");
    expect(signature.publicKey).toBe(publicKeyOf(keys.privateKey));
    expect(signatureVerifies(release.manifest, signature)).toBe(true);

    const verdict = verifyRelease({ ...mutated({ signature }), trustedPublicKey: publicKeyOf(keys.publicKey) });
    expect(verdict.failures).toEqual([]);
    expect(verdict.authenticity).toBe("trusted");
    expect(verdict.ok).toBe(true);
  });

  test("the signature covers the capability list, so a rewritten one does not verify", () => {
    const signature = signManifest(release.manifest, keys.privateKey);
    const rewritten = mutated({
      signature,
      capabilities: release.manifest.capabilities.filter((c) => c.surface !== "mcp-tool"),
    });
    expect(signatureVerifies(rewritten.manifest, signature)).toBe(false);
    const verdict = verifyRelease({ ...rewritten, trustedPublicKey: publicKeyOf(keys.publicKey) });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.kind)).toContain("signature-invalid");
  });

  test("the signature covers the artefact digest, so a swapped binary does not verify", () => {
    const signature = signManifest(release.manifest, keys.privateKey);
    const swapped = mutated({ signature, artifact: { ...release.manifest.artifact, sha256: sha256("another build") } });
    expect(signatureVerifies(swapped.manifest, signature)).toBe(false);
  });

  test("a signature by a key nobody trusts is not a trusted release", () => {
    const signature = signManifest(release.manifest, other.privateKey);
    const verdict = verifyRelease({ ...mutated({ signature }), trustedPublicKey: publicKeyOf(keys.publicKey) });
    expect(verdict.ok).toBe(false);
    expect(verdict.authenticity).toBe("self-signed");
    expect(verdict.failures.map((f) => f.kind)).toContain("signature-untrusted-key");
  });

  test("garbage in the signature field is a refusal, never a crash", () => {
    const junk = { algorithm: "ed25519", publicKey: "not-a-key", value: "not-a-signature" } as const;
    expect(signatureVerifies(release.manifest, junk)).toBe(false);
    expect(verifyRelease(mutated({ signature: junk })).failures.map((f) => f.kind)).toContain("signature-invalid");
  });

  test("re-serialising the manifest does not invalidate the signature", () => {
    // The file on disk is pretty-printed for a human to read; the signature is
    // over the canonical compact form. Re-indenting the file, or building the
    // object with its keys in another order, must not break verification — a
    // signature that fails for formatting reasons is one somebody stops checking.
    const signature = signManifest(release.manifest, keys.privateKey);
    const reordered = {
      capabilities: [...release.manifest.capabilities].reverse(),
      artifact: release.manifest.artifact,
      version: release.manifest.version,
      schema: release.manifest.schema,
      signature,
    } as CapabilityManifest;
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(release.manifest));
    expect(signatureVerifies(reordered, signature)).toBe(true);
  });

  test("the shipped release states its authenticity rather than implying it", () => {
    // Today: no key is published, so the manifest is bound and unattributed, and
    // the verdict says exactly that. This assertion is the one that changes when
    // a human provisions a key — deliberately, in a commit that has to argue for
    // itself.
    const verdict = verifyRelease(release);
    expect(fs.existsSync(path.join(root, RELEASE_KEY_PATH))).toBe(false);
    expect(release.manifest.signature).toBeNull();
    expect(verdict.authenticity).toBe("unsigned");
  });

  test("once a key is published, an unsigned build stops shipping", () => {
    const verdict = verifyRelease({ ...release, trustedPublicKey: publicKeyOf(keys.publicKey) });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.map((f) => f.kind)).toContain("signature-missing");
  });
});

describe("the observation reads the artefact, and says so when it cannot", () => {
  test("a tools/list response with no result is an error rather than an empty surface", () => {
    expect(() => parseToolsList('{"jsonrpc":"2.0","id":1,"error":{"code":-32601}}\n')).toThrow(/no tools\/list result/);
    expect(() => parseToolsList("")).toThrow(/no tools\/list result/);
    // A log line on stdout is not a protocol failure; the result after it still counts.
    expect(
      parseToolsList(`starting up\n{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"ost_check"}]}}\n`),
    ).toEqual([{ name: "ost_check" }]);
  });

  test("the command table is read as entries, not as wrapped description text", () => {
    const help = [
      "Usage: ost-agent [options] [command]",
      "",
      "Commands:",
      "  init [options] [folder]",
      "  result [options] <test>      record what happened when a human ran an",
      "                               assumption test — this continuation line is",
      "                               not a command",
      "  help [command]               display help for command",
    ].join("\n");
    expect(parseCommandTable(help)).toEqual([
      { name: "init", usage: "[options] [folder]" },
      { name: "result", usage: "[options] <test>" },
      { name: "help", usage: "[command]" },
    ]);
  });

  test("help with no command table is an error rather than an empty surface", () => {
    expect(() => parseCommandTable("Usage: ost-agent\n")).toThrow(/no "Commands:" section/);
    expect(() => parseCommandTable("Commands:\n")).toThrow(/lists no commands/);
  });
});

describe("a divergent build fails the release rather than shipping", () => {
  test("the check runs inside the gate that decides the merge", () => {
    // This file is the check. It is worth nothing if the gate that blocks a
    // merge does not run it, and both ways that could happen are asserted here:
    // the suite is a core gate, and this file is not on the suite's exclusion
    // list. `gate-coverage.ts` makes either change a visible, isolated commit.
    expect(CORE_GATES.map((g) => g.argv.join(" "))).toContain("npx vitest run");
    expect(SUITE_EXCLUSIONS).not.toContain("test/release/capability-manifest.test.ts");
  });

  test("the operator's own command exits non-zero on a manifest that no longer matches", () => {
    // End to end against the committed binary, in the shape an operator runs it:
    // a release laid out on disk whose manifest has had one tool quietly removed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-manifest-divergence-"));
    try {
      fs.mkdirSync(path.join(dir, "dist"));
      fs.copyFileSync(path.join(root, ARTIFACT_PATH), path.join(dir, ARTIFACT_PATH));
      fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
      const dropped = release.manifest.capabilities.find((c) => c.surface === "mcp-tool")!;
      const narrowed: CapabilityManifest = {
        ...release.manifest,
        capabilities: release.manifest.capabilities.filter((c) => c !== dropped),
      };
      fs.writeFileSync(path.join(dir, MANIFEST_PATH), JSON.stringify(narrowed, null, 2), "utf8");

      const run = spawnSync(process.execPath, [path.join(dir, ARTIFACT_PATH), "capability-manifest"], {
        encoding: "utf8",
      });
      expect(run.status, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(1);
      expect(run.stderr).toMatch(/DIVERGED/);
      expect(run.stderr).toContain(dropped.name);

      // ...and the same command over an intact release exits 0, so the assertion
      // above is discriminating rather than a command that always fails.
      fs.writeFileSync(path.join(dir, MANIFEST_PATH), JSON.stringify(release.manifest, null, 2), "utf8");
      const clean = spawnSync(process.execPath, [path.join(dir, ARTIFACT_PATH), "capability-manifest"], {
        encoding: "utf8",
      });
      expect(clean.status, `stdout:\n${clean.stdout}\nstderr:\n${clean.stderr}`).toBe(0);
      expect(clean.stdout).toMatch(/MATCHES/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
