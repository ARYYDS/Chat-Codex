export const REPO_CONTEXT_MODES = ["auto", "upload", "inline", "off"];

const AUTO_REPO_CONTEXT_PATTERNS = [
  ["whole_repo", /\b(whole[- ]repo|full[- ]repo|entire[- ]repo|whole[- ]codebase|full[- ]codebase|entire[- ]codebase)\b/i],
  ["repo_context", /\b(attach|upload|include|use|read)\s+(the\s+)?(repo|repository|codebase)\s+(context|files|source|monofile)\b/i],
  ["repo_architecture", /\b(repo|repository|codebase|project)\s+(architecture|design|structure|context|review|audit|plan)\b/i],
  ["architecture_of_repo", /\b(architecture|architectural|system design|design spec|implementation plan|feature design|migration plan|refactor plan)\b.{0,80}\b(repo|repository|codebase|project|system)\b/i],
  ["cross_file", /\b(cross[- ]file|multi[- ]file|multi[- ]agent|repo[- ]scoped|session history)\b/i],
  ["security_scan", /\b(security scan|security review|threat model|attack path|secret scan)\b/i],
];

export function decideRepoContextMode({
  requestedMode = "auto",
  prompt = "",
  contextDir = "",
  contextFile = "",
  uploadFileCount = 0,
} = {}) {
  if (!REPO_CONTEXT_MODES.includes(requestedMode)) {
    const error = new Error(`Unsupported repo context mode: ${requestedMode}. Use auto, upload, inline, or off.`);
    error.errorCode = "input.repo_context_mode_unsupported";
    throw error;
  }

  if (requestedMode !== "auto") {
    return {
      requestedMode,
      effectiveMode: requestedMode,
      attached: ["upload", "inline"].includes(requestedMode),
      reason: "explicit",
      matchedKeywords: [],
    };
  }

  if (contextDir) {
    return {
      requestedMode,
      effectiveMode: "off",
      attached: false,
      reason: "context_dir_supplied",
      matchedKeywords: [],
    };
  }

  if (contextFile) {
    return {
      requestedMode,
      effectiveMode: "off",
      attached: false,
      reason: "context_file_supplied",
      matchedKeywords: [],
    };
  }

  if (uploadFileCount > 0) {
    return {
      requestedMode,
      effectiveMode: "off",
      attached: false,
      reason: "upload_files_supplied",
      matchedKeywords: [],
    };
  }

  const normalizedPrompt = String(prompt || "");
  const matchedKeywords = AUTO_REPO_CONTEXT_PATTERNS
    .filter(([, pattern]) => pattern.test(normalizedPrompt))
    .map(([label]) => label);
  if (matchedKeywords.length > 0) {
    return {
      requestedMode,
      effectiveMode: "upload",
      attached: true,
      reason: "auto_keyword_match",
      matchedKeywords,
    };
  }

  return {
    requestedMode,
    effectiveMode: "off",
    attached: false,
    reason: "auto_no_repo_context_signal",
    matchedKeywords: [],
  };
}
