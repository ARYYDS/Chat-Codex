'use strict';

/**
 * 客户端配置 JSONC 注释容错与异构语法分流器
 * 1. 解决 Cursor / VS Code 配置文件含 // 注释导致原生 JSON.parse 崩溃的问题
 * 2. 区分 VS Code 原生 ("servers") 与 Cursor / Claude ("mcpServers") 的格式差异
 * 3. 注入 Node 绝对可执行文件路径，防止 GUI 客户端找不到全局环境变量报 spawn node ENOENT
 */

const path = require('node:path');

function parseJsonc(text) {
  if (typeof text !== 'string') return {};
  // Match strings, escaped characters, or comments (block & line)
  // If group 1 (comment) matched, replace with empty string; otherwise keep the string token intact
  const clean = text
    .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})|"(?:\\.|[^"\\])*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (match, comment) => {
      return comment ? '' : match;
    })
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(clean);
}

function generateClientConfig(clientType, handoffCliPath, runtimeConfigPath = 'C:\\GPT-Chat-codex-handoff\\runtime.local.json') {
  const nodeBinary = process.execPath;
  const scriptPath = path.resolve(handoffCliPath);

  const entry = {
    command: nodeBinary,
    args: ['--dns-result-order=ipv4first', scriptPath, 'mcp'],
    env: {
      NODE_OPTIONS: '--dns-result-order=ipv4first',
      HANDOFF_CONFIG: runtimeConfigPath,
    },
  };

  if (clientType === 'vscode' || clientType === 'vscode-native') {
    // VS Code 原生 MCP 规范使用 "servers"
    return {
      servers: {
        'chat-codex': entry,
      },
    };
  }

  // Cursor, Claude Desktop, Windsurf, Roo Code 等使用标准 "mcpServers"
  return {
    mcpServers: {
      'chat-codex': entry,
    },
  };
}

const fs = require('node:fs');

function getKnownClientTargets() {
  const appData = process.env.APPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  return [
    {
      id: 'claude',
      name: 'Claude Desktop',
      type: 'mcpServers',
      configPath: path.join(appData, 'Claude', 'claude_desktop_config.json'),
      dirPath: path.join(appData, 'Claude'),
    },
    {
      id: 'cursor',
      name: 'Cursor (Global MCP)',
      type: 'mcpServers',
      configPath: path.join(userProfile, '.cursor', 'mcp.json'),
      dirPath: path.join(userProfile, '.cursor'),
    },
    {
      id: 'cursor-cline',
      name: 'Cursor Cline Extension',
      type: 'mcpServers',
      configPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      dirPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings'),
    },
    {
      id: 'vscode-roo',
      name: 'VS Code Roo Code Extension',
      type: 'mcpServers',
      configPath: path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'),
      dirPath: path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings'),
    },
    {
      id: 'vscode-cline',
      name: 'VS Code Cline Extension',
      type: 'mcpServers',
      configPath: path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      dirPath: path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings'),
    },
    {
      id: 'antigravity',
      name: 'Google Antigravity MCP',
      type: 'mcpServers',
      configPath: path.join(userProfile, '.gemini', 'config', 'mcp_config.json'),
      dirPath: path.join(userProfile, '.gemini', 'config'),
    },
    {
      id: 'vscode',
      name: 'VS Code Native MCP',
      type: 'servers',
      configPath: path.join(appData, 'Code', 'User', 'settings.json'),
      dirPath: path.join(appData, 'Code', 'User'),
    },
  ];
}

function detectClientConfigs() {
  const targets = getKnownClientTargets();
  return targets.map(t => {
    const dirExists = fs.existsSync(t.dirPath);
    const fileExists = fs.existsSync(t.configPath);
    let installed = false;
    if (fileExists) {
      try {
        const raw = fs.readFileSync(t.configPath, 'utf8');
        const parsed = parseJsonc(raw);
        installed = Boolean(
          (t.type === 'servers' ? parsed.servers?.['chat-codex'] : parsed.mcpServers?.['chat-codex'])
        );
      } catch {}
    }
    return {
      ...t,
      dirExists,
      fileExists,
      installed,
    };
  });
}

function installClientConfig(targetId, handoffCliPath, runtimeConfigPath, options = {}) {
  const targets = getKnownClientTargets();
  const target = targets.find(t => t.id === targetId);
  if (!target) throw new Error(`Unknown client target: ${targetId}`);

  const generated = generateClientConfig(target.id, handoffCliPath, runtimeConfigPath);
  if (options.dryRun) {
    return { target: target.name, path: target.configPath, dryRun: true, generated };
  }

  fs.mkdirSync(target.dirPath, { recursive: true });
  let existing = {};
  if (fs.existsSync(target.configPath)) {
    try {
      const raw = fs.readFileSync(target.configPath, 'utf8');
      existing = parseJsonc(raw);
    } catch (err) {
      // Create backup if unparseable
      const backup = `${target.configPath}.bak-${Date.now()}`;
      fs.copyFileSync(target.configPath, backup);
      existing = {};
    }
  }

  if (target.type === 'servers') {
    existing.servers = existing.servers || {};
    existing.servers['chat-codex'] = generated.servers['chat-codex'];
  } else {
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers['chat-codex'] = generated.mcpServers['chat-codex'];
  }

  fs.writeFileSync(target.configPath, JSON.stringify(existing, null, 2), 'utf8');
  return { target: target.name, path: target.configPath, installed: true };
}

module.exports = {
  parseJsonc,
  generateClientConfig,
  getKnownClientTargets,
  detectClientConfigs,
  installClientConfig,
};

