import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { repoRoot } from "./runtime-config.mjs";

const DEFAULT_LOCK_TIMEOUT_MS = 600_000;
const DEFAULT_STALE_LOCK_TTL_MS = 900_000;
const HEARTBEAT_INTERVAL_MS = 2_000;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function chatGptProHome() {
  return resolve(process.env.CHATGPT_PRO_HOME || join(homedir(), ".chatgpt-pro-codex"));
}

export function browserProfileLockPaths(root = chatGptProHome()) {
  const lockDir = resolve(root, "locks", "browser-profile.lock");
  return {
    root,
    lockDir,
    ownerPath: resolve(lockDir, "owner.json"),
    heartbeatPath: resolve(lockDir, "heartbeat.json"),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
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

export function readBrowserProfileLockStatus({
  root = chatGptProHome(),
  staleLockTtlMs = DEFAULT_STALE_LOCK_TTL_MS,
} = {}) {
  const paths = browserProfileLockPaths(root);
  if (!existsSync(paths.lockDir)) {
    return {
      scope: "browser-profile",
      path: paths.lockDir,
      busy: false,
      owner: null,
      heartbeat: null,
      ownerAlive: null,
      stale: false,
      ageMs: null,
    };
  }

  const owner = readJson(paths.ownerPath);
  const heartbeat = readJson(paths.heartbeatPath);
  const lastHeartbeatMs = heartbeat?.lastHeartbeatAt ? Date.parse(heartbeat.lastHeartbeatAt) : NaN;
  const ageMs = Number.isFinite(lastHeartbeatMs) ? Date.now() - lastHeartbeatMs : null;
  const ownerAlive = pidAlive(owner?.pid);
  return {
    scope: "browser-profile",
    path: paths.lockDir,
    busy: true,
    owner,
    heartbeat,
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

function createOwner({ runId, alias, project }) {
  return {
    runId,
    pid: process.pid,
    ppid: process.ppid,
    hostname: hostname(),
    cwd: process.cwd(),
    repoRoot: project?.repoRoot || repoRoot,
    projectId: project?.projectId || null,
    alias: alias || null,
    startedAt: nowIso(),
  };
}

function publicLockStatus(status, extra = {}) {
  return {
    scope: "browser-profile",
    path: status.path,
    busy: status.busy,
    owner: status.owner || null,
    ownerAlive: status.ownerAlive,
    stale: status.stale,
    ageMs: status.ageMs,
    ...extra,
  };
}

export async function acquireBrowserProfileLock({
  runId,
  alias = "",
  project = null,
  root = chatGptProHome(),
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  noWait = false,
  staleLockTtlMs = DEFAULT_STALE_LOCK_TTL_MS,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
} = {}) {
  if (!runId) throw new Error("runId is required to acquire the browser profile lock.");

  const paths = browserProfileLockPaths(root);
  const startedAtMs = Date.now();
  const owner = createOwner({ runId, alias, project });
  let staleLockReclaimed = false;
  let staleLockDetected = false;

  mkdirSync(dirname(paths.lockDir), { recursive: true });

  while (true) {
    try {
      mkdirSync(paths.lockDir);
      writeJson(paths.ownerPath, owner);
      writeJson(paths.heartbeatPath, { runId, lastHeartbeatAt: nowIso() });
      const acquiredAtMs = Date.now();
      const interval = setInterval(() => {
        try {
          const currentOwner = readJson(paths.ownerPath);
          if (currentOwner?.runId === runId) {
            writeJson(paths.heartbeatPath, { runId, lastHeartbeatAt: nowIso() });
          }
        } catch {
          // Best-effort heartbeat; acquire/release paths report authoritative errors.
        }
      }, heartbeatIntervalMs);
      interval.unref?.();

      let released = false;
      const baseReceipt = {
        scope: "browser-profile",
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
        async release() {
          clearInterval(interval);
          const currentOwner = readJson(paths.ownerPath);
          if (currentOwner?.runId !== runId) {
            const error = lockError(
              "lock.release_failed",
              "Browser profile lock owner changed before release.",
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
            throw error;
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

      const status = readBrowserProfileLockStatus({ root, staleLockTtlMs });
      if (status.stale) {
        staleLockDetected = true;
        if (status.ownerAlive === false || status.ownerAlive === null) {
          rmSync(paths.lockDir, { recursive: true, force: true });
          staleLockReclaimed = true;
          continue;
        }
      }

      const waitedMs = Date.now() - startedAtMs;
      const lock = publicLockStatus(status, {
        waitMs: waitedMs,
        staleLockDetected,
        staleLockReclaimed,
      });

      if (noWait) {
        throw lockError("lock.busy", "Browser profile lock is already held.", { lock, owner: status.owner || null });
      }
      if (waitedMs >= timeoutMs) {
        throw lockError("lock.timeout", "Timed out waiting for the browser profile lock.", { lock, owner: status.owner || null });
      }

      await sleep(250);
    }
  }
}
