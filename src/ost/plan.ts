/**
 * A plan: a sequence of reads and writes whose premise is pinned at read time.
 *
 * `writeWithHash` (`../git/read-write-hash-guard.ts`) already refuses a single write
 * whose OWN target drifted between the read that composed it and the write itself —
 * `Vault.editProse` uses it today. That catches the write, not the reasoning built on
 * top of it: a pass that reads several nodes, forms a plan spanning multiple calls,
 * and has an outside write land on ONE of them partway through will have every write
 * up to that point accepted (nothing they touched drifted) and everything after
 * accepted too, because each one only ever checks its own target — never whether the
 * premise the whole plan rests on is still standing. It ends with a partially-applied
 * plan built on something no longer true, which is worse than colliding cleanly or
 * waiting, because it looks finished.
 *
 * A `Plan` closes that gap by widening what "drift" means from one file to
 * everything the plan has read so far. Every `read` pins a fingerprint; every
 * `write` checks ALL of them before doing anything, not just the one it targets. The
 * first drift found — anywhere in what was read, whether or not this write touches
 * it — compromises the plan for good: this write is refused and so is every write
 * after it, even ones whose own target never moved. That is what keeps the tree
 * coherent under interruption: nothing the plan does after the moment its premise
 * stopped holding ever lands, so what is on disk is always a clean prefix of the
 * plan, never a mix of pre- and post-drift writes reasoning about different worlds.
 *
 * The refusal is also typed distinctly from a single write failing
 * ({@link PlanCompromisedError}, not `DriftError`), because the two mean different
 * things to a caller: a `DriftError` says retry this one call after a re-read; a
 * `PlanCompromisedError` says the plan itself is void — re-form it from a fresh read
 * rather than resuming where it left off.
 */
import fs from "node:fs";
import { describeDrift, hashContent, type ReadWithHash } from "../git/read-write-hash-guard.js";
import { deserialize, type OstNode } from "./node.js";
import type { Vault } from "./vault.js";

/**
 * Thrown by {@link Plan.write} once the plan's premise has drifted — distinct from a
 * single write's `DriftError` so a caller can tell "this call needs a retry" apart
 * from "this whole plan is void". `premiseTitle` is the node that drifted; it may be
 * a node this write never touches, because the plan's premise is everything it read,
 * not only what any one write targets.
 */
export class PlanCompromisedError extends Error {
  readonly premiseTitle: string;
  readonly whatDrifted: string;

  constructor(premiseTitle: string, whatDrifted: string) {
    super(
      `plan compromised: "${premiseTitle}" changed since this plan read it — ${whatDrifted}. ` +
        `The plan's premise no longer holds, so this write and every write remaining in the plan ` +
        `are refused rather than applied on top of a reasoning step that is no longer true. Re-read ` +
        `and re-form the plan; do not resume it.`,
    );
    this.name = "PlanCompromisedError";
    this.premiseTitle = premiseTitle;
    this.whatDrifted = whatDrifted;
  }
}

/** What a plan is willing to say about itself once it is done, or interrupted. */
export interface PlanReport {
  /** True once any node the plan read has drifted since. */
  compromised: boolean;
  /** The node whose drift compromised the plan, when `compromised` is true. */
  premiseTitle?: string;
  whatDrifted?: string;
  /** Writes that executed before compromise (or throughout, if never compromised). */
  applied: number;
  /** Writes refused because the plan was already compromised when they were attempted. */
  refused: number;
}

export class Plan {
  private readonly reads = new Map<string, ReadWithHash>();
  private compromise: { title: string; whatDrifted: string } | undefined;
  private appliedCount = 0;
  private refusedCount = 0;

  constructor(private readonly vault: Vault) {}

  /**
   * Read a node as part of this plan, pinning the fingerprint the plan's later
   * reasoning rests on. A node read this way becomes part of the plan's premise —
   * if it drifts before this plan's writes are done, every write from here on is
   * refused, whether or not that write's own target is this node.
   */
  read(title: string): OstNode {
    const p = this.vault.pathFor(title);
    if (!fs.existsSync(p)) {
      throw new Error(`no such node: ${title}`);
    }
    const content = fs.readFileSync(p, "utf8");
    this.reads.set(title, { content, hash: hashContent(content) });
    return deserialize(title, content);
  }

  /** The first node read by this plan whose content no longer matches what was read. */
  private findDrift(): { title: string; whatDrifted: string } | undefined {
    for (const [title, read] of this.reads) {
      const p = this.vault.pathFor(title);
      const current = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      if (hashContent(current) !== read.hash) {
        return { title, whatDrifted: describeDrift(read.content, current) };
      }
    }
    return undefined;
  }

  /**
   * Re-pin every read title's fingerprint to what is on disk right now, called
   * after a write this plan itself just made. Without this, a plan that reads a
   * node and later writes it (e.g. `read("Opp")` then `write(() =>
   * vault.linkNodes("Opp", child))`) would see its OWN accepted write as drift on
   * the very next call — the plan cannot tell its own hand from an outside one
   * unless it updates what it is comparing against every time it moves the file
   * itself. `findDrift` still runs first on every `write`, so any drift genuinely
   * present before this plan's own write executed is caught there, not masked here.
   */
  private absorbOwnWrite(): void {
    for (const title of this.reads.keys()) {
      const p = this.vault.pathFor(title);
      const content = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      this.reads.set(title, { content, hash: hashContent(content) });
    }
  }

  /**
   * Execute one write as part of this plan. Checks every node the plan has read —
   * not only what `op` is about to touch — before doing anything. Once the plan is
   * compromised it stays that way: `op` never runs again for the rest of this
   * plan's life, so nothing further lands on top of an invalidated premise.
   */
  write<T>(op: () => T): T {
    if (this.compromise === undefined) this.compromise = this.findDrift();
    if (this.compromise) {
      this.refusedCount++;
      throw new PlanCompromisedError(this.compromise.title, this.compromise.whatDrifted);
    }
    const result = op();
    this.appliedCount++;
    this.absorbOwnWrite();
    return result;
  }

  get isCompromised(): boolean {
    return this.compromise !== undefined;
  }

  report(): PlanReport {
    return {
      compromised: this.isCompromised,
      premiseTitle: this.compromise?.title,
      whatDrifted: this.compromise?.whatDrifted,
      applied: this.appliedCount,
      refused: this.refusedCount,
    };
  }
}
