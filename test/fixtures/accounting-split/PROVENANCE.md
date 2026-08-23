# The 9-versus-27 accounting split, frozen

`INBOX:2026-07-25-friction-upgrading-the-cli-silently-reopened-18-mapped-ev.md` records one
moment: the same vault, the same instant, two builds. `ost-agent@0.1.3` reported **9**
outstanding evidence items; the build that was HEAD on 2026-07-25 reported **27**. Nothing
about the vault had changed — done-ness had moved from a scan of node `source:` frontmatter
to `.ost-agent/state/mapped.json`, a file no pass had ever written, so all 27 stored records
re-opened at once.

This directory is that moment, frozen, so a reconstruction can be measured against it.

## `vault/` — the state that produced the split

Taken from the OST-Agent meta vault at commit **`5f7875bb`** (2026-07-25T02:01:38Z), which is
the last commit before the diagnosis command ran at 02:01:55Z:

```bash
git archive 5f7875bb | tar -x -C /tmp/vault-split      # in the meta vault
```

It is **distilled, not copied**. Every input either accounting reads is preserved byte for
byte; everything else is dropped, because 800 kB of unrelated prose in a fixture is 800 kB
nobody will diff:

- `.ost-agent/evidence/*.md` — frontmatter verbatim (that is where the `id` lives), prose
  replaced by a marker line. All 27 records are present.
- root `*.md` (169 node files) — frontmatter verbatim (that is where `source:` lives), plus
  **every body line naming an evidence id** (52 lines across the tree). Those lines are kept
  on purpose: they are what a *wider* reconstruction rule would read, and the test uses them
  as its control.
- `ost.config.yaml` — verbatim except that `transcript.projectDir` (an absolute path on the
  machine that wrote it) was removed and the transcript adapter disabled, so the fixture does
  not reach outside itself.

## `oracle-0.1.3.json` — the old build's own answer, itemised

Not inferred. **Run**, from the only surviving copy of 0.1.3: the npm package was unpublished
on 2026-07-28 (`npm view ost-agent@0.1.3` is a 404), but the tag is still here.

```bash
git archive v0.1.3 | tar -x -C /tmp/ost013            # in this repository
cd /tmp/ost013 && npm install && npm run build
cd <vault> && node /tmp/ost013/dist/cli/index.js tool ost_next_work --vault . --input '{}'
```

Run against `/tmp/vault-split` it answers 9 outstanding. Run against the distilled `vault/`
here it answers **the same 9, in the same order** — which is what says the distillation kept
everything the accounting reads. That check is worth re-running by hand if this fixture is
ever regenerated; it is not in the suite, because the suite may not build a second copy of
the product from a git tag.

The recorded totals corroborate each other three ways: 9 outstanding and 27 outstanding are
both written in the friction note, 27 is also the item count of `.ost-agent/evidence/` at that
commit, and 0.1.3 re-run today reproduces the 9 exactly.
