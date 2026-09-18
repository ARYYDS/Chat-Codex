import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const proofRoot = resolve(packageRoot, ".devspace", "live-repo-thread-matrix", runId);
const reposRoot = resolve(proofRoot, "repos");
const repoA = resolve(reposRoot, "repo-a");
const repoAWorktree = resolve(reposRoot, "repo-a-worktree");
const repoB = resolve(reposRoot, "repo-b");

function run(command, args, { cwd, env = {}, maxBuffer = 80 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer,
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: cwd,
      CHATGPT_REPO_CONTEXT_MODE: "off",
      CHATGPT_THREAD_ECHO: "0",
      CHATGPT_RESPONSE_STABLE_MS: "2000",
      CHATGPT_RESPONSE_TIMEOUT_MS: "300000",
      CHATGPT_NEW_CHAT_SETTLE_MS: "8000",
      ...env,
    },
  });
  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(" ")}`,
      `cwd: ${cwd}`,
      result.stderr,
      result.stdout,
    ].filter(Boolean).join("\n"),
  );
  return result;
}

function runJson(args, { cwd, env = {} } = {}) {
  const result = run(process.execPath, [bin, ...args], { cwd, env });
  return JSON.parse(result.stdout);
}

function initGitRepo(path, label) {
  mkdirSync(path, { recursive: true });
  if (!existsSync(resolve(path, ".git"))) {
    run("git", ["init"], { cwd: path });
  }
  writeFileSync(resolve(path, "README.md"), `# ${label}\n\nLive repo/thread matrix fixture.\n`);
  run("git", ["add", "README.md"], { cwd: path });
  const hasCommit = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: path,
    encoding: "utf8",
  }).status === 0;
  if (!hasCommit) {
    run("git", [
      "-c",
      "user.name=Codex",
      "-c",
      "user.email=codex@example.invalid",
      "commit",
      "-m",
      "init",
    ], { cwd: path });
  } else {
    run("git", [
      "-c",
      "user.name=Codex",
      "-c",
      "user.email=codex@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      `matrix ${runId}`,
    ], { cwd: path });
  }
}

function conversationId(url) {
  try {
    return new URL(url).pathname.match(/\/c\/([^/?#]+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function receiptPathFromCallOutput(stdout) {
  const match = stdout.match(/^ChatGPT call receipt:\s+(.+)$/m);
  assert.ok(match, `missing receipt path in call output:\n${stdout}`);
  return match[1].trim();
}

function liveCall({ cwd, alias, prompt, mode = "continue", label }) {
  const args = [
    "call",
    `--alias=${alias}`,
    "--repo-context=off",
    `--prompt=${prompt}`,
  ];
  if (mode === "new") args.splice(2, 0, "--new");
  const result = run(process.execPath, [bin, ...args], { cwd });
  const receiptPath = receiptPathFromCallOutput(result.stdout);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const transcriptPath = receipt.artifacts?.transcript || resolve(receipt.runDir, "transcript.md");
  const assistantPath = receipt.artifacts?.assistant || resolve(receipt.runDir, "assistant.md");
  const transcript = readFileSync(transcriptPath, "utf8");
  const assistant = readFileSync(assistantPath, "utf8");
  assert.equal(receipt.ok, true, `${label} receipt failed: ${receiptPath}`);
  assert.equal(receipt.locks?.browser?.receipt?.released, true, `${label} did not release browser lock`);
  assert.equal(receipt.threadEcho?.mode, "disabled_by_env");
  assert.match(receipt.room?.conversationUrl || "", /^https:\/\/chatgpt\.com\/c\//);
  assert.ok(assistant.trim().length > 0, `${label} captured empty assistant response`);
  return {
    label,
    cwd,
    alias,
    prompt,
    receiptPath,
    transcriptPath,
    assistantPath,
    transcript,
    assistant,
    conversationUrl: receipt.room.conversationUrl,
    conversationId: conversationId(receipt.room.conversationUrl),
    projectId: receipt.project?.projectId || null,
    repoRoot: receipt.project?.repoRoot || null,
    assistantSha256: receipt.artifactHashes?.assistantSha256 || null,
  };
}

function exportHistory({ cwd, alias, marker, notMarkers = [], min = 2, label }) {
  const exported = runJson([
    "history",
    "export",
    `--alias=${alias}`,
    `--require-visible-min=${min}`,
  ], { cwd });
  assert.equal(exported.ok, true);
  assert.equal(exported.exportScope, "all_visible");
  assert.equal(exported.historyCompleteness?.claim, "all_loaded_dom_messages");
  assert.equal(exported.roomTarget?.targetBoundToRoom, true);
  assert.equal(exported.locks?.browser?.receipt?.released, true);

  const readback = runJson(["history", "read", `--path=${exported.artifacts.json}`], { cwd });
  assert.equal(readback.ok, true);
  assert.equal(readback.messageCount, exported.messageCount);
  assert.equal(readback.transcriptSha256, exported.transcriptSha256);

  const body = readback.messages.map((message) => message.text || "").join("\n\n");
  assert.match(body, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} history missing marker`);
  for (const notMarker of notMarkers) {
    assert.ok(!body.includes(notMarker), `${label} history leaked marker ${notMarker}`);
  }

  return {
    label,
    alias,
    artifact: exported.artifacts.json,
    markdown: exported.artifacts.markdown,
    conversationUrl: exported.target.url,
    conversationId: conversationId(exported.target.url),
    messageCount: exported.messageCount,
    roleCounts: exported.roleCounts,
    transcriptSha256: exported.transcriptSha256,
    historyCompleteness: exported.historyCompleteness,
    readback: {
      messageCount: readback.messageCount,
      transcriptSha256: readback.transcriptSha256,
    },
  };
}

function writeThreadEcho(calls) {
  const text = calls
    .map((call) => [
      `<!-- ${call.label} | ${call.alias} | ${call.conversationUrl} -->`,
      call.transcript.trim(),
      "",
    ].join("\n"))
    .join("\n");
  const path = resolve(proofRoot, "thread-echo.md");
  writeFileSync(path, text);
  return path;
}

rmSync(proofRoot, { recursive: true, force: true });
mkdirSync(reposRoot, { recursive: true });

initGitRepo(repoA, "repo-a");
run("git", ["worktree", "add", repoAWorktree, "HEAD"], { cwd: repoA });
initGitRepo(repoB, "repo-b");

const doctor = runJson(["doctor", "--live"], { cwd: packageRoot, env: { CHATGPT_REPO_ROOT: packageRoot } });
assert.equal(doctor.ok, true);

const repoAInit = runJson(["init"], { cwd: repoA });
const worktreeInit = runJson(["init"], { cwd: repoAWorktree });
const repoBInit = runJson(["init"], { cwd: repoB });

assert.equal(worktreeInit.project.projectId, repoAInit.project.projectId);
assert.equal(worktreeInit.sessions.path, repoAInit.sessions.path);
assert.notEqual(repoBInit.project.projectId, repoAInit.project.projectId);
assert.notEqual(repoBInit.sessions.path, repoAInit.sessions.path);

const markerAMainOne = `repo-a-main-one-${runId}`;
const markerAMainTwo = `repo-a-main-two-${runId}`;
const markerACritic = `repo-a-critic-${runId}`;
const markerBMain = `repo-b-main-${runId}`;

const repoAMainNew = liveCall({
  cwd: repoA,
  alias: "main",
  mode: "new",
  label: "repo-a main new",
  prompt: `Repository/thread matrix proof. Repo: repo-a. Alias: main. Marker: ${markerAMainOne}. Reply in one short sentence and include the marker.`,
});
const repoAMainContinue = liveCall({
  cwd: repoA,
  alias: "main",
  label: "repo-a main continue",
  prompt: `Continue the same repo-a main thread. Marker: ${markerAMainTwo}. Reply in one short sentence and include the marker.`,
});
const repoACritic = liveCall({
  cwd: repoA,
  alias: "critic",
  mode: "new",
  label: "repo-a critic new",
  prompt: `Repository/thread matrix proof. Repo: repo-a. Alias: critic. Marker: ${markerACritic}. Reply in one short sentence and include the marker.`,
});
const repoBMain = liveCall({
  cwd: repoB,
  alias: "main",
  mode: "new",
  label: "repo-b main new",
  prompt: `Repository/thread matrix proof. Repo: repo-b. Alias: main. Marker: ${markerBMain}. Reply in one short sentence and include the marker.`,
});

assert.equal(repoAMainContinue.conversationId, repoAMainNew.conversationId);
assert.notEqual(repoACritic.conversationId, repoAMainNew.conversationId);
assert.notEqual(repoBMain.conversationId, repoAMainNew.conversationId);
assert.equal(repoAMainNew.projectId, repoAInit.project.projectId);
assert.equal(repoAMainContinue.projectId, repoAInit.project.projectId);
assert.equal(repoACritic.projectId, repoAInit.project.projectId);
assert.equal(repoBMain.projectId, repoBInit.project.projectId);

const worktreeShow = runJson(["rooms", "show", "--alias=main"], { cwd: repoAWorktree });
assert.equal(worktreeShow.ok, true);
assert.equal(worktreeShow.result.found, true);
assert.equal(conversationId(worktreeShow.result.room.activeConversationUrl), repoAMainNew.conversationId);

const repoAMainHistory = exportHistory({
  cwd: repoA,
  alias: "main",
  marker: markerAMainTwo,
  notMarkers: [markerACritic, markerBMain],
  min: 4,
  label: "repo-a main",
});
assert.equal(repoAMainHistory.conversationId, repoAMainNew.conversationId);

const worktreeMainHistory = exportHistory({
  cwd: repoAWorktree,
  alias: "main",
  marker: markerAMainOne,
  notMarkers: [markerACritic, markerBMain],
  min: 4,
  label: "repo-a worktree main",
});
assert.equal(worktreeMainHistory.conversationId, repoAMainNew.conversationId);

const repoACriticHistory = exportHistory({
  cwd: repoA,
  alias: "critic",
  marker: markerACritic,
  notMarkers: [markerAMainOne, markerAMainTwo, markerBMain],
  min: 2,
  label: "repo-a critic",
});
assert.equal(repoACriticHistory.conversationId, repoACritic.conversationId);

const repoBMainHistory = exportHistory({
  cwd: repoB,
  alias: "main",
  marker: markerBMain,
  notMarkers: [markerAMainOne, markerAMainTwo, markerACritic],
  min: 2,
  label: "repo-b main",
});
assert.equal(repoBMainHistory.conversationId, repoBMain.conversationId);

const calls = [repoAMainNew, repoAMainContinue, repoACritic, repoBMain];
const threadEchoPath = writeThreadEcho(calls);
const summary = {
  ok: true,
  tested: "live-repo-thread-matrix",
  proofRoot,
  repos: {
    repoA: {
      path: repoA,
      projectId: repoAInit.project.projectId,
      sessionsPath: repoAInit.sessions.path,
    },
    repoAWorktree: {
      path: repoAWorktree,
      projectId: worktreeInit.project.projectId,
      sessionsPath: worktreeInit.sessions.path,
      sharedWithRepoA: worktreeInit.project.projectId === repoAInit.project.projectId,
    },
    repoB: {
      path: repoB,
      projectId: repoBInit.project.projectId,
      sessionsPath: repoBInit.sessions.path,
    },
  },
  calls: calls.map((call) => ({
    label: call.label,
    alias: call.alias,
    receipt: call.receiptPath,
    transcript: call.transcriptPath,
    assistant: call.assistantPath,
    conversationUrl: call.conversationUrl,
    conversationId: call.conversationId,
    projectId: call.projectId,
    assistantSha256: call.assistantSha256,
  })),
  assertions: {
    repoAWorktreeSharesProject: true,
    repoBSeparateProject: true,
    repoAMainContinueStayedOnSameConversation: true,
    repoACriticDifferentConversation: true,
    repoBMainDifferentConversation: true,
    historiesReadBack: true,
    historiesMarkerIsolated: true,
  },
  histories: [
    repoAMainHistory,
    worktreeMainHistory,
    repoACriticHistory,
    repoBMainHistory,
  ],
  threadEchoPath,
};
const summaryPath = resolve(proofRoot, "summary.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify({
  ok: true,
  tested: summary.tested,
  proofRoot,
  summaryPath,
  threadEchoPath,
  repos: summary.repos,
  calls: summary.calls,
  histories: summary.histories.map((history) => ({
    label: history.label,
    alias: history.alias,
    artifact: history.artifact,
    markdown: history.markdown,
    conversationId: history.conversationId,
    messageCount: history.messageCount,
    roleCounts: history.roleCounts,
    historyCompleteness: history.historyCompleteness,
  })),
}, null, 2));
