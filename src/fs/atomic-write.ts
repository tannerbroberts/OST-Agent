/**
 * The naming and cleanup half of an atomic file write.
 *
 * A node file is written by `fs.writeFileSync`, which is `open(O_TRUNC)` then
 * one or more `write` calls. A process that dies anywhere inside that sequence
 * leaves the file it was writing SHORTER than both the version it replaced and
 * the version it meant to leave — a half-written node, which the census reads
 * as unparseable and a human reads as data loss. The window is small and it is
 * not zero: it is the whole of the "no half-written state" clause in the
 * resumable-journal solution this module was built for.
 *
 * The fix is the standard one — write the bytes to a temporary file, then
 * `rename` it over the target — and the reason it works is that `rename(2)`
 * within a directory is atomic to any other process: the name resolves to the
 * old inode or the new one, never to a partially filled file. A kill between
 * the two steps therefore costs a temporary file and nothing else.
 *
 * **The write is not made durable, on purpose.** `rename` without an `fsync` of
 * the file and its directory survives a process death (the page cache is the
 * kernel's, not the process's) but not a power cut or a kernel panic, where the
 * rename can land before the data. Buying that costs an `fsync` per node write
 * on a surface that writes a node per tool call, and the failure it insures
 * against is not the one this is for: the interruption under test is a killed
 * process. Stated here rather than left implied, so nobody reads "atomic" as
 * "durable".
 *
 * **Why the writes stay at the call sites.** {@link temporaryWritePath} hands
 * back a name and this module never writes a byte. `src/ost/vault.ts` has a
 * single-write-door invariant that `test/ost/vault-write-census.test.ts`
 * enforces by scanning the source for `fs.writeFileSync` lines — moving the
 * write in here would empty that scan and quietly retire the check. So the two
 * writers keep their own `writeFileSync`/`renameSync` pair and share only the
 * naming rule, which is the part that has to agree for {@link sweepAbandonedWrites}
 * to be able to recognise the residue.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * The suffix every temporary write carries. Not `.md`, so the vault census —
 * which enumerates `*.md` at the root — never sees a temporary as a node, and
 * a kill mid-write cannot manufacture a file the tree has to explain.
 */
export const TEMP_WRITE_SUFFIX = ".ost-tmp";

/**
 * Where the bytes for `filePath` are staged before the rename.
 *
 * Beside the target rather than in `os.tmpdir()`, because `rename` is only
 * atomic within a filesystem and a vault on an external disk would otherwise
 * fall back to a copy — which is the truncation window again, wearing a
 * different name. The pid is in the name so two processes writing the same node
 * stage to different files and the loser of the rename race overwrites with a
 * whole file rather than interleaving bytes into one.
 */
export function temporaryWritePath(filePath: string): string {
  const dir = path.dirname(filePath);
  return path.join(dir, `.${path.basename(filePath)}.${process.pid}${TEMP_WRITE_SUFFIX}`);
}

/**
 * Remove temporary files left in `dir` by writes that were killed before their
 * rename, and report what was removed.
 *
 * Safe to run at any time and safe to run concurrently with a live write: a
 * temporary carries the writing process's pid, and this only removes files
 * whose pid is not a live process on this host. A staged file whose writer is
 * gone can never be renamed by anybody — the only reference to it died with the
 * process — so it is residue by definition rather than by timeout.
 *
 * One level, no recursion, and matched on the exact naming rule above. This is
 * the only place in the product that deletes a file inside a vault, which is why
 * it may not take a pattern from a caller: the safety invariant is that no tool
 * has a destructive capability, and a sweeper that could be pointed at `*.md`
 * would be one.
 */
export function sweepAbandonedWrites(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // no directory is not residue
  }
  const swept: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(".") || !entry.name.endsWith(TEMP_WRITE_SUFFIX)) continue;
    const pid = writerPid(entry.name);
    if (pid === null || processIsAlive(pid)) continue;
    fs.rmSync(path.join(dir, entry.name), { force: true });
    swept.push(entry.name);
  }
  return swept.sort();
}

/** The pid embedded by {@link temporaryWritePath}, or null when the name is not one of ours. */
function writerPid(name: string): number | null {
  const match = name.match(/\.(\d+)\.ost-tmp$/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Signal 0 — the liveness probe, the same one `lock.ts` uses to judge a lock
 * holder. EPERM means the pid exists and belongs to somebody else, which is
 * still alive; anything else means it is gone.
 */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
