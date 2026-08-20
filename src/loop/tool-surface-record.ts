/**
 * The tool-surface observation a run record stamps at start — which tools the
 * firing had, and which of its required tools it expected and did not get.
 *
 * **Why this reuses `required-tools.ts` rather than asking the surface again.**
 * `checkRequiredTools` already turns a declaration and an available-tools list
 * into exactly this comparison, at the moment `loop start` fires — the shell
 * wrapper resolves `--available` from static grant lists, never by calling a
 * tool, so re-deriving the same gap here costs a second read of the same file
 * and nothing else. It is deliberately NOT re-listing a live surface the way
 * `tool-surface-preflight.ts` does: this module answers "what did the run
 * record say", not "is the live surface honest about it" — those are different
 * claims and the second one already has its own instrument.
 *
 * **The load-bearing half.** A block naming only what resolved is easy and
 * nearly useless on its own — the diagnostic value this was proposed for is
 * entirely in `expectedAndAbsent`, which needs the `required-tools` half of the
 * declaration to exist at all. See "Every run records the tool surface it
 * actually had".
 *
 * **The honest-failure half.** A pass file that cannot be read, or that has no
 * usable declaration, is not the same fact as "nothing was required" — reading
 * it that way would make an undeclared pass look like a pass with a clean
 * surface. Both come back `unknown` so the run record can say it could not
 * determine its surface rather than staying silent about the block entirely.
 */
import fs from "node:fs";
import { isDeclarationProblem, parseToolDeclaration, resolveRequiredTools } from "../mcp/required-tools.js";

/** What a firing had, and what it declared it could not work without and did not get. */
export interface ToolSurfaceRecord {
  /** The tools the firing was actually able to call — `available`, verbatim. */
  readonly present: readonly string[];
  /** Required tools `available` does not cover, in declaration syntax. Empty means none were missing. */
  readonly expectedAndAbsent: readonly string[];
}

/** The surface could not be determined at all — this run's declaration or pass file was unusable. */
export interface ToolSurfaceUnknown {
  readonly unknown: string;
}

export type ToolSurfaceObservation = ToolSurfaceRecord | ToolSurfaceUnknown;

export function isToolSurfaceUnknown(o: ToolSurfaceObservation): o is ToolSurfaceUnknown {
  return "unknown" in o;
}

/**
 * Derive the observation from a declaration file and the tools the firing will
 * actually be able to call. Pure and side-effect-free beyond the one file read
 * — no tool named anywhere in the result is invoked or listed live, which is
 * what lets this run at `loop start`, ahead of anything the firing does.
 */
export function observeToolSurface(opts: {
  /** The SKILL.md (or command file) declaring `allowed-tools` and `required-tools`. */
  passFile: string;
  /** The tools this firing will actually be able to call. */
  available: readonly string[];
}): ToolSurfaceObservation {
  let markdown: string;
  try {
    markdown = fs.readFileSync(opts.passFile, "utf8");
  } catch (e) {
    return { unknown: `${opts.passFile} is unreadable (${e instanceof Error ? e.message : String(e)})` };
  }
  const declaration = parseToolDeclaration(markdown);
  if (isDeclarationProblem(declaration)) {
    return { unknown: declaration.problem };
  }
  const resolution = resolveRequiredTools(declaration, opts.available);
  return {
    present: [...opts.available],
    expectedAndAbsent: resolution.missingRequired.map((g) => g.demand.entry),
  };
}
