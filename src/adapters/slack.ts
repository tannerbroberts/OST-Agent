/**
 * Slack adapter (read-only): messages from a set of channels become evidence.
 *
 * Like the Atlassian adapter, a standalone tool cannot borrow a host's Slack
 * connection, so this talks to the Slack Web API directly with a least-privilege
 * bot token (scopes: channels:history, channels:read). Every request is a GET —
 * the adapter has no way to post to Slack. Fetched text is untrusted DATA (it
 * becomes evidence); it never reaches a tool that could act on it.
 *
 * The HTTP layer is injected (`SlackClient`), so the mapping + incremental cursor
 * logic runs offline against a fake client, and the real HTTP client is exercised
 * with an injected `fetch` (verifying GET-only + Bearer auth shape).
 */
import type { Actor, Cursor, EvidenceItem, FetchResult, Source } from "./source.js";

export interface SlackMessage {
  /** Channel id (e.g. "C01234"). */
  channel: string;
  /** Slack message timestamp "epochSeconds.micros" — also the in-channel id. */
  ts: string;
  user?: string;
  text: string;
  permalink?: string;
}

export interface SlackClient {
  /** Return messages in `channels` at or after `since` (a Slack ts), read-only. */
  fetchMessages(opts: { channels: string[]; since: string | null }): Promise<SlackMessage[]>;
}

interface CursorState {
  /** Newest Slack ts emitted so far (or null). */
  since: string | null;
  /** ids emitted at exactly `since` — dropped next time to avoid boundary dupes. */
  seen: string[];
}

export interface SlackOptions {
  channels: string[];
}

/** Numeric compare of two Slack ts strings ("epoch.micros"). */
function tsGte(a: string, b: string): boolean {
  return parseFloat(a) >= parseFloat(b);
}
function tsGt(a: string, b: string): boolean {
  return parseFloat(a) > parseFloat(b);
}

export class SlackSource implements Source {
  readonly name = "slack";
  readonly actor: Actor = "slack";

  constructor(
    private readonly client: SlackClient,
    private readonly opts: SlackOptions,
  ) {}

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const state = decode(cursor);
    if (this.opts.channels.length === 0) return { items: [], cursor: encode(state) };

    const messages = await this.client.fetchMessages({ channels: this.opts.channels, since: state.since });

    const fetched = messages
      .filter((m) => m.text && m.text.trim().length > 0)
      .map((m) => ({ id: `SLACK:${m.channel}:${m.ts}`, ts: m.ts, item: slackToEvidence(m) }));

    const seen = new Set(state.seen);
    const items = fetched
      .filter((f) => !seen.has(f.id))
      .filter((f) => (state.since ? tsGte(f.ts, state.since) : true))
      .map((f) => f.item);

    // advance the cursor to the newest ts we saw, remembering the ids at that exact
    // ts so the next run doesn't re-emit them
    let newSince = state.since;
    for (const f of fetched) if (!newSince || tsGt(f.ts, newSince)) newSince = f.ts;
    const newSeen = newSince ? fetched.filter((f) => f.ts === newSince).map((f) => f.id) : [];

    return { items, cursor: encode({ since: newSince, seen: newSeen }) };
  }

  /**
   * Refuses to advance partially: `since` is a high-water mark, and no watermark can
   * express "the first three messages of this batch stored, the fourth did not".
   * Keeping the previous cursor re-fetches the batch, and `writeEvidence`'s
   * id-keyed idempotency drops the ones already on disk.
   */
  advanceCursor(previous: Cursor): Cursor {
    return previous;
  }
}

/** Slack ts ("epoch.micros") → ISO timestamp. */
export function tsToIso(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString();
}

function slackToEvidence(m: SlackMessage): EvidenceItem {
  const firstLine = m.text.trim().split("\n")[0].slice(0, 80);
  return {
    id: `SLACK:${m.channel}:${m.ts}`,
    source: `SLACK:${m.channel}:${m.ts}`,
    title: `#${m.channel}: ${firstLine}`,
    body: m.text.trim(),
    timestamp: tsToIso(m.ts),
    url: m.permalink,
  };
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

export interface HttpSlackConfig {
  /** Bot token (xoxb-…) with read-only history scopes. */
  token: string;
  /** Per-channel page size (Slack `limit`, default 100). */
  maxResults?: number;
  fetchFn?: FetchFn;
}

interface SlackHistoryResponse {
  messages?: { ts: string; user?: string; text?: string; subtype?: string }[];
}
interface SlackListResponse {
  channels?: { id: string; name: string }[];
  response_metadata?: { next_cursor?: string };
}

/** A resolved Slack channel id looks like C…/G…/D… (uppercase, several chars). */
function looksLikeChannelId(s: string): boolean {
  return /^[CGD][A-Z0-9]{6,}$/.test(s);
}

export class HttpSlackClient implements SlackClient {
  private readonly token: string;
  private readonly max: number;
  private readonly fetchFn: FetchFn;
  /** channel name → id, lazily populated from conversations.list on first name lookup. */
  private nameToId: Map<string, string> | null = null;

  constructor(cfg: HttpSlackConfig) {
    this.token = cfg.token;
    this.max = cfg.maxResults ?? 100;
    this.fetchFn = cfg.fetchFn ?? ((globalThis as unknown as { fetch: FetchFn }).fetch);
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Slack GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as T & { ok?: unknown; error?: unknown };
    if (data.ok !== true) throw new Error(`Slack API error: ${String(data.error ?? "unknown")}`);
    return data;
  }

  /** Resolve a channel id or #name to a channel id (names via conversations.list, cached). */
  private async resolveChannelId(nameOrId: string): Promise<string> {
    if (looksLikeChannelId(nameOrId)) return nameOrId;
    const name = nameOrId.replace(/^#/, "");
    if (!this.nameToId) {
      this.nameToId = new Map();
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ types: "public_channel,private_channel", limit: "1000", exclude_archived: "true" });
        if (cursor) params.set("cursor", cursor);
        const data = await this.get<SlackListResponse>(`https://slack.com/api/conversations.list?${params}`);
        for (const c of data.channels ?? []) this.nameToId.set(c.name, c.id);
        cursor = data.response_metadata?.next_cursor || undefined;
      } while (cursor);
    }
    const id = this.nameToId.get(name);
    if (!id) throw new Error(`Slack channel "${nameOrId}" not found — is the bot a member, and does the token have channels:read?`);
    return id;
  }

  async fetchMessages(opts: { channels: string[]; since: string | null }): Promise<SlackMessage[]> {
    const out: SlackMessage[] = [];
    for (const configured of opts.channels) {
      const channel = await this.resolveChannelId(configured);
      const params = new URLSearchParams({ channel, limit: String(this.max) });
      if (opts.since) params.set("oldest", opts.since); // inclusive; boundary dupes handled by the cursor's `seen`
      const data = await this.get<SlackHistoryResponse>(`https://slack.com/api/conversations.history?${params}`);
      for (const m of data.messages ?? []) {
        // skip system events (joins, topic changes, bot adds); keep human messages
        if (m.subtype) continue;
        out.push({ channel, ts: m.ts, user: m.user, text: m.text ?? "" });
      }
    }
    return out;
  }
}
