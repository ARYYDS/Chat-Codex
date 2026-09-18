import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireBrowserProfileLock } from "../src/browser-lock.mjs";
import { compileHistoryArtifact, readHistoryArtifact } from "../src/chatgpt-history-artifact.mjs";
import { shapeConversationMessages } from "../src/chatgpt-messages.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const root = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-room-fixtures-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-room-home-"));
const projectStateUrl = pathToFileURL(resolve(packageRoot, "src", "project-state.mjs")).href;

function run(command, args, { cwd, env = {}, input = "" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_PRO_HOME: home,
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
  return JSON.parse(run(process.execPath, [bin, "init"], { cwd }).stdout);
}

function chatgptRooms(cwd, args) {
  return JSON.parse(run(process.execPath, [bin, "rooms", ...args], { cwd }).stdout);
}

function chatgptHistoryRead(cwd, path) {
  return JSON.parse(run(process.execPath, [bin, "history", "read", `--path=${path}`], { cwd }).stdout);
}

function registryFor(cwd) {
  const code = `
    import { readFileSync } from "node:fs";
    const { ensureProjectState } = await import(${JSON.stringify(projectStateUrl + `?registry=${Date.now()}-${Math.random()}`)});
    const project = ensureProjectState();
    const registry = JSON.parse(readFileSync(project.canonicalSessionRegistryPath, "utf8"));
    console.log(JSON.stringify({ project, registry }, null, 2));
  `;
  return JSON.parse(run(process.execPath, ["--input-type=module", "-"], { cwd, input: code }).stdout);
}

function writeRoom(cwd, { alias, url, targetId }) {
  const code = `
    import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    const { ensureProjectState } = await import(${JSON.stringify(projectStateUrl + `?write=${Date.now()}-${Math.random()}`)});
    const project = ensureProjectState();
    const path = project.canonicalSessionRegistryPath;
    mkdirSync(dirname(path), { recursive: true });
    let registry = { schemaVersion: 2, projectId: project.projectId, rooms: {}, freshThreads: [] };
    try { registry = JSON.parse(readFileSync(path, "utf8")); } catch {}
    const now = new Date().toISOString();
    const id = new URL(${JSON.stringify(url)}).pathname.split("/c/")[1];
    const activeThreadId = "chatgpt:" + id;
    const previous = registry.rooms[${JSON.stringify(alias)}] || null;
    const changedThread = previous?.activeThreadId && previous.activeThreadId !== activeThreadId;
    const archivedLineage = (Array.isArray(previous?.lineage) ? previous.lineage : []).map((entry) =>
      changedThread && entry.status === "active"
        ? {
            ...entry,
            status: "archived",
            closedAt: now,
            closedByRunId: "fixture",
            closedReason: "fixture moved alias to another thread"
          }
        : entry
    );
    const activeEntry = {
      threadId: activeThreadId,
      conversationUrl: ${JSON.stringify(url)},
      status: "active",
      openedAt: now,
      openedByRunId: "fixture",
      openedReason: "fixture room write",
      closedAt: null,
      closedByRunId: null,
      closedReason: null,
      firstRunId: null,
      lastRunId: null,
      lastReceiptPath: null
    };
    const activeIndex = archivedLineage.findIndex((entry) => entry.threadId === activeEntry.threadId);
    const lineage = [...archivedLineage];
    if (activeIndex >= 0) lineage[activeIndex] = activeEntry;
    else lineage.push(activeEntry);
    registry.rooms[${JSON.stringify(alias)}] = {
      alias: ${JSON.stringify(alias)},
      projectId: project.projectId,
      repoRoot: project.repoRoot,
      projectDisplayName: project.displayName,
      purpose: "fixture room",
      lifecycle: "fixture",
      activeThreadId,
      activeConversationUrl: ${JSON.stringify(url)},
      conversationUrl: ${JSON.stringify(url)},
      url: ${JSON.stringify(url)},
      targetId: ${JSON.stringify(targetId)},
      title: ${JSON.stringify(alias)} + " fixture",
      responseMode: "blocking",
      createdAt: previous?.createdAt || now,
      lastUsedAt: now,
      updatedAt: now,
      callCount: Number(previous?.callCount || 0),
      recentRuns: [],
      lineage
    };
    writeFileSync(path, JSON.stringify(registry, null, 2) + "\\n");
    console.log(JSON.stringify({ project, path, room: registry.rooms[${JSON.stringify(alias)}] }, null, 2));
  `;
  return JSON.parse(run(process.execPath, ["--input-type=module", "-"], { cwd, input: code }).stdout);
}

function writeHistory(cwd, { project, alias, room, messages, last = 0, name }) {
  const outDir = resolve(cwd, ".devspace", "chatgpt-history", alias, name);
  mkdirSync(outDir, { recursive: true });
  const exportedAt = "2026-06-17T09:00:00.000Z";
  const selectedMessages = last > 0 ? messages.slice(-last) : messages;
  const target = {
    id: room.targetId,
    title: room.title,
    url: room.activeConversationUrl,
  };
  const compiled = compileHistoryArtifact({
    project,
    alias,
    target,
    roomTarget: {
      targetBoundToRoom: true,
      expectedConversationUrl: room.activeConversationUrl,
      actualTargetUrl: room.activeConversationUrl,
    },
    messages: selectedMessages,
    exportedAt,
    last,
    outDir,
  });
  const jsonPath = resolve(outDir, "history.json");
  const markdownPath = resolve(outDir, "chatgpt-history.md");
  const json = {
    ...compiled.json,
    totalVisibleMessageCount: messages.length,
    artifacts: {
      markdown: markdownPath,
      json: jsonPath,
    },
  };
  writeFileSync(markdownPath, compiled.markdown);
  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  return {
    outDir,
    jsonPath,
    markdownPath,
    directRead: readHistoryArtifact(jsonPath),
    cliRead: chatgptHistoryRead(cwd, jsonPath),
    markdown: compiled.markdown,
  };
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

  writeRoom(repoA, {
    alias: "main",
    url: "https://chatgpt.com/c/repo-a-main-v1",
    targetId: "target-repo-a-main-v1",
  });
  writeRoom(repoA, {
    alias: "main",
    url: "https://chatgpt.com/c/repo-a-main-v2",
    targetId: "target-repo-a-main-v2",
  });
  writeRoom(worktreeA, {
    alias: "debug",
    url: "https://chatgpt.com/c/repo-a-debug-from-worktree",
    targetId: "target-repo-a-debug",
  });
  writeRoom(repoA, {
    alias: "critic",
    url: "https://chatgpt.com/c/repo-a-critic",
    targetId: "target-repo-a-critic",
  });
  writeRoom(repoB, {
    alias: "main",
    url: "https://chatgpt.com/c/repo-b-main",
    targetId: "target-repo-b-main",
  });

  const repoAState = registryFor(repoA);
  const worktreeState = registryFor(worktreeA);
  const repoBState = registryFor(repoB);
  const repoARooms = chatgptRooms(repoA, ["list"]);
  const worktreeRooms = chatgptRooms(worktreeA, ["list"]);
  const repoBRooms = chatgptRooms(repoB, ["list"]);
  const repoAMain = chatgptRooms(repoA, ["show", "--alias=main"]);
  const worktreeDebug = chatgptRooms(worktreeA, ["show", "--alias=debug"]);
  const repoBMain = chatgptRooms(repoB, ["show", "--alias=main"]);

  assert.equal(repoAInit.project.projectId, worktreeInit.project.projectId);
  assert.equal(repoAInit.sessions.path, worktreeInit.sessions.path);
  assert.equal(repoAState.project.projectId, worktreeState.project.projectId);
  assert.equal(repoAState.project.canonicalSessionRegistryPath, worktreeState.project.canonicalSessionRegistryPath);
  assert.deepEqual(Object.keys(repoAState.registry.rooms).sort(), ["critic", "debug", "main"]);
  assert.deepEqual(Object.keys(worktreeState.registry.rooms).sort(), ["critic", "debug", "main"]);
  assert.equal(worktreeState.registry.rooms.main.activeConversationUrl, "https://chatgpt.com/c/repo-a-main-v2");
  assert.equal(repoAState.registry.rooms.debug.activeConversationUrl, "https://chatgpt.com/c/repo-a-debug-from-worktree");
  assert.deepEqual(repoAState.registry.rooms.main.lineage.map((entry) => entry.status), ["archived", "active"]);
  assert.equal(repoAState.registry.rooms.main.lineage[0].conversationUrl, "https://chatgpt.com/c/repo-a-main-v1");
  assert.equal(repoAState.registry.rooms.main.lineage[1].conversationUrl, "https://chatgpt.com/c/repo-a-main-v2");

  assert.notEqual(repoBInit.project.projectId, repoAInit.project.projectId);
  assert.notEqual(repoBInit.sessions.path, repoAInit.sessions.path);
  assert.deepEqual(Object.keys(repoBState.registry.rooms).sort(), ["main"]);
  assert.equal(repoBState.registry.rooms.main.activeConversationUrl, "https://chatgpt.com/c/repo-b-main");
  assert.notEqual(repoBState.registry.rooms.main.activeConversationUrl, repoAState.registry.rooms.main.activeConversationUrl);
  assert.equal(repoAState.project.repoRoot, realpathSync(repoA));
  assert.equal(worktreeState.project.repoRoot, realpathSync(worktreeA));
  assert.equal(repoBState.project.repoRoot, realpathSync(repoB));
  assert.deepEqual(repoARooms.result.rooms.map((room) => room.alias), ["critic", "debug", "main"]);
  assert.deepEqual(worktreeRooms.result.rooms.map((room) => room.alias), ["critic", "debug", "main"]);
  assert.deepEqual(repoBRooms.result.rooms.map((room) => room.alias), ["main"]);
  assert.equal(repoAMain.result.room.activeConversationUrl, "https://chatgpt.com/c/repo-a-main-v2");
  assert.equal(worktreeDebug.result.room.activeConversationUrl, "https://chatgpt.com/c/repo-a-debug-from-worktree");
  assert.equal(repoBMain.result.room.activeConversationUrl, "https://chatgpt.com/c/repo-b-main");
  assert.equal(repoARooms.result.registryOnly, true);
  assert.equal(worktreeRooms.result.registryOnly, true);
  assert.equal(repoBRooms.result.registryOnly, true);

  const repoAMessages = shapeConversationMessages([
    { role: "user", text: "Human planning note: bind this repository to the main architecture thread." },
    { role: "assistant", text: "Use a repo-scoped main room and preserve lineage when rebinding." },
    { role: "user", text: "Codex asks for the highest-leverage next step across repos." },
    { role: "assistant", text: "Prove cross-repo isolation, linked-worktree sharing, and complete history readback together." },
    { role: "user", text: "Now include the full prior answer, not only the newest response." },
    { role: "assistant", text: "Compile the all-visible ChatGPT session into history.json and chatgpt-history.md with hashes." },
  ]);
  const repoADebugMessages = shapeConversationMessages([
    { role: "user", text: "Debug room: page crashed while reading documents." },
    { role: "assistant", text: "Detect long reading states and wait without treating them as failure." },
    { role: "user", text: "Debug room: uploaded duplicate filename." },
    { role: "assistant", text: "Stage uploads with UTC-stamped names and record original hashes." },
  ]);
  const repoBMessages = shapeConversationMessages([
    { role: "user", text: "Repo B should not inherit Repo A session history." },
    { role: "assistant", text: "Separate git repos get distinct project ids and distinct room registries." },
  ]);
  const repoAHistory = writeHistory(repoA, {
    project: repoAState.project,
    alias: "main",
    room: repoAState.registry.rooms.main,
    messages: repoAMessages,
    name: "all-visible",
  });
  const worktreeDebugHistory = writeHistory(worktreeA, {
    project: worktreeState.project,
    alias: "debug",
    room: worktreeState.registry.rooms.debug,
    messages: repoADebugMessages,
    last: 2,
    name: "last-2",
  });
  const repoBHistory = writeHistory(repoB, {
    project: repoBState.project,
    alias: "main",
    room: repoBState.registry.rooms.main,
    messages: repoBMessages,
    name: "all-visible",
  });

  assert.equal(repoAHistory.directRead.exportScope, "all_visible");
  assert.equal(repoAHistory.cliRead.exportScope, "all_visible");
  assert.equal(repoAHistory.cliRead.historyCompleteness.claim, "all_loaded_dom_messages");
  assert.equal(repoAHistory.cliRead.historyCompleteness.absoluteConversationComplete, false);
  assert.equal(repoAHistory.cliRead.messageCount, 6);
  assert.equal(repoAHistory.cliRead.roleCounts.user, 3);
  assert.equal(repoAHistory.cliRead.roleCounts.assistant, 3);
  assert.equal(repoAHistory.cliRead.messages[5].text, "Compile the all-visible ChatGPT session into history.json and chatgpt-history.md with hashes.");
  assert.equal(repoAHistory.markdown.includes("Export scope: all visible"), true);
  assert.equal(repoAHistory.markdown.includes("Room target bound: true"), true);

  assert.equal(worktreeDebugHistory.cliRead.projectId, repoAState.project.projectId);
  assert.equal(worktreeDebugHistory.cliRead.exportScope, "last_n_visible");
  assert.equal(worktreeDebugHistory.cliRead.historyCompleteness.claim, "last_n_loaded_dom_messages");
  assert.equal(worktreeDebugHistory.cliRead.messageCount, 2);
  assert.equal(worktreeDebugHistory.cliRead.firstOrdinal, 2);
  assert.equal(worktreeDebugHistory.cliRead.messages[0].text, "Debug room: uploaded duplicate filename.");

  assert.equal(repoBHistory.cliRead.projectId, repoBState.project.projectId);
  assert.notEqual(repoBHistory.cliRead.projectId, repoAHistory.cliRead.projectId);
  assert.equal(repoBHistory.cliRead.conversationUrl, "https://chatgpt.com/c/repo-b-main");
  assert.equal(repoBHistory.cliRead.messages[0].text, "Repo B should not inherit Repo A session history.");

  const heldBrowserLock = await acquireBrowserProfileLock({
    runId: "room-fixtures-browser-lock-held",
    alias: "fixture",
    project: repoAState.project,
    root: home,
    noWait: true,
  });
  try {
    const whileLocked = chatgptRooms(repoB, ["show", "--alias=main"]);
    assert.equal(whileLocked.ok, true);
    assert.equal(whileLocked.result.registryOnly, true);
    assert.equal(whileLocked.result.room.activeConversationUrl, "https://chatgpt.com/c/repo-b-main");
    const historyWhileLocked = chatgptHistoryRead(repoA, repoAHistory.jsonPath);
    assert.equal(historyWhileLocked.ok, true);
    assert.equal(historyWhileLocked.messageCount, 6);
  } finally {
    await heldBrowserLock.release();
  }

  console.log(JSON.stringify({
    ok: true,
    tested: "room-fixtures",
    cli: {
      command: "chatgpt-pro rooms list/show",
      registryOnlyWhileBrowserLocked: true,
    },
    repoA: {
      projectId: repoAState.project.projectId,
      registryPath: repoAState.project.canonicalSessionRegistryPath,
      rooms: Object.keys(repoAState.registry.rooms).sort(),
      mainLineage: repoAState.registry.rooms.main.lineage.map((entry) => ({
        status: entry.status,
        conversationUrl: entry.conversationUrl,
      })),
      history: {
        json: repoAHistory.jsonPath,
        messageCount: repoAHistory.cliRead.messageCount,
        exportScope: repoAHistory.cliRead.exportScope,
      },
    },
    repoAWorktree: {
      projectId: worktreeState.project.projectId,
      registryPath: worktreeState.project.canonicalSessionRegistryPath,
      rooms: Object.keys(worktreeState.registry.rooms).sort(),
      history: {
        json: worktreeDebugHistory.jsonPath,
        messageCount: worktreeDebugHistory.cliRead.messageCount,
        exportScope: worktreeDebugHistory.cliRead.exportScope,
      },
    },
    repoB: {
      projectId: repoBState.project.projectId,
      registryPath: repoBState.project.canonicalSessionRegistryPath,
      rooms: Object.keys(repoBState.registry.rooms).sort(),
      history: {
        json: repoBHistory.jsonPath,
        messageCount: repoBHistory.cliRead.messageCount,
        exportScope: repoBHistory.cliRead.exportScope,
      },
    },
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
