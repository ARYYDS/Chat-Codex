import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildRepoContextBundle } from "../src/repo-context-bundle.mjs";

const contextRoot = mkdtempSync(resolve(tmpdir(), "chatgpt-repo-context-"));
const fixtureRoot = mkdtempSync(resolve(tmpdir(), "chatgpt-repo-context-fixtures-"));
const repoContextModule = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "../src/repo-context-bundle.mjs")).href;

function run(command, args, { cwd, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, [command, ...args, result.stderr, result.stdout].join("\n"));
  return result;
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function write(path, text) {
  mkdirp(dirname(path));
  writeFileSync(path, text);
}

function initGitRepo(path) {
  mkdirp(path);
  run("git", ["init"], { cwd: path });
  return path;
}

function buildInChild(root, name = "fixture") {
  const childContextRoot = resolve(root, ".out");
  const input = `
    import { buildRepoContextBundle } from ${JSON.stringify(repoContextModule)};
    try {
      const result = buildRepoContextBundle({
        name: ${JSON.stringify(name)},
        contextRoot: ${JSON.stringify(childContextRoot)},
        maxFileBytes: 200_000,
        maxTotalBytes: 2_000_000
      });
      const manifest = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(result.manifest, "utf8")));
      console.log(JSON.stringify({ ok: true, result, securityScan: manifest.securityScan }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        errorCode: error.errorCode || "",
        message: error.message,
        details: error.details || null
      }));
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: root,
    input,
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: root,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function assertBlocked(output, rule, file) {
  assert.equal(output.ok, false);
  assert.equal(output.errorCode, "repo_context.secret_scan_blocked");
  const findings = output.details?.findings || [];
  assert.equal(
    findings.some((finding) =>
      finding.rule === rule && (!file || finding.file === file),
    ),
    true,
    JSON.stringify(findings, null, 2),
  );
}

try {
  const result = buildRepoContextBundle({
    name: "selftest",
    contextRoot,
    maxFileBytes: 200_000,
    maxTotalBytes: 2_000_000,
  });
  assert.equal(existsSync(result.context), true);
  assert.equal(existsSync(result.manifest), true);
  assert.equal(existsSync(result.zip), true);

  const text = readFileSync(result.context, "utf8");
  const manifest = JSON.parse(readFileSync(result.manifest, "utf8"));
  assert.equal(manifest.contextFile, "repo-context.md");
  assert.equal(typeof manifest.contextSha256, "string");
  assert.equal(manifest.securityScan.ok, true);
  assert.ok(manifest.securityScan.contentScanned > 0);
  assert.ok(manifest.files.length > 0);
  assert.ok(manifest.directories.length > 0);
  assert.ok(text.includes("# Source Map"));
  assert.ok(text.includes("## File: package.json"));
  assert.equal(manifest.files.some((entry) => entry.file.startsWith("plugins/")), false);
  assert.equal(manifest.files.some((entry) => entry.file === ".codex/skills/browser-loop/SKILL.md"), false);

  const packageRecord = manifest.files.find((entry) => entry.file === "package.json");
  assert.equal(packageRecord.context.included, true);
  assert.ok(packageRecord.context.startLine > 0);
  assert.ok(packageRecord.context.endLine >= packageRecord.context.startLine);

  const safeRepo = initGitRepo(resolve(fixtureRoot, "safe-git"));
  write(resolve(safeRepo, "package.json"), "{\"name\":\"safe\"}\n");
  write(resolve(safeRepo, "src/index.js"), "export const ok = true;\n");
  const safe = buildInChild(safeRepo);
  assert.equal(safe.ok, true);
  assert.equal(safe.securityScan.ok, true);
  const escapedName = buildInChild(safeRepo, "../../escape");
  assert.equal(escapedName.ok, true);
  assert.equal(escapedName.result.dir.startsWith(resolve(safeRepo, ".out")), true);
  assert.equal(escapedName.result.id.includes("/"), false);

  const gitSecretRepo = initGitRepo(resolve(fixtureRoot, "git-secret"));
  write(resolve(gitSecretRepo, "README.md"), "# secret fixture\n");
  write(
    resolve(gitSecretRepo, ".env"),
    "OPENAI_" + "API_KEY=sk-" + "proj-liveSecretValueThatShouldNeverUpload\n",
  );
  assertBlocked(buildInChild(gitSecretRepo), "env_file", ".env");

  const nongitSecretRepo = mkdirp(resolve(fixtureRoot, "nongit-secret"));
  write(resolve(nongitSecretRepo, "README.md"), "# secret fixture\n");
  write(resolve(nongitSecretRepo, ".aws/credentials"), "[default]\naws_secret_access_key=never-upload-this\n");
  assertBlocked(buildInChild(nongitSecretRepo), "aws_config", ".aws/credentials");

  const contentSecretRepo = initGitRepo(resolve(fixtureRoot, "content-secret"));
  write(
    resolve(contentSecretRepo, "config.txt"),
    "APP_" + "SEC" + "RET=" + "Rq7xM2nP9vL4sT8wY6zA1bC3dE5fG7hJ9kL2mN4pQ\n",
  );
  assertBlocked(buildInChild(contentSecretRepo), "secretish_assignment_high_entropy", "config.txt");

  const symlinkRepo = initGitRepo(resolve(fixtureRoot, "symlink-secret"));
  const outsideSecret = resolve(fixtureRoot, "outside-secret.txt");
  write(outsideSecret, "outside secret\n");
  symlinkSync(outsideSecret, resolve(symlinkRepo, "linked-secret.txt"));
  assertBlocked(buildInChild(symlinkRepo), "realpath_root_escape", "linked-secret.txt");
} finally {
  rmSync(contextRoot, { recursive: true, force: true });
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "repo-context-bundle" }, null, 2));
