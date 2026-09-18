import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = resolve(packageRoot, ".devspace", "git-fixtures");
const home = resolve(packageRoot, ".devspace", "fixture-home");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function run(command, args, { cwd, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function initRepo(path) {
  mkdirSync(path, { recursive: true });
  if (!existsSync(resolve(path, ".git"))) {
    run("git", ["init"], { cwd: path });
  }
  const hasCommit = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: path, encoding: "utf8" }).status === 0;
  if (!hasCommit) {
    run("git", ["-c", "user.name=Codex", "-c", "user.email=codex@example.invalid", "commit", "--allow-empty", "-m", "init"], { cwd: path });
  }
}

function chatgptInit(cwd) {
  const result = run(process.execPath, [bin, "init"], {
    cwd,
    env: {
      CHATGPT_PRO_HOME: home,
    },
  });
  return JSON.parse(result.stdout);
}

if (flag("reset")) {
  rmSync(fixturesRoot, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

mkdirSync(fixturesRoot, { recursive: true });
mkdirSync(home, { recursive: true });

const repoA = resolve(fixturesRoot, "repo-a");
const repoB = resolve(fixturesRoot, "repo-b");
const worktreeA = resolve(fixturesRoot, "repo-a-worktree");

initRepo(repoA);
if (!existsSync(worktreeA)) {
  run("git", ["worktree", "add", worktreeA, "HEAD"], { cwd: repoA });
}
initRepo(repoB);

const repoAInit = chatgptInit(repoA);
const worktreeInit = chatgptInit(worktreeA);
const repoBInit = chatgptInit(repoB);

assert.equal(repoAInit.project.identitySource, "git_config:chatgpt-pro.projectId");
assert.equal(worktreeInit.project.identitySource, "git_config:chatgpt-pro.projectId");
assert.equal(repoBInit.project.identitySource, "git_config:chatgpt-pro.projectId");
assert.equal(worktreeInit.project.projectId, repoAInit.project.projectId);
assert.equal(worktreeInit.sessions.path, repoAInit.sessions.path);
assert.notEqual(repoBInit.project.projectId, repoAInit.project.projectId);
assert.notEqual(repoBInit.sessions.path, repoAInit.sessions.path);

const result = {
  ok: true,
  fixturesRoot,
  home,
  repoA: {
    path: repoA,
    projectId: repoAInit.project.projectId,
    sessionsPath: repoAInit.sessions.path,
  },
  repoAWorktree: {
    path: worktreeA,
    projectId: worktreeInit.project.projectId,
    sessionsPath: worktreeInit.sessions.path,
  },
  repoB: {
    path: repoB,
    projectId: repoBInit.project.projectId,
    sessionsPath: repoBInit.sessions.path,
  },
  repoASessions: JSON.parse(readFileSync(repoAInit.sessions.path, "utf8")),
  repoBSessions: JSON.parse(readFileSync(repoBInit.sessions.path, "utf8")),
};

console.log(JSON.stringify(result, null, 2));
