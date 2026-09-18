import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const root = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-project-identity-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-project-home-"));

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

function initGitRepo(path) {
  mkdirSync(path, { recursive: true });
  run("git", ["init"], { cwd: path });
  run("git", ["-c", "user.name=Codex", "-c", "user.email=codex@example.invalid", "commit", "--allow-empty", "-m", "init"], { cwd: path });
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

try {
  const repoA = resolve(root, "repo-a");
  const repoB = resolve(root, "repo-b");
  const worktreeA = resolve(root, "repo-a-worktree");

  initGitRepo(repoA);
  const repoAInit = chatgptInit(repoA);

  run("git", ["worktree", "add", worktreeA, "HEAD"], { cwd: repoA });
  const worktreeInit = chatgptInit(worktreeA);

  initGitRepo(repoB);
  const repoBInit = chatgptInit(repoB);

  assert.match(repoAInit.project.projectId, /^cgpt_/);
  assert.equal(repoAInit.project.identitySource, "git_config:chatgpt-pro.projectId");
  assert.equal(worktreeInit.project.projectId, repoAInit.project.projectId);
  assert.equal(worktreeInit.sessions.path, repoAInit.sessions.path);
  assert.equal(repoAInit.project.gitCommonDir, worktreeInit.project.gitCommonDir);
  assert.equal(repoAInit.project.repoRoot, realpathSync(repoA));
  assert.equal(worktreeInit.project.repoRoot, realpathSync(worktreeA));

  assert.match(repoBInit.project.projectId, /^cgpt_/);
  assert.notEqual(repoBInit.project.projectId, repoAInit.project.projectId);
  assert.notEqual(repoBInit.sessions.path, repoAInit.sessions.path);
  assert.equal(repoBInit.project.repoRoot, realpathSync(repoB));

  assert.equal(repoAInit.project.canonicalSessionRegistryPath, repoAInit.sessions.path);
  assert.equal(worktreeInit.project.canonicalSessionRegistryPath, worktreeInit.sessions.path);
  assert.equal(repoBInit.project.canonicalSessionRegistryPath, repoBInit.sessions.path);
  assert.equal(repoAInit.sessions.path.startsWith(resolve(home, "projects")), true);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "project-identity" }, null, 2));
