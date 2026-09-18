import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { repoRoot, stateRoot } from "./runtime-config.mjs";
import { writeJsonAtomic } from "./atomic-json.mjs";

export const projectStatePath = resolve(stateRoot, "chatgpt-project.json");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function gitRemoteOrigin() {
  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitValue(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function setGitConfigProjectId(projectId) {
  const result = spawnSync("git", ["config", "--local", "chatgpt-pro.projectId", projectId], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to write git config chatgpt-pro.projectId");
  }
}

function gitCommonDir(topLevel) {
  const value = gitValue(["rev-parse", "--git-common-dir"]);
  if (!value) return "";
  return realpathSync(isAbsolute(value) ? value : resolve(topLevel, value));
}

function globalProjectRoot() {
  return resolve(process.env.CHATGPT_PRO_HOME || resolve(homedir(), ".chatgpt-pro-codex"), "projects");
}

export function canonicalProjectStateDir(projectId) {
  return resolve(globalProjectRoot(), projectId);
}

export function canonicalSessionRegistryPath(projectId) {
  return resolve(canonicalProjectStateDir(projectId), "chatgpt-sessions.json");
}

function canonicalRemote(url) {
  return String(url || "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export function computeProjectIdentity() {
  const realRoot = realpathSync(repoRoot);
  const topLevel = gitValue(["rev-parse", "--show-toplevel"]);
  const origin = gitRemoteOrigin();
  if (topLevel) {
    const realTopLevel = realpathSync(topLevel);
    let projectId = gitValue(["config", "--local", "--get", "chatgpt-pro.projectId"]);
    if (!projectId) {
      projectId = `cgpt_${randomUUID()}`;
      setGitConfigProjectId(projectId);
    }
    return {
      schemaVersion: 1,
      projectId,
      identitySource: "git_config:chatgpt-pro.projectId",
      repoRoot: realRoot,
      gitTopLevel: realTopLevel,
      gitCommonDir: gitCommonDir(realTopLevel),
      displayName: basename(realTopLevel),
      gitRemoteOrigin: origin || null,
      gitRemoteCanonical: canonicalRemote(origin) || null,
      canonicalProjectStateDir: canonicalProjectStateDir(projectId),
      canonicalSessionRegistryPath: canonicalSessionRegistryPath(projectId),
    };
  }

  const projectId = `dir_${sha256(realRoot)}`;
  return {
    schemaVersion: 1,
    projectId,
    identitySource: "non_git_realpath",
    repoRoot: realRoot,
    displayName: basename(realRoot),
    gitRemoteOrigin: origin || null,
    gitRemoteCanonical: canonicalRemote(origin) || null,
    canonicalProjectStateDir: canonicalProjectStateDir(projectId),
    canonicalSessionRegistryPath: canonicalSessionRegistryPath(projectId),
  };
}

export function ensureProjectState() {
  const identity = computeProjectIdentity();
  let existing = null;
  if (existsSync(projectStatePath)) {
    try {
      existing = JSON.parse(readFileSync(projectStatePath, "utf8"));
    } catch {
      existing = null;
    }
  }

  const state = {
    ...identity,
    createdAt: existing?.projectId === identity.projectId && existing?.createdAt
      ? existing.createdAt
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(projectStatePath), { recursive: true, mode: 0o700 });
  writeJsonAtomic(projectStatePath, state);
  return state;
}
