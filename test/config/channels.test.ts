/**
 * The channel layer's config shape (W1/S2/S3).
 *
 * The whole point of these assertions is what happens to a vault that already
 * exists: a config carrying nothing but `adapters.inbox` must keep meaning what it
 * has always meant, and a config that types the new key badly must cost the ingest
 * capability rather than the whole tool surface (G1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig, readConfig } from "../../src/config/load.js";
import { defaultConfigYaml, RESERVED_CHANNEL_NAMES } from "../../src/config/schema.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-channels-cfg-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(yaml: string) {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), yaml, "utf8");
}

describe("adapters.inbox keeps its meaning", () => {
  test("a config with no channels key at all yields channel zero and nothing else", () => {
    write("outcome: X\n");
    const cfg = loadConfig(dir);
    // The historical default, unchanged on purpose: moving it would mean a vault
    // whose config omits the key silently stops reading the folder it has.
    expect(cfg.adapters.inbox.path).toBe(".ost-agent/inbox");
    expect(cfg.adapters.inbox.channels).toEqual([]);
    // Non-vacuity: the field is really read from the file, not always-empty.
    write('outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../support-drop\n');
    expect(loadConfig(dir).adapters.inbox.channels.map((c) => c.name)).toEqual(["support"]);
  });

  /**
   * G1's failure mode, exactly: YAML hands `null` for a bare key, `z.array`
   * rejects null, and `loadConfig` is what every tool is built through. An
   * operator who typed `channels:` and went to look up the syntax must not take
   * the whole surface down over a key none of those tools read.
   */
  test("a bare `channels:` key is an empty list, not a thrown config", () => {
    write("outcome: X\nadapters:\n  inbox:\n    channels:\n");
    expect(loadConfig(dir).adapters.inbox.channels).toEqual([]);
    // Non-vacuity: the same file shape with a genuinely invalid entry DOES fail,
    // so "no throw" above is a decision about null and not about this key being
    // unvalidated.
    write("outcome: X\nadapters:\n  inbox:\n    channels:\n      - path: ../x\n");
    expect(readConfig(dir).problem).toMatch(/name/);
  });

  test("a channel may not take a name that already owns a cursor file", () => {
    for (const reserved of RESERVED_CHANNEL_NAMES) {
      write(`outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: ${reserved}\n        path: ../drop\n`);
      expect(readConfig(dir).problem, reserved).toMatch(/reserved/);
    }
    // Non-vacuity: an unreserved name of the same shape is accepted, so the
    // rejection is about the list and not about channels being refused wholesale.
    write("outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../drop\n");
    expect(readConfig(dir).problem).toBeUndefined();
  });

  test("two channels may not share a name — a name IS the cursor file", () => {
    write(
      "outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../a\n      - name: support\n        path: ../b\n",
    );
    expect(readConfig(dir).problem).toMatch(/duplicate/);
    // Non-vacuity: two DIFFERENT names over the same two paths load fine.
    write(
      "outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../a\n      - name: sales\n        path: ../b\n",
    );
    expect(readConfig(dir).problem).toBeUndefined();
  });

  test("a name that is a path segment is refused before it can become a filename", () => {
    write('outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: "../../etc"\n        path: ../a\n');
    expect(readConfig(dir).problem).toMatch(/lowercase|name/i);
    // Non-vacuity control: a legal name at the same position is accepted.
    write("outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: a-b-1\n        path: ../a\n");
    expect(readConfig(dir).problem).toBeUndefined();
  });

  /**
   * There is no default cadence anywhere in this project, and an unreadable one
   * must not silently become "none": that would turn a typo into a channel that
   * can never be reported dead.
   */
  test("an unreadable cadence is refused rather than guessed at", () => {
    write("outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../a\n        cadence: soon\n");
    expect(readConfig(dir).problem).toMatch(/cadence/);
    write('outcome: X\nadapters:\n  inbox:\n    cadence: "6"\n');
    expect(readConfig(dir).problem).toMatch(/cadence/);
    // Non-vacuity: a readable cadence parses, and absent stays absent.
    write('outcome: X\nadapters:\n  inbox:\n    cadence: "7d"\n');
    expect(loadConfig(dir).adapters.inbox.cadence).toBe("7d");
    write("outcome: X\n");
    expect(loadConfig(dir).adapters.inbox.cadence ?? null).toBeNull();
  });
});

describe("defaultConfigYaml", () => {
  test("renders the in-vault path unless a caller asks to escape", () => {
    // A config nobody asked to escape must not claim to: this function also
    // renders the plain config used by docs and fixtures.
    expect(defaultConfigYaml("X")).toMatch(/path: "\.ost-agent\/inbox"/);
    expect(defaultConfigYaml("X", "T", { inboxPath: "../v.inbox" })).toMatch(/path: "\.\.\/v\.inbox"/);
  });

  test("an escaping path is written with the reason beside it, and both parse", () => {
    const yaml = defaultConfigYaml("X", "T", { inboxPath: "../v.inbox" });
    expect(yaml).toMatch(/OUTSIDE the vault on purpose/);
    write(yaml);
    expect(loadConfig(dir).adapters.inbox.path).toBe("../v.inbox");
    // Non-vacuity: the commented-out `channels:` example really is inert — the
    // parsed config has no channels in it despite the word appearing in the file.
    expect(yaml).toMatch(/^ +# channels:/m);
    expect(loadConfig(dir).adapters.inbox.channels).toEqual([]);
  });

  test("a vault folder whose name needs quoting still produces parseable YAML", () => {
    // `../My Vault.inbox` unquoted is still a valid YAML scalar, but `path: [x]`
    // or a leading `*` would not be — quoting removes the whole class.
    write(defaultConfigYaml("X", "T", { inboxPath: "../My Vault #1.inbox" }));
    expect(loadConfig(dir).adapters.inbox.path).toBe("../My Vault #1.inbox");
  });
});
