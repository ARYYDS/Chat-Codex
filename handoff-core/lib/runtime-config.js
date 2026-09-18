'use strict';
const fs = require('node:fs');
const path = require('node:path');

function option(name, args = process.argv.slice(2)) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[i + 1];
}
function projectId(value) {
  if (typeof value !== 'string' || !value.trim() || /[\\/:*?"<>|]/.test(value) || /^\.+$/.test(value) || /[ .]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('Invalid archive project ID');
  }
  return value;
}
function loadConfig(configPath = process.env.HANDOFF_CONFIG || 'C:/GPT-Chat-codex-handoff/runtime.local.json') {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of ['codeRoot', 'runtimeRoot', 'historyRoot', 'runsRoot', 'workersRoot', 'masterProfile', 'projectPath', 'chromePath']) {
    if (!path.isAbsolute(config[key] || '')) throw new Error(`Config ${key} must be an absolute path`);
    config[key] = path.normalize(config[key]);
  }
  projectId(config.archiveProjectId);
  if (!Array.isArray(config.cdpPorts) || !config.cdpPorts.length || config.cdpPorts.some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw new Error('Invalid CDP ports');
  return config;
}
function resolveProjectInfo(projectArg, idArg, config = loadConfig()) {
  const explicitPath = projectArg || option('--project') || option('-p') || process.env.HANDOFF_PROJECT_PATH;
  const full = path.resolve(explicitPath || config.projectPath);
  const aliases = [config.codeRoot, config.projectPath, config.runtimeRoot, ...(config.projectAliases || [])].map(p => path.resolve(p).toLowerCase());
  const identifier = idArg || option('--project-id') || process.env.HANDOFF_PROJECT_ID || ((!explicitPath || aliases.includes(full.toLowerCase())) ? config.archiveProjectId : path.basename(full));
  return { projectIdentifier: projectId(identifier), projectFullPath: full };
}
function runOutput(name, config = loadConfig()) {
  fs.mkdirSync(config.runsRoot, { recursive: true });
  return path.join(config.runsRoot, name);
}
function inputResult(name, config = loadConfig()) {
  return option('--input') || path.join(config.runsRoot, name);
}
module.exports = { loadConfig, resolveProjectInfo, projectId, option, runOutput, inputResult };
