/**
 * Per-run build workspaces.
 *
 * A workspace path derived from a run id cannot collide with another run's,
 * because no two runs share a run id — unlike a fixed path (`/tmp/ost-main`
 * in the observed trace this replaces), which two overlapping firings would
 * both try to prepare and use at once. Teardown of a per-run workspace is
 * best-effort: a leaked directory costs disk, not the next firing's setup.
 *
 * The dependency tree is the expensive half of a workspace and stays shared:
 * `prepareWorkspace` never runs an installer itself, only links the run's
 * `node_modules` to an already-installed shared tree. A run whose shared tree
 * is not actually there gets `installed: false` back rather than a silent
 * install, because deciding how to install is a caller concern this function
 * has no opinion on.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** `<baseDir>/ost-<runId>` — unique for every distinct run id, so two runs never resolve to the same directory. */
export function workspacePathFor(runId: string, baseDir: string = os.tmpdir()): string {
  return path.join(baseDir, `ost-${runId}`);
}

export interface PrepareWorkspaceResult {
  dir: string;
  /** True when this call created a fresh `node_modules` symlink into `sharedDir`. */
  linked: boolean;
  /** True when neither a link nor an existing `node_modules` could be found — the shared tree is not there to share. */
  missingShared: boolean;
  /** True when a `node_modules` symlink was already there but pointed somewhere else, or at nothing, and was repointed. */
  relinked: boolean;
}

/**
 * Ensure `workspacePathFor(runId, baseDir)` exists and its `node_modules`
 * resolves to `sharedDir`'s, without reinstalling anything. Idempotent: a
 * second call for the same run id finds the link already in place and does
 * no filesystem-mutating work beyond the existence checks.
 *
 * **A link that is already right is success; a link that is wrong is repointed.**
 * `fs.existsSync` follows symlinks, so a `node_modules` link whose target has
 * since been removed — a shared tree reinstalled, a scratch checkout deleted —
 * reads as *absent* and the `symlinkSync` that follows fails with `EEXIST`.
 * That is `ln: …/node_modules: File exists`, the second half of the observed
 * setup failure this workspace family exists to answer, and it survived the
 * move to per-run workspaces because the check that was meant to make the
 * operation idempotent asks about the target rather than about the link. The
 * check below is `lstatSync`, which answers about the entry itself. Repointing
 * is destructive only of a symlink, never of a real directory: an installed
 * `node_modules` that is not a link is left exactly where it is.
 */
export function prepareWorkspace(runId: string, sharedDir: string, baseDir?: string): PrepareWorkspaceResult {
  const dir = workspacePathFor(runId, baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const link = path.join(dir, "node_modules");
  const target = path.join(sharedDir, "node_modules");

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(link);
  } catch {
    existing = null;
  }

  if (existing && !existing.isSymbolicLink()) {
    // A real directory: somebody installed here. Not this function's to touch.
    return { dir, linked: false, missingShared: false, relinked: false };
  }

  if (existing) {
    const points = path.resolve(dir, fs.readlinkSync(link));
    if (points === path.resolve(target) && fs.existsSync(link)) {
      return { dir, linked: false, missingShared: false, relinked: false };
    }
    if (!fs.existsSync(target)) {
      return { dir, linked: false, missingShared: true, relinked: false };
    }
    fs.unlinkSync(link);
    fs.symlinkSync(target, link, "dir");
    return { dir, linked: true, missingShared: false, relinked: true };
  }

  if (!fs.existsSync(target)) {
    return { dir, linked: false, missingShared: true, relinked: false };
  }

  fs.symlinkSync(target, link, "dir");
  return { dir, linked: true, missingShared: false, relinked: false };
}
