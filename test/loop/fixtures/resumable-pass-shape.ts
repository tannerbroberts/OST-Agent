/**
 * The shape of the scratch pass, shared by the pass itself and by the test that
 * kills it.
 *
 * Separate from `resumable-pass.ts` because that file is a program: importing it
 * runs it, reads `process.argv` and exits. A test that wants to know what the
 * pass writes must be able to ask without executing it.
 */
export const OUTCOME = "Scratch outcome";
export const OPPORTUNITY = "Opportunity under test";
export const SOLUTION = "Solution under test";

/** The section each append adds. Present twice means a replay duplicated work. */
export const APPENDED_SECTION = "## Finding\n\nThe pass wrote this exactly once.";

/** Bulk beneath it, so a write that lost its tail would be visible rather than subtle. */
export const APPENDED_FILLER = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the appended finding`).join("\n");

/** How many steps the pass has. The kill grid is derived from it. */
export const STEPS = 6;
