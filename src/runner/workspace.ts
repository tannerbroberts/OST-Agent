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
}

/**
 * Ensure `workspacePathFor(runId, baseDir)` exists and its `node_modules`
 * resolves to `sharedDir`'s, without reinstalling anything. Idempotent: a
 * second call for the same run id finds the link already in place and does
 * no filesystem-mutating work beyond the two existence checks.
 */
export function prepareWorkspace(runId: string, sharedDir: string, baseDir?: string): PrepareWorkspaceResult {
  const dir = workspacePathFor(runId, baseDir);
  fs.mkdirSync(dir, { recursive: true });

  const link = path.join(dir, "node_modules");
  if (fs.existsSync(link)) {
    return { dir, linked: false, missingShared: false };
  }

  const target = path.join(sharedDir, "node_modules");
  if (!fs.existsSync(target)) {
    return { dir, linked: false, missingShared: true };
  }

  fs.symlinkSync(target, link, "dir");
  return { dir, linked: true, missingShared: false };
}
