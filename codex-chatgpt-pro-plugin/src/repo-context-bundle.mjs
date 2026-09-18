import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { devspaceRoot, repoRoot, runId } from "./runtime-config.mjs";
import { sha256 } from "./chatgpt-messages.mjs";
import { repoContextSecurityError, scanRepoContextFiles } from "./repo-context-security.mjs";

export const defaultContextRoot = resolve(devspaceRoot, "context-bundles");

const defaultMaxFileBytes = Number(process.env.CONTEXT_MAX_FILE_BYTES || 120_000);
const defaultMaxTotalBytes = Number(process.env.CONTEXT_MAX_TOTAL_BYTES || 1_500_000);
const excludedExtensions = new Set([
  ".avi",
  ".db",
  ".gif",
  ".gz",
  ".heic",
  ".icns",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".sqlite",
  ".tar",
  ".tgz",
  ".webp",
  ".zip",
]);

function sh(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function gitFiles() {
  const inGit = sh("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inGit.status !== 0) return null;
  const result = sh("git", ["ls-files", "-co", "--exclude-standard"]);
  if (result.status !== 0) return null;
  return result.stdout.split("\n").filter(Boolean).sort();
}

function findFiles() {
  const result = sh("find", [
    ".",
    "-type",
    "f",
    "!",
    "-path",
    "./node_modules/*",
    "!",
    "-path",
    "./.devspace/*",
    "!",
    "-path",
    "./.git/*",
    "!",
    "-path",
    "./plugins/*",
    "!",
    "-path",
    "./recycle-bin/*",
    "!",
    "-path",
    "./docs/assets/*",
  ]);
  if (result.status !== 0) throw new Error(result.stderr || "find failed");
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/^\.\//, ""))
    .sort();
}

function contextCandidate(file) {
  if (!existsSync(resolve(repoRoot, file))) return false;
  if (file.startsWith("node_modules/")) return false;
  if (file.startsWith(".devspace/")) return false;
  if (file.startsWith(".git/")) return false;
  if (file.startsWith("plugins/")) return false;
  if (file.startsWith("recycle-bin/")) return false;
  if (file.startsWith("docs/assets/")) return false;
  if (excludedExtensions.has(extname(file).toLowerCase())) return false;
  return true;
}

function listFiles() {
  return (gitFiles() || findFiles()).filter(contextCandidate);
}

function extensionLanguage(path) {
  const map = new Map([
    [".js", "javascript"],
    [".mjs", "javascript"],
    [".json", "json"],
    [".md", "markdown"],
    [".toml", "toml"],
    [".yml", "yaml"],
    [".yaml", "yaml"],
  ]);
  return map.get(extname(path)) || "";
}

function locSummary(files) {
  const rows = files.map((file) => {
    const text = readFileSync(resolve(repoRoot, file), "utf8");
    return {
      file,
      bytes: Buffer.byteLength(text),
      lines: text.length ? text.split("\n").length : 0,
      sha256: sha256(text),
    };
  });
  return {
    files: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    lines: rows.reduce((sum, row) => sum + row.lines, 0),
    byFile: rows,
  };
}

function directoriesFromFiles(fileRecords) {
  const dirs = new Map();
  for (const record of fileRecords) {
    const parts = record.file.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const dir = parts.slice(0, i).join("/");
      const existing = dirs.get(dir) || {
        path: dir,
        files: 0,
        lines: 0,
        bytes: 0,
        startLine: null,
        endLine: null,
      };
      existing.files += 1;
      existing.lines += record.lines;
      existing.bytes += record.bytes;
      if (record.context?.included) {
        existing.startLine = existing.startLine == null
          ? record.context.startLine
          : Math.min(existing.startLine, record.context.startLine);
        existing.endLine = existing.endLine == null
          ? record.context.endLine
          : Math.max(existing.endLine, record.context.endLine);
      }
      dirs.set(dir, existing);
    }
  }
  return [...dirs.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function push(lines, value = "") {
  if (Array.isArray(value)) lines.push(...value);
  else lines.push(value);
}

function safeBundleName(name) {
  return String(name || "repo-context")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "repo-context";
}

function containedOutputDir(contextRoot, id) {
  const root = resolve(contextRoot);
  const dir = resolve(root, id);
  if (dir !== root && dir.startsWith(`${root}${sep}`)) return dir;
  const error = new Error(`Unsafe repo context output directory: ${dir}`);
  error.errorCode = "repo_context.output_path_escape";
  throw error;
}

function addFileSection(lines, file, { maxFileBytes, includedBytes, maxTotalBytes }) {
  const path = resolve(repoRoot, file);
  const bytes = readFileSync(path).length;
  const source = readFileSync(path, "utf8");
  const sourceLines = source.length ? source.split("\n").length : 0;
  const startLine = lines.length + 1;
  const record = {
    file,
    bytes,
    lines: sourceLines,
    sha256: sha256(source),
    context: {
      included: false,
      startLine,
      endLine: startLine,
      reason: "",
    },
  };

  if (bytes > maxFileBytes) {
    push(lines, [
      `## File: ${file}`,
      "",
      `Skipped: file is ${bytes} bytes, above CONTEXT_MAX_FILE_BYTES=${maxFileBytes}.`,
      "",
    ]);
    record.context.reason = "max_file_bytes";
    record.context.endLine = lines.length;
    return { record, includedBytes };
  }

  if (includedBytes + bytes > maxTotalBytes) {
    push(lines, [
      `## File: ${file}`,
      "",
      `Skipped: bundle reached CONTEXT_MAX_TOTAL_BYTES=${maxTotalBytes}.`,
      "",
    ]);
    record.context.reason = "max_total_bytes";
    record.context.endLine = lines.length;
    return { record, includedBytes };
  }

  push(lines, [
    `## File: ${file}`,
    "",
    `Path: ${file}`,
    `Lines: ${sourceLines}`,
    `Bytes: ${bytes}`,
    `sha256: ${record.sha256}`,
    "",
    `\`\`\`${extensionLanguage(file)}`,
    source.replaceAll("```", "``\\`"),
    "```",
    "",
  ]);
  record.context.included = true;
  record.context.reason = "included";
  record.context.endLine = lines.length;
  return { record, includedBytes: includedBytes + bytes };
}

export function buildRepoContextBundle({
  name,
  contextRoot = defaultContextRoot,
  maxFileBytes = defaultMaxFileBytes,
  maxTotalBytes = defaultMaxTotalBytes,
} = {}) {
  const id = `${runId()}-${safeBundleName(name)}`;
  const dir = containedOutputDir(contextRoot, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const files = listFiles();
  const securityScan = scanRepoContextFiles(files, { root: repoRoot, maxFileBytes });
  if (!securityScan.ok) throw repoContextSecurityError(securityScan.findings, {
    filesChecked: securityScan.filesChecked,
    contentScanned: securityScan.contentScanned,
    skipped: securityScan.skipped,
  });

  const loc = locSummary(files);
  const lines = [];
  const fileRecords = [];
  let includedBytes = 0;

  push(lines, [
    `# Repo Context Monofile: ${basename(repoRoot)}`,
    "",
    `Created: ${new Date().toISOString()}`,
    `Repo root: ${repoRoot}`,
    "",
    "## Metadata",
    "",
    `- files: ${loc.files}`,
    `- lines: ${loc.lines}`,
    `- bytes: ${loc.bytes}`,
    `- maxFileBytes: ${maxFileBytes}`,
    `- maxTotalBytes: ${maxTotalBytes}`,
    "",
    "## Repo Structure",
    "",
    ...files.map((file) => `- ${file}`),
    "",
    "## LOC By File",
    "",
    "| File | Lines | Bytes | sha256 |",
    "| --- | ---: | ---: | --- |",
    ...loc.byFile.map((row) => `| ${row.file} | ${row.lines} | ${row.bytes} | ${row.sha256} |`),
    "",
    "# File Contents",
    "",
  ]);

  for (const file of files) {
    const result = addFileSection(lines, file, { maxFileBytes, includedBytes, maxTotalBytes });
    fileRecords.push(result.record);
    includedBytes = result.includedBytes;
  }

  const directories = directoriesFromFiles(fileRecords);
  push(lines, [
    "# Source Map",
    "",
    "## Files",
    "",
    "| File | Included | Context Lines | Source Lines | Bytes | sha256 |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...fileRecords.map((record) =>
      `| ${record.file} | ${record.context.included ? "yes" : `no:${record.context.reason}`} | ${record.context.startLine}-${record.context.endLine} | ${record.lines} | ${record.bytes} | ${record.sha256} |`,
    ),
    "",
    "## Directories",
    "",
    "| Directory | Files | Context Lines | Source Lines | Bytes |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...directories.map((dirRecord) =>
      `| ${dirRecord.path} | ${dirRecord.files} | ${dirRecord.startLine || ""}-${dirRecord.endLine || ""} | ${dirRecord.lines} | ${dirRecord.bytes} |`,
    ),
    "",
  ]);

  const contextMd = `${lines.join("\n")}\n`;
  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    repoRoot,
    maxFileBytes,
    maxTotalBytes,
    contextFile: "repo-context.md",
    contextSha256: sha256(contextMd),
    securityScan,
    loc,
    files: fileRecords,
    directories,
  };

  const manifestPath = resolve(dir, "manifest.json");
  const contextPath = resolve(dir, "repo-context.md");
  const zipPath = resolve(dir, "repo-context.zip");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(contextPath, contextMd, { mode: 0o600 });

  const zip = spawnSync("zip", ["-qr", zipPath, "manifest.json", "repo-context.md"], {
    cwd: dir,
    encoding: "utf8",
  });
  const zipped = zip.status === 0 && existsSync(zipPath);
  if (zipped) chmodSync(zipPath, 0o600);

  return {
    id,
    dir,
    manifest: manifestPath,
    context: contextPath,
    zip: zipped ? zipPath : null,
    loc: {
      files: loc.files,
      lines: loc.lines,
      bytes: loc.bytes,
    },
    included: {
      files: fileRecords.filter((record) => record.context.included).length,
      bytes: includedBytes,
    },
  };
}
