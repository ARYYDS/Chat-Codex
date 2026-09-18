import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chatGptProHome } from "./browser-lock.mjs";
import { writeJsonAtomic } from "./atomic-json.mjs";

export const DEFAULT_MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

export function modelStateCachePath(root = chatGptProHome()) {
  return resolve(root, "state", "model-state.json");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function cacheStatus(cache, nowMs = Date.now()) {
  if (!cache) return "missing";
  if (!cache.observedAt || !cache.expiresAt || !Number(cache.ttlMs)) return "invalid";
  const expiresAtMs = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return "invalid";
  return nowMs > expiresAtMs ? "stale" : "fresh";
}

function compactOptions(options = []) {
  return options.map(({ label, text, detail, current, disabled }) => ({
    label,
    ...(text && text !== label ? { text } : {}),
    ...(detail ? { detail } : {}),
    current: Boolean(current),
    disabled: Boolean(disabled),
  }));
}

export function buildModelStateCache({
  choices,
  source = "doctor.live",
  cdpEndpoint,
  profilePath,
  targetUrl,
  observedAt = new Date(),
  ttlMs = Number(process.env.CHATGPT_MODEL_CACHE_TTL_MS || DEFAULT_MODEL_CACHE_TTL_MS),
} = {}) {
  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const expires = new Date(observed.getTime() + ttlMs);
  return {
    schemaVersion: 1,
    observedAt: observed.toISOString(),
    expiresAt: expires.toISOString(),
    ttlMs,
    source,
    cdpEndpoint,
    profilePath,
    targetUrl,
    account: choices?.account || null,
    intelligence: {
      selected: choices?.intelligence?.current || null,
      buttonLabel: choices?.intelligence?.buttonLabel || null,
      options: compactOptions(choices?.intelligence?.options),
    },
    model: {
      rootLabel: choices?.model?.rootLabel || null,
      selected: choices?.model?.current || null,
      options: compactOptions(choices?.model?.options),
    },
  };
}

export function writeModelStateCache(cache, { root = chatGptProHome() } = {}) {
  const path = modelStateCachePath(root);
  writeJsonAtomic(path, cache);
  return { path, cache };
}

export function readModelStateCache({ root = chatGptProHome(), nowMs = Date.now() } = {}) {
  const path = modelStateCachePath(root);
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      status: "missing",
      cache: null,
      ageMs: null,
      stale: true,
    };
  }
  const cache = readJson(path);
  if (!cache) {
    return {
      path,
      exists: true,
      status: "invalid",
      cache: null,
      ageMs: null,
      stale: true,
    };
  }
  const status = cacheStatus(cache, nowMs);
  const observedAtMs = cache?.observedAt ? Date.parse(cache.observedAt) : NaN;
  const ageMs = Number.isFinite(observedAtMs) ? nowMs - observedAtMs : null;
  return {
    path,
    exists: true,
    status,
    cache,
    ageMs,
    stale: status !== "fresh",
  };
}
