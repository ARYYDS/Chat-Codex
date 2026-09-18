import { existsSync, readFileSync } from "node:fs";
import { chatGptProHome, readBrowserProfileLockStatus } from "./browser-lock.mjs";
import { readProjectStateLockStatus } from "./project-state-lock.mjs";
import { ensureProjectState } from "./project-state.mjs";
import { readModelStateCache } from "./model-state-cache.mjs";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readRegistry(project) {
  const path = project.canonicalSessionRegistryPath;
  const registry = readJson(path) || {
    schemaVersion: 2,
    projectId: project.projectId,
    rooms: {},
    freshThreads: [],
  };
  return { path, registry };
}

function roomSummary(room) {
  return {
    alias: room.alias,
    activeConversationUrl: room.activeConversationUrl || room.conversationUrl || room.url || null,
    activeThreadId: room.activeThreadId || null,
    title: room.title || "",
    lifecycle: room.lifecycle || null,
    lastUsedAt: room.lastUsedAt || null,
    lastRunId: room.lastRunId || null,
    lastReceiptPath: room.lastReceiptPath || null,
    lastTranscriptPath: room.lastTranscriptPath || null,
    callCount: Number(room.callCount || 0),
  };
}

export function buildChatGptStatus({
  alias = "main",
  project = ensureProjectState(),
  chatGptHome = chatGptProHome(),
} = {}) {
  const { path: registryPath, registry } = readRegistry(project);
  const rooms = Object.values(registry.rooms || {})
    .map(roomSummary)
    .sort((a, b) => a.alias.localeCompare(b.alias));
  const selectedRoom = rooms.find((room) => room.alias === alias) || null;
  const browserLock = readBrowserProfileLockStatus({ root: chatGptHome });
  const projectStateLock = readProjectStateLockStatus({ project });
  const modelCache = readModelStateCache({ root: chatGptHome });

  return {
    ok: true,
    command: "status",
    operationKind: "registry-read",
    project,
    registry: {
      path: registryPath,
      exists: existsSync(registryPath),
      schemaVersion: registry.schemaVersion || null,
      roomCount: rooms.length,
    },
    alias,
    room: {
      found: Boolean(selectedRoom),
      selected: selectedRoom,
      rooms,
    },
    locks: {
      browser: browserLock,
      projectState: projectStateLock,
    },
    modelCache,
    nextAction: selectedRoom
      ? "call"
      : `Bind or create room alias "${alias}" before relying on conversation continuity.`,
  };
}
