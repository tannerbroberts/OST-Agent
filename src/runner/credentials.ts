/**
 * The credential pre-flight for the model-driven path.
 *
 * The Anthropic SDK resolves auth lazily and, when it finds none, fails with
 * "Could not resolve authentication method. Expected either apiKey or authToken
 * to be set." That is accurate and useless: it names no variable to set, no
 * command to run, and — worst — it implies a credential is the only way in. It
 * is not. The MCP server holds no model and needs no key; a Claude Code session
 * supplies the reasoning. Anyone who bounces off this wall should learn that in
 * the same breath as being told about the key.
 */

/** The variables the SDK itself reads. Kept in one place so the check and the message cannot drift. */
const CREDENTIAL_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

export function anthropicCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return CREDENTIAL_VARS.some((v) => (env[v] ?? "").trim() !== "");
}

/**
 * The message itself, so a caller that reports failure its own way (the CLI
 * prefixes `<process> FAILED:`, which cron and `status` already key off) can use
 * the same words as a caller that throws.
 */
export function credentialGuidance(what = "this command"): string {
  return (
    `${what} drives a model and found no Anthropic credential (${CREDENTIAL_VARS.join(" or ")} is unset).\n` +
      `\nTwo ways forward — the second needs no key at all:\n` +
      `  1. Set a key:  export ANTHROPIC_API_KEY=sk-ant-...   (console.anthropic.com)\n` +
      `  2. Drive it from a Claude Code session instead. The MCP server holds no model and no key —\n` +
      `     the session supplies the reasoning:\n` +
      `       /plugin marketplace add tannerbroberts/OST-Agent\n` +
      `       /plugin install ost-agent\n` +
      `     or wire it by hand:  ost-agent mcp --vault <dir>\n` +
      `\nEverything that needs no model already works without a credential: init, status, check, debt, lanes, result.`
  );
}

/**
 * Throw an actionable error when the model-driven path has no credential.
 * `what` names the command being attempted so the message is locatable in a log.
 */
export function assertAnthropicCredentials(env: NodeJS.ProcessEnv = process.env, what = "this command"): void {
  if (anthropicCredentialsPresent(env)) return;
  throw new Error(credentialGuidance(what));
}
