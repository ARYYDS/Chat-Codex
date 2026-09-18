import { existsSync, readFileSync } from "node:fs";
import {
  aliasChatGptSession,
  bindChatGptRoomRegistryOnly,
  conversationIdFromUrl,
  newChatGptSession,
  rebindChatGptSessionAlias,
  resolveVerifiedRoomTarget,
} from "../src/chatgpt-sessions.mjs";
import { withChatGptOperation } from "../src/chatgpt-operation.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_TARGET_URL, runId as makeRunId } from "../src/runtime-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function readRegistry(project) {
  if (!existsSync(project.canonicalSessionRegistryPath)) {
    return {
      schemaVersion: 2,
      projectId: project.projectId,
      rooms: {},
      freshThreads: [],
    };
  }
  return JSON.parse(readFileSync(project.canonicalSessionRegistryPath, "utf8"));
}

const command = process.argv[2] || "list";
const alias = arg("alias") || arg("name") || process.env.CHATGPT_SESSION || "";
const conversationUrl = arg("conversation-url") || arg("url") || "";
const targetUrl = arg("target-url") || process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);

function requireAlias(commandName) {
  if (alias) return;
  const error = new Error(`rooms ${commandName} requires --alias=<name>.`);
  error.errorCode = "session.alias_required";
  throw error;
}

try {
  const project = ensureProjectState();
  const registry = readRegistry(project);
  let result;

  if (command === "project") {
    result = project;
  } else if (command === "list") {
    result = {
      project,
      registryPath: project.canonicalSessionRegistryPath,
      rooms: Object.values(registry.rooms || {}).sort((a, b) => a.alias.localeCompare(b.alias)),
      freshThreads: registry.freshThreads || [],
      registryOnly: true,
    };
  } else if (command === "show") {
    if (!alias) {
      const error = new Error("rooms show requires --alias=<name>.");
      error.errorCode = "session.alias_required";
      throw error;
    }
    result = {
      project,
      registryPath: project.canonicalSessionRegistryPath,
      alias,
      room: registry.rooms?.[alias] || null,
      found: Boolean(registry.rooms?.[alias]),
      registryOnly: true,
    };
  } else if (command === "new") {
    requireAlias(command);
    const operationResult = await withChatGptOperation({
      name: "rooms.new",
      runId: `${makeRunId()}-rooms-new-${alias}`,
      project,
      alias,
      requiresBrowser: true,
      lockTimeoutMs,
      noWait: flag("no-wait"),
      staleLockTtlMs,
    }, async () => {
      const target = await newChatGptSession(port, { name: alias, url: targetUrl, bind: true });
      return {
        alias,
        target,
        room: readRegistry(project).rooms?.[alias] || null,
        targetCommitted: Boolean(conversationIdFromUrl(target.url)),
        note: conversationIdFromUrl(target.url)
          ? "new room bound to a committed ChatGPT conversation URL"
          : "new room is bound to an uncommitted ChatGPT target; the first call will update the final conversation URL after send",
      };
    });
    result = {
      ...operationResult.value,
      operation: operationResult.operation,
      locks: operationResult.locks,
      liveBrowser: true,
    };
  } else if (command === "rebind") {
    requireAlias(command);
    if (!conversationUrl) {
      const error = new Error("rooms rebind requires --conversation-url=https://chatgpt.com/c/...");
      error.errorCode = "room.conversation_url_required";
      throw error;
    }
    if (flag("registry-only")) {
      result = {
        alias,
        room: bindChatGptRoomRegistryOnly({
          name: alias,
          conversationUrl,
          openedReason: "explicit rooms rebind --registry-only",
        }),
        registryOnly: true,
        liveVerified: false,
      };
    } else {
      const operationResult = await withChatGptOperation({
        name: "rooms.rebind",
        runId: `${makeRunId()}-rooms-rebind-${alias}`,
        project,
        alias,
        requiresBrowser: true,
        lockTimeoutMs,
        noWait: flag("no-wait"),
        staleLockTtlMs,
      }, async () => {
        const room = await rebindChatGptSessionAlias(port, {
          name: alias,
          conversationUrl,
        });
        const verified = await resolveVerifiedRoomTarget(port, alias, { conversationUrl });
        return {
          alias,
          room,
          target: verified.target,
          roomTarget: verified.roomTarget,
        };
      });
      result = {
        ...operationResult.value,
        operation: operationResult.operation,
        locks: operationResult.locks,
        liveBrowser: true,
      };
    }
  } else if (command === "repair") {
    requireAlias(command);
    const operationResult = await withChatGptOperation({
      name: "rooms.repair",
      runId: `${makeRunId()}-rooms-repair-${alias}`,
      project,
      alias,
      requiresBrowser: true,
      lockTimeoutMs,
      noWait: flag("no-wait"),
      staleLockTtlMs,
    }, async () => {
      const verified = await resolveVerifiedRoomTarget(port, alias);
      if (!verified.target) {
        const error = new Error(`Room "${alias}" could not be resolved to a ChatGPT target.`);
        error.errorCode = "session.not_found";
        throw error;
      }
      const room = await aliasChatGptSession(port, {
        name: alias,
        targetId: verified.target.id,
        openedReason: "room target repair",
        archivePrevious: false,
        roomTargetVerification: "verified_live",
        lastTargetRepair: {
          checkedAt: verified.roomTarget?.checkedAt || new Date().toISOString(),
          resolution: verified.roomTarget?.resolution || null,
          repaired: verified.roomTarget?.repaired === true,
          repairReason: verified.roomTarget?.repairReason || null,
          targetId: verified.target.id,
          targetUrl: verified.target.url,
        },
      });
      return {
        alias,
        room,
        target: verified.target,
        roomTarget: verified.roomTarget,
      };
    });
    result = {
      ...operationResult.value,
      operation: operationResult.operation,
      locks: operationResult.locks,
      liveBrowser: true,
    };
  } else {
    const error = new Error(`Unknown rooms command: ${command}. Supported commands: project, list, show, new, rebind, repair.`);
    error.errorCode = "rooms.command_unsupported";
    throw error;
  }

  console.log(JSON.stringify({ ok: true, command, result }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    command,
    errorCode: error?.errorCode || "rooms.failed",
    ...(error?.details ? { details: error.details } : {}),
    error: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
