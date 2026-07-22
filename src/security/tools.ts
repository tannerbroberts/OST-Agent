/**
 * The allowlist tool registry — the ONLY tools the agent is ever given.
 *
 * Each tool wraps an append-only Vault method or a fixed safe-git call. There is
 * no general filesystem, shell, delete, or history-rewrite tool anywhere in this
 * set, so a prompt-injection attempt in ingested content cannot escalate: there
 * is simply no dangerous tool to invoke.
 *
 * Tools are defined with `betaTool` (raw JSON Schema) rather than `betaZodTool`
 * so the tool schemas do not couple us to a specific Zod major version.
 */
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { gitCommit, gitPush } from "../git/safe-git.js";
import { type NodeStatus, type OstNode } from "../ost/node.js";
import { Vault } from "../ost/vault.js";
import { ALLOWED_TOOL_NAMES } from "./policy.js";

const STATUS_VALUES = ["unvalidated", "validated", "in-discovery", "shipped", "deferred"];

/** Which parent layers a given child layer may attach under (Outcome is not creatable). */
const CHILD_HIERARCHY: Record<string, string[]> = {
  Opportunity: ["Outcome", "Opportunity"],
  Solution: ["Opportunity"],
  AssumptionTest: ["Solution"],
};

export interface RemoteConfig {
  enabled: boolean;
  url?: string;
}

export interface ToolContext {
  vault: Vault;
  /** Vault directory (git working tree). */
  dir: string;
  remote: RemoteConfig;
}

/**
 * Build the full allowlist tool set for a pass. `allowedNames` optionally narrows
 * it to a subset (a given process only gets the tools it needs); every returned
 * tool's name is guaranteed to be in {@link ALLOWED_TOOL_NAMES}.
 */
export function buildOstTools(ctx: ToolContext, allowedNames?: readonly string[]) {
  const { vault, dir, remote } = ctx;

  const all = [
    betaTool({
      name: "ost_read_tree",
      description:
        "Read the current Opportunity Solution Tree: returns every node with its title, layer, status, tags, and child links. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const nodes = vault.readTree().map((n) => ({
          title: n.title,
          layer: n.layer,
          status: n.status ?? null,
          tags: n.tags,
          links: n.links,
        }));
        return JSON.stringify({ count: nodes.length, nodes }, null, 2);
      },
    }),

    betaTool({
      name: "ost_create_node",
      description:
        "Create a NEW node AND attach it under an existing parent in one atomic step — so a node can never be an orphan. You CANNOT create an Outcome (there is exactly one, human-set at init). Hierarchy is enforced: an Opportunity attaches under the Outcome or another Opportunity; a Solution under an Opportunity; an AssumptionTest under a Solution. The type tag (#Opportunity / #Solution / #AssumptionTest) is applied automatically.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Node title; also the filename." },
          layer: { type: "string", enum: ["Opportunity", "Solution", "AssumptionTest"], description: "Opportunity | Solution | AssumptionTest (Outcome cannot be created here)" },
          parent: { type: "string", description: "Title of the existing parent node to attach under." },
          body: { type: "string", description: "Prose description of the node." },
          status: { type: "string", enum: STATUS_VALUES },
          source: { type: "string", description: "Provenance, e.g. JIRA:PROJ-1234 or INBOX:note.md" },
          confidence: { type: "string" },
          tags: { type: "array", items: { type: "string" }, description: "Extra tags, e.g. ['unvalidated']" },
        },
        required: ["title", "layer", "parent", "body"],
      },
      run: async (input: {
        title: string;
        layer: string;
        parent: string;
        body: string;
        status?: string;
        source?: string;
        confidence?: string;
        tags?: string[];
      }) => {
        const allowedParents = CHILD_HIERARCHY[input.layer];
        if (!allowedParents) {
          throw new Error(`cannot create layer "${input.layer}" (the Outcome is human-set at init and there is exactly one)`);
        }
        if (!vault.has(input.parent)) {
          throw new Error(`parent "${input.parent}" does not exist — create it before attaching under it`);
        }
        const parentLayer = vault.read(input.parent).layer;
        if (!allowedParents.includes(parentLayer)) {
          throw new Error(`a ${input.layer} must attach under ${allowedParents.join(" or ")}, but "${input.parent}" is a ${parentLayer}`);
        }
        const node: OstNode = {
          title: input.title,
          layer: input.layer as OstNode["layer"],
          body: input.body,
          tags: input.tags ?? [],
          links: [],
          status: input.status as NodeStatus | undefined,
          source: input.source,
          confidence: input.confidence,
          created: new Date().toISOString().slice(0, 10),
        };
        vault.createNode(node); // gets its #<layer> tag from serialize
        vault.linkNodes(input.parent, input.title); // attach to the tree atomically
        return `created ${node.layer} "${node.title}" under "${input.parent}"`;
      },
    }),

    betaTool({
      name: "ost_append_to_node",
      description:
        "Append a Markdown section to an existing node's body. Only grows the file — never truncates or rewrites. Use to add context or a note to a node.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          section: { type: "string", description: "Markdown to append (e.g. a '## Notes' block)." },
        },
        required: ["title", "section"],
      },
      run: async (input: { title: string; section: string }) => {
        vault.appendToNode(input.title, input.section);
        return `appended to "${input.title}"`;
      },
    }),

    betaTool({
      name: "ost_link_nodes",
      description:
        "Add a parent->child edge (a [[wikilink]] in the parent). Idempotent. Use to connect an Opportunity under the Outcome, a Solution under an Opportunity, or an AssumptionTest under a Solution.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          parent: { type: "string", description: "Title of the parent (higher layer) node." },
          child: { type: "string", description: "Title of the child (lower layer) node." },
        },
        required: ["parent", "child"],
      },
      run: async (input: { parent: string; child: string }) => {
        vault.linkNodes(input.parent, input.child);
        return `linked "${input.parent}" -> "${input.child}"`;
      },
    }),

    betaTool({
      name: "ost_set_status",
      description:
        "Set a node's status and record the transition in its History section (the prior value is preserved). Never mark an idea 'validated' without human-provided evidence in the note.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          status: { type: "string", enum: STATUS_VALUES },
          note: { type: "string", description: "Why the status changed / evidence reference." },
        },
        required: ["title", "status"],
      },
      run: async (input: { title: string; status: string; note?: string }) => {
        vault.setStatus(input.title, input.status as NodeStatus, input.note);
        return `status of "${input.title}" set to ${input.status}`;
      },
    }),

    betaTool({
      name: "ost_annotate",
      description:
        "Attach a hygiene/issue annotation to a node (under an Issues section). Add-only; never deletes. Use to flag orphans, dangling links, or likely duplicates.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          issue: { type: "string" },
        },
        required: ["title", "issue"],
      },
      run: async (input: { title: string; issue: string }) => {
        vault.annotate(input.title, input.issue);
        return `annotated "${input.title}"`;
      },
    }),

    betaTool({
      name: "git_commit",
      description:
        "Create a NEW git commit capturing all changes made to the vault this pass. History is never rewritten. Call this at the end of a pass.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: { type: "string", description: "Concise commit message describing what changed." },
        },
        required: ["message"],
      },
      run: async (input: { message: string }) => {
        const r = await gitCommit(dir, input.message);
        return r.committed ? `committed ${r.sha.slice(0, 8)}` : "nothing to commit";
      },
    }),

    betaTool({
      name: "git_push",
      description:
        "Fast-forward push the vault to its configured remote. No-op when no remote is configured. Never force-pushes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        if (!remote.enabled) return "remote push is disabled — no-op";
        await gitPush(dir);
        return "pushed to remote";
      },
    }),
  ];

  const names = allowedNames ? new Set(allowedNames) : null;
  return names ? all.filter((t) => names.has(t.name)) : all;
}

/** The names of the tools {@link buildOstTools} would produce (for vetting). */
export function toolNames(): string[] {
  return [...ALLOWED_TOOL_NAMES];
}
