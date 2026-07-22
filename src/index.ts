/**
 * OST-Agent — public entry surface.
 *
 * The real work lives under `src/{ost,security,git,adapters,processes,runner,scheduler,cli}`.
 * This module re-exports the stable pieces once they exist; for now it marks the package
 * as present so tooling and the CLI bin have a resolvable root.
 */
export const VERSION = "0.1.0";
