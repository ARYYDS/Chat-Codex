import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalProjectStateDir, ensureProjectState } from "./project-state.mjs";
import { repoRoot } from "./runtime-config.mjs";
import { writeJsonAtomic } from "./atomic-json.mjs";

const DEFAULT_STATE_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_STATE_STALE_LOCK_TTL_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function projectStateLockPaths(project = ensureProjectState()) {
  const projectDir = canonicalProjectStateDir(project.projectId);
  const lockDir = resolve(projectDir, "state.lock");
  return {
    projectDir,
    lockDir,
    ownerPath: resolve(lockDir, "owner.json"),
  };
}

export function readProjectStateLockStatus({
  project = ensureProjectState(),
  staleLockTtlMs = DEFAULT_STATE_STALE_LOCK_TTL_MS,
} = {}) {
  const paths = projectStateLockPaths(project);
  if (!existsSync(paths.lockDir)) {
    return {
      scope: "project-state",
      projectId: project.projectId,
      path: paths.lockDir,
      busy: false,
      owner: null,
      ownerAlive: null,
      stale: false,
      ageMs: null,
    };
  }

  const owner = readJson(paths.ownerPath);
  let startedMs;
  try {
    startedMs = owner?.startedAt ? Date.parse(owner.startedAt) : statSync(paths.lockDir).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        scope: "project-state",
        projectId: project.projectId,
        path: paths.lockDir,
        busy: false,
        owner: null,
        ownerAlive: null,
        stale: false,
        ageMs: null,
      };
    }
    throw error;
  }
  const ageMs = Number.isFinite(startedMs) ? Date.now() - startedMs : null;
  const ownerAlive = pidAlive(owner?.pid);
  return {
    scope: "project-state",
    projectId: project.projectId,
    path: paths.lockDir,
    busy: true,
    owner,
    ownerAlive,
    stale: ageMs == null || ageMs > staleLockTtlMs,
    ageMs,
  };
}

function lockError(errorCode, message, details) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function createOwner({ project, runId, reason }) {
  return {
    runId,
    reason: reason || null,
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    cwd: process.cwd(),
    repoRoot: project?.repoRoot || repoRoot,
    projectId: project?.projectId || null,
    startedAt: nowIso(),
  };
}

export function acquireProjectStateLockSync({
  project = ensureProjectState(),
  reason = "",
  runId = `state-${randomUUID()}`,
  timeoutMs = DEFAULT_STATE_LOCK_TIMEOUT_MS,
  noWait = false,
  staleLockTtlMs = DEFAULT_STATE_STALE_LOCK_TTL_MS,
} = {}) {
  const paths = projectStateLockPaths(project);
  const startedAtMs = Date.now();
  const owner = createOwner({ project, runId, reason });
  let staleLockDetected = false;
  let staleLockReclaimed = false;

  mkdirSync(paths.projectDir, { recursive: true });

  while (true) {
    try {
      mkdirSync(paths.lockDir);
      writeJsonAtomic(paths.ownerPath, owner);
      const acquiredAtMs = Date.now();
      let released = false;
      const baseReceipt = {
        scope: "project-state",
        projectId: project.projectId,
        path: paths.lockDir,
        waitMs: acquiredAtMs - startedAtMs,
        acquiredAt: new Date(acquiredAtMs).toISOString(),
        staleLockDetected,
        staleLockReclaimed,
      };

      return {
        owner,
        receipt() {
          return {
            ...baseReceipt,
            heldMs: Date.now() - acquiredAtMs,
            released,
          };
        },
        release() {
          const currentOwner = readJson(paths.ownerPath);
          if (currentOwner?.runId !== runId) {
            throw lockError(
              "state_lock.release_failed",
              "Project state lock owner changed before release.",
              {
                lock: {
                  ...baseReceipt,
                  heldMs: Date.now() - acquiredAtMs,
                  released: false,
                  currentOwner,
                },
                owner,
              },
            );
          }
          rmSync(paths.lockDir, { recursive: true, force: true });
          released = true;
          return {
            ...baseReceipt,
            heldMs: Date.now() - acquiredAtMs,
            released: true,
            releasedAt: nowIso(),
          };
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const status = readProjectStateLockStatus({ project, staleLockTtlMs });
      if (!status.busy) continue;
      if (status.stale) {
        staleLockDetected = true;
        if (status.ownerAlive === false || status.ownerAlive === null) {
          rmSync(paths.lockDir, { recursive: true, force: true });
          staleLockReclaimed = true;
          continue;
        }
      }

      const waitedMs = Date.now() - startedAtMs;
      const lock = {
        scope: "project-state",
        projectId: project.projectId,
        path: paths.lockDir,
        busy: status.busy,
        owner: status.owner || null,
        ownerAlive: status.ownerAlive,
        stale: status.stale,
        ageMs: status.ageMs,
        waitMs: waitedMs,
        staleLockDetected,
        staleLockReclaimed,
      };

      if (noWait) {
        throw lockError("state_lock.busy", "Project state lock is already held.", { lock, owner: status.owner || null });
      }
      if (waitedMs >= timeoutMs) {
        throw lockError("state_lock.timeout", "Timed out waiting for the project state lock.", { lock, owner: status.owner || null });
      }

      sleepSync(50);
    }
  }
}

export function withProjectStateLockSync(options, fn) {
  const lock = acquireProjectStateLockSync(options);
  try {
    return fn(lock);
  } finally {
    lock.release();
  }
}
