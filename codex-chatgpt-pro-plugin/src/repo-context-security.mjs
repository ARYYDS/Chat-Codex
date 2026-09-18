import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";

const SECRET_PATH_RULES = [
  ["env_file", /(^|\/)\.env(\..*)?$/i],
  ["npmrc", /(^|\/)\.npmrc$/i],
  ["pypirc", /(^|\/)\.pypirc$/i],
  ["netrc", /(^|\/)\.netrc$/i],
  ["private_key", /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i],
  ["ssh_config", /(^|\/)\.ssh\//i],
  ["gnupg", /(^|\/)\.gnupg\//i],
  ["aws_config", /(^|\/)\.aws\//i],
  ["kube_config", /(^|\/)(\.kube\/config|kubeconfig)$/i],
  ["credential_file", /(^|\/)(credentials?|secrets?|service-account|google-credentials)(\.[^/]*)?$/i],
  ["key_material", /\.(pem|key|p12|pfx)$/i],
];

const CONTENT_RULES = [
  ["private_key_block", /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/],
  ["openai_key", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{24,}\b/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["npm_token", /\/\/[^:\s]+\/?:_authToken\s*=\s*[A-Za-z0-9_\-.]{20,}/],
];

const SECRETISH_ASSIGNMENT =
  /\b([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|pwd|private[_-]?key|access[_-]?key|client[_-]?secret|authorization|credential)[A-Za-z0-9_-]*)\b\s*[:=]\s*["']?([A-Za-z0-9_+./=-]{20,})/gi;

function normalizedPath(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isInside(rootRealpath, targetRealpath) {
  return targetRealpath === rootRealpath || targetRealpath.startsWith(`${rootRealpath}${sep}`);
}

function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    result -= p * Math.log2(p);
  }
  return result;
}

function looksLikePlaceholder(value) {
  return /^(x+|0+|1+|a+|example|placeholder|changeme|replace[_-]?me|your[_-]?)/i.test(value)
    || /example|placeholder|changeme|replace[_-]?me|your[_-]?/i.test(value);
}

export function secretPathFinding(file) {
  const normalized = normalizedPath(file);
  const match = SECRET_PATH_RULES.find(([, pattern]) => pattern.test(normalized));
  if (!match) return null;
  return {
    type: "secret_path",
    rule: match[0],
    file: normalized,
  };
}

export function scanSecretContent(text, file = "") {
  const findings = [];
  for (const [rule, pattern] of CONTENT_RULES) {
    if (pattern.test(text)) {
      findings.push({
        type: "secret_content",
        rule,
        file: normalizedPath(file),
      });
    }
  }

  SECRETISH_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(SECRETISH_ASSIGNMENT)) {
    const value = match[2] || "";
    if (value.length < 20 || looksLikePlaceholder(value)) continue;
    const score = entropy(value);
    if (score < 3.5) continue;
    findings.push({
      type: "secret_entropy",
      rule: "secretish_assignment_high_entropy",
      file: normalizedPath(file),
      key: match[1],
      entropy: Number(score.toFixed(2)),
    });
  }

  return findings;
}

export function repoContextSecurityError(findings, summary = {}) {
  const error = new Error([
    "Repo context bundle blocked: potential secrets or unsafe file paths were detected.",
    "Use --no-repo-context, remove the secret files, or pass explicit scrubbed context files.",
  ].join(" "));
  error.errorCode = "repo_context.secret_scan_blocked";
  error.details = {
    ...summary,
    findings,
  };
  return error;
}

export function scanRepoContextFiles(files, {
  root,
  maxFileBytes = 120_000,
} = {}) {
  const repoRoot = resolve(root || ".");
  const rootRealpath = realpathSync(repoRoot);
  const findings = [];
  const skipped = [];
  let contentScanned = 0;

  for (const file of files) {
    const normalized = normalizedPath(file);
    const absolutePath = resolve(repoRoot, normalized);
    if (!absolutePath.startsWith(repoRoot + sep) && absolutePath !== repoRoot) {
      findings.push({ type: "path_escape", rule: "lexical_root_escape", file: normalized });
      continue;
    }
    if (!existsSync(absolutePath)) {
      skipped.push({ file: normalized, reason: "missing" });
      continue;
    }

    const lstat = lstatSync(absolutePath);
    const realpath = realpathSync(absolutePath);
    if (!isInside(rootRealpath, realpath)) {
      findings.push({
        type: "path_escape",
        rule: "realpath_root_escape",
        file: normalized,
      });
      continue;
    }
    if (lstat.isSymbolicLink()) {
      findings.push({
        type: "symlink",
        rule: "repo_context_symlink",
        file: normalized,
      });
      continue;
    }
    if (!lstat.isFile()) {
      skipped.push({ file: normalized, reason: "not_regular_file" });
      continue;
    }

    const pathFinding = secretPathFinding(normalized);
    if (pathFinding) {
      findings.push(pathFinding);
      continue;
    }

    const stats = statSync(absolutePath);
    if (stats.size > maxFileBytes) {
      skipped.push({ file: normalized, reason: "above_max_file_bytes", bytes: stats.size });
      continue;
    }

    const text = readFileSync(absolutePath, "utf8");
    const contentFindings = scanSecretContent(text, normalized);
    if (contentFindings.length) findings.push(...contentFindings);
    contentScanned += 1;
  }

  return {
    ok: findings.length === 0,
    filesChecked: files.length,
    contentScanned,
    skipped,
    findings,
  };
}
