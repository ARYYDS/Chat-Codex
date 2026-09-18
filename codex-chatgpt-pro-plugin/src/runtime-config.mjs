import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(process.env.CHATGPT_REPO_ROOT || process.cwd());
export const devspaceRoot = resolve(repoRoot, ".devspace");
export const runsRoot = resolve(devspaceRoot, "runs");
export const stateRoot = resolve(devspaceRoot, "state");
export const chromeProfilesRoot = resolve(devspaceRoot, "chrome-profiles");

export const DEFAULT_TARGET_URL = "https://chatgpt.com/";
export const DEFAULT_CDP_PORT = 9222;

export function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function profilePath(name = "chatgpt-pro") {
  return resolve(chromeProfilesRoot, name);
}

export function runId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function runDir(id) {
  return resolve(runsRoot, id);
}
