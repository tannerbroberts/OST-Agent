/**
 * Failure legibility helpers for the CLI surfaces.
 *
 * The knowledge processes (P2–P5) call the Anthropic SDK; run without a
 * credential they die with the SDK's "Could not resolve authentication method"
 * message, which names neither of the real fixes. This maps that failure —
 * and only that failure — to an actionable message. The original error is
 * always preserved: a hint may be added, information is never replaced.
 */

const AUTH_SHAPED = /could not resolve authentication|apiKey or authToken|ANTHROPIC_API_KEY|x-api-key header is required|401/i;

export function withAuthHint(message: string): string {
  if (!AUTH_SHAPED.test(message)) return message;
  return (
    `${message}\n` +
    `  This process needs a model. Two ways forward:\n` +
    `  - set ANTHROPIC_API_KEY (or run \`claude setup-token\` for an OAuth token), or\n` +
    `  - skip API keys entirely: drive the tree from Claude Code over MCP (no API key needed) — ` +
    `install the plugin with /plugin marketplace add tannerbroberts/OST-Agent, then /plugin install ost-agent@ost-agent, and run /ost-pass.`
  );
}
