/**
 * Load and validate `ost.config.yaml` from a vault directory.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config } from "./schema.js";

export const CONFIG_FILENAME = "ost.config.yaml";

export function configPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), CONFIG_FILENAME);
}

/** Read + validate the config. Throws a readable error on invalid/missing config. */
export function loadConfig(vaultDir: string): Config {
  const p = configPath(vaultDir);
  if (!fs.existsSync(p)) {
    throw new Error(`no ${CONFIG_FILENAME} in ${vaultDir} — run \`ost-agent init\` first`);
  }
  const raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`invalid ${CONFIG_FILENAME}:\n${issues}`);
  }
  return result.data;
}
