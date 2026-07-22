/**
 * Atlassian adapter (read-only): Jira issues/comments + Confluence pages.
 *
 * Standalone tools cannot borrow a host's MCP connection, so this talks to the
 * Atlassian Cloud REST APIs directly with a least-privilege API token (Basic
 * auth, email:token). Every request is a GET — the adapter has no way to mutate
 * Jira or Confluence. Fetched content is untrusted DATA (it becomes evidence);
 * it never reaches a tool that could act on it.
 *
 * The HTTP layer is injected (`AtlassianClient`), so the mapping + incremental
 * cursor logic is exercised offline with a fake client, and the real HTTP client
 * is exercised with an injected `fetch` (verifying GET-only + auth shape).
 */
import type { Cursor, EvidenceItem, FetchResult, Source } from "./source.js";

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  comments: string[];
  updated: string; // ISO
  url: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  body: string;
  updated: string; // ISO
  url: string;
}

export interface AtlassianClient {
  searchJira(opts: { projects: string[]; since: string | null }): Promise<JiraIssue[]>;
  searchConfluence(opts: { spaces: string[]; since: string | null }): Promise<ConfluencePage[]>;
}

interface CursorState {
  since: string | null;
  /** ids emitted at exactly `since` — dropped next time to avoid boundary dupes. */
  seen: string[];
}

export interface AtlassianOptions {
  projects: string[];
  spaces: string[];
}

export class AtlassianSource implements Source {
  readonly name = "atlassian";

  constructor(
    private readonly client: AtlassianClient,
    private readonly opts: AtlassianOptions,
  ) {}

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const state = decode(cursor);

    const [issues, pages] = await Promise.all([
      this.opts.projects.length ? this.client.searchJira({ projects: this.opts.projects, since: state.since }) : Promise.resolve([]),
      this.opts.spaces.length ? this.client.searchConfluence({ spaces: this.opts.spaces, since: state.since }) : Promise.resolve([]),
    ]);

    const fetched: { id: string; updated: string; item: EvidenceItem }[] = [
      ...issues.map((i) => ({ id: `JIRA:${i.key}`, updated: i.updated, item: jiraToEvidence(i) })),
      ...pages.map((p) => ({ id: `CONFLUENCE:${p.id}`, updated: p.updated, item: confluenceToEvidence(p) })),
    ];

    const seen = new Set(state.seen);
    const items = fetched
      .filter((f) => !seen.has(f.id))
      .filter((f) => (state.since ? f.updated >= state.since : true))
      .map((f) => f.item);

    // advance the cursor to the newest `updated` we saw, remembering the ids at
    // that exact timestamp so the next run doesn't re-emit them
    let newSince = state.since;
    for (const f of fetched) if (!newSince || f.updated > newSince) newSince = f.updated;
    const newSeen = newSince ? fetched.filter((f) => f.updated === newSince).map((f) => f.id) : [];

    return { items, cursor: encode({ since: newSince, seen: newSeen }) };
  }
}

function jiraToEvidence(i: JiraIssue): EvidenceItem {
  const body = [i.description, ...i.comments.map((c, n) => `Comment ${n + 1}:\n${c}`)].filter((s) => s && s.trim()).join("\n\n---\n\n");
  return { id: `JIRA:${i.key}`, source: `JIRA:${i.key}`, title: `${i.key}: ${i.summary}`, body: body || i.summary, timestamp: i.updated, url: i.url };
}

function confluenceToEvidence(p: ConfluencePage): EvidenceItem {
  return { id: `CONFLUENCE:${p.id}`, source: `CONFLUENCE:${p.id}`, title: p.title, body: p.body, timestamp: p.updated, url: p.url };
}

function decode(cursor: Cursor): CursorState {
  if (!cursor) return { since: null, seen: [] };
  try {
    const parsed = JSON.parse(cursor) as Partial<CursorState>;
    return { since: parsed.since ?? null, seen: parsed.seen ?? [] };
  } catch {
    return { since: null, seen: [] };
  }
}

function encode(state: CursorState): string {
  return JSON.stringify(state);
}

// ─── Real HTTP client ──────────────────────────────────────────────────────────

type FetchFn = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface HttpAtlassianConfig {
  baseUrl: string; // e.g. https://your-domain.atlassian.net
  email: string;
  apiToken: string;
  maxResults?: number;
  fetchFn?: FetchFn;
}

/** Format an ISO timestamp for JQL/CQL: "yyyy-MM-dd HH:mm". */
function toAtlassianTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export class HttpAtlassianClient implements AtlassianClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly max: number;
  private readonly fetchFn: FetchFn;

  constructor(cfg: HttpAtlassianConfig) {
    this.base = cfg.baseUrl.replace(/\/$/, "");
    this.auth = "Basic " + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
    this.max = cfg.maxResults ?? 50;
    this.fetchFn = cfg.fetchFn ?? ((globalThis as unknown as { fetch: FetchFn }).fetch);
  }

  private headers(): Record<string, string> {
    return { Authorization: this.auth, Accept: "application/json" };
  }

  private async get(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, { method: "GET", headers: this.headers() });
    if (!res.ok) throw new Error(`Atlassian GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async searchJira(opts: { projects: string[]; since: string | null }): Promise<JiraIssue[]> {
    const clauses = [`project in (${opts.projects.map((p) => `"${p}"`).join(",")})`];
    if (opts.since) clauses.push(`updated >= "${toAtlassianTime(opts.since)}"`);
    const jql = `${clauses.join(" AND ")} ORDER BY updated ASC`;
    const params = new URLSearchParams({ jql, maxResults: String(this.max), fields: "summary,description,updated,comment" });
    const data = (await this.get(`${this.base}/rest/api/3/search/jql?${params}`)) as { issues?: JiraRaw[] };
    return (data.issues ?? []).map((raw) => ({
      key: raw.key,
      summary: raw.fields?.summary ?? "",
      description: adfToText(raw.fields?.description),
      comments: (raw.fields?.comment?.comments ?? []).map((c) => adfToText(c.body)),
      updated: raw.fields?.updated ?? "",
      url: `${this.base}/browse/${raw.key}`,
    }));
  }

  async searchConfluence(opts: { spaces: string[]; since: string | null }): Promise<ConfluencePage[]> {
    const clauses = [`type = page`, `space in (${opts.spaces.map((s) => `"${s}"`).join(",")})`];
    if (opts.since) clauses.push(`lastmodified >= "${toAtlassianTime(opts.since)}"`);
    const cql = clauses.join(" AND ");
    const params = new URLSearchParams({ cql, limit: String(this.max), expand: "body.storage,version,space" });
    const data = (await this.get(`${this.base}/wiki/rest/api/content/search?${params}`)) as { results?: ConfluenceRaw[] };
    return (data.results ?? []).map((raw) => ({
      id: raw.id,
      title: raw.title ?? "",
      body: htmlToText(raw.body?.storage?.value ?? ""),
      updated: raw.version?.when ?? "",
      url: `${this.base}/wiki${raw._links?.webui ?? ""}`,
    }));
  }
}

interface JiraRaw {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    updated?: string;
    comment?: { comments?: { body?: unknown }[] };
  };
}
interface ConfluenceRaw {
  id: string;
  title?: string;
  body?: { storage?: { value?: string } };
  version?: { when?: string };
  _links?: { webui?: string };
}

/** Extract plain text from an Atlassian Document Format (ADF) node tree. */
export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const n = node as { type?: string; text?: string; content?: unknown[] };
  let out = typeof n.text === "string" ? n.text : "";
  if (Array.isArray(n.content)) out += n.content.map(adfToText).join("");
  if (n.type === "paragraph" || n.type === "heading" || n.type === "listItem") out += "\n";
  return out;
}

/** Strip Confluence storage-format HTML to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
