import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { acquireBrowserProfileLock } from "./browser-lock.mjs";
import { acquireProjectStateLockSync } from "./project-state-lock.mjs";
import { ensureProjectState } from "./project-state.mjs";

function nowIso() {
  return new Date().toISOString();
}

export function createOperationMetadata({
  name,
  runId,
  project,
  alias = "",
  requiresBrowser = false,
  kind = requiresBrowser ? "live-browser" : "deterministic-local",
} = {}) {
  if (!name) throw new Error("ChatGPT operation name is required.");
  return {
    name,
    kind,
    runId: runId || `${name}-${randomUUID()}`,
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    cwd: process.cwd(),
    projectId: project?.projectId || null,
    repoRoot: project?.repoRoot || null,
    alias: alias || null,
    requiresBrowser: Boolean(requiresBrowser),
    startedAt: nowIso(),
  };
}

export async function acquireChatGptOperation({
  name,
  runId,
  project = ensureProjectState(),
  alias = "",
  requiresBrowser = false,
  kind = requiresBrowser ? "live-browser" : "deterministic-local",
  lockTimeoutMs = 600_000,
  staleLockTtlMs = 900_000,
  noWait = false,
  browserLockRoot,
  stateLockTimeoutMs = 30_000,
  stateStaleLockTtlMs = 60_000,
} = {}) {
  const operation = createOperationMetadata({ name, runId, project, alias, requiresBrowser, kind });
  const locks = {
    browser: {
      required: Boolean(requiresBrowser),
      acquired: false,
      receipt: null,
      releaseError: null,
    },
    projectState: [],
  };
  let browserLock = null;
  let released = false;

  if (requiresBrowser) {
    try {
      browserLock = await acquireBrowserProfileLock({
        runId: operation.runId,
        alias,
        project,
        root: browserLockRoot,
        timeoutMs: lockTimeoutMs,
        noWait,
        staleLockTtlMs,
      });
    } catch (error) {
      error.details = error.details || {};
      error.details.operation = error.details.operation || operation;
      throw error;
    }
    locks.browser.acquired = true;
    locks.browser.owner = browserLock.owner;
    locks.browser.receipt = browserLock.receipt();
  }

  function receipt() {
    return {
      operation,
      locks: {
        browser: browserLock ? {
          ...locks.browser,
          receipt: browserLock.receipt(),
        } : locks.browser,
        projectState: locks.projectState,
      },
    };
  }

  return {
    operation,
    locks,
    project,
    alias,
    receipt,
    withProjectStateWrite(reason, writeFn) {
      const lock = acquireProjectStateLockSync({
        project,
        reason,
        runId: `${operation.runId}:${reason || "project-state"}`,
        timeoutMs: stateLockTimeoutMs,
        noWait,
        staleLockTtlMs: stateStaleLockTtlMs,
      });
      try {
        return writeFn(lock);
      } finally {
        locks.projectState.push({
          reason: reason || null,
          required: true,
          acquired: true,
          receipt: lock.release(),
        });
      }
    },
    async release() {
      if (released) return receipt();
      if (browserLock) {
        try {
          locks.browser.receipt = await browserLock.release();
        } catch (error) {
          locks.browser.releaseError = {
            errorCode: error?.errorCode || "lock.release_failed",
            error: String(error?.message || error),
            ...(error?.details ? { details: error.details } : {}),
          };
          throw error;
        } finally {
          browserLock = null;
        }
      }
      released = true;
      operation.finishedAt = nowIso();
      return receipt();
    },
  };
}

export async function withChatGptOperation({
  name,
  runId,
  project = ensureProjectState(),
  alias = "",
  requiresBrowser = false,
  kind = requiresBrowser ? "live-browser" : "deterministic-local",
  lockTimeoutMs = 600_000,
  staleLockTtlMs = 900_000,
  noWait = false,
  browserLockRoot,
  stateLockTimeoutMs = 30_000,
  stateStaleLockTtlMs = 60_000,
} = {}, fn) {
  if (typeof fn !== "function") throw new Error("withChatGptOperation requires a callback.");

  const op = await acquireChatGptOperation({
    name,
    runId,
    project,
    alias,
    requiresBrowser,
    kind,
    lockTimeoutMs,
    staleLockTtlMs,
    noWait,
    browserLockRoot,
    stateLockTimeoutMs,
    stateStaleLockTtlMs,
  });
  let value;
  let callbackError = null;

  try {
    value = await fn(op);
  } catch (error) {
    if (!error.details) error.details = {};
    error.details.operation = error.details.operation || op.operation;
    error.details.locks = error.details.locks || op.receipt().locks;
    callbackError = error;
  } finally {
    try {
      await op.release();
    } catch (error) {
      if (!callbackError) callbackError = error;
    }
  }

  if (callbackError) {
    callbackError.details = callbackError.details || {};
    callbackError.details.operation = callbackError.details.operation || op.operation;
    callbackError.details.locks = op.receipt().locks;
    throw callbackError;
  }
  return {
    value,
    ...op.receipt(),
  };
}
