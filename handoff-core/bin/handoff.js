#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadConfig, resolveProjectInfo } = require('../lib/runtime-config');
const { detectClientConfigs, installClientConfig } = require('../lib/jsonc-config-dispatcher');

const commands = {
  chat: 'pipeline/auto_chat_pipeline.js',
  sync: 'pipeline/sync_search_history.js',
  index: 'pipeline/index_builder.js',
  archive: 'pipeline/archive_local_results.js',
  summary: 'pipeline/print_summaries.js',
  mcp: 'mcp/index.js',
  gui: 'gui/server.js',
};

const command = process.argv[2] || 'help';

function launchDesktopApp(targetUrl, config) {
  const tauriCandidates = [
    path.join(__dirname, '..', '..', 'chat-codex-studio.exe'),
    path.join(__dirname, 'chat-codex-studio.exe'),
    path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'chat-codex-studio.exe'),
  ];
  for (const tauriExe of tauriCandidates) {
    if (fs.existsSync(tauriExe)) {
      try {
        const child = spawn(tauriExe, [], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log(`[handoff gui] Launched Tauri Native Desktop Client: ${tauriExe}`);
        return;
      } catch (err) {
        console.warn(`[handoff gui] Tauri client launch warning: ${err.message}`);
      }
    }
  }

  const chromeCandidates = [
    config?.chromePath,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
  ].filter(Boolean);

  let chromeExe = null;
  for (const p of chromeCandidates) {
    if (fs.existsSync(p)) {
      chromeExe = p;
      break;
    }
  }

  if (chromeExe) {
    const userDataDir = 'C:\\GPT-Chat-codex-handoff\\gui-app-profile';
    const chromeArgs = [
      `--app=${targetUrl}`,
      '--window-size=1440,900',
      `--user-data-dir=${userDataDir}`,
    ];
    try {
      const child = spawn(chromeExe, chromeArgs, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`[handoff gui] Launched Chrome Desktop App at ${targetUrl}`);
      return;
    } catch (err) {
      console.warn(`[handoff gui] Chrome app launch error: ${err.message}, falling back to default browser`);
    }
  }

  try {
    if (process.platform === 'win32') {
      const child = spawn('rundll32', ['url.dll,FileProtocolHandler', targetUrl], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(opener, [targetUrl], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    console.log(`[handoff gui] Opened default browser at ${targetUrl}`);
  } catch (e) {
    console.warn(`[handoff gui] Could not automatically open browser: ${e.message}`);
  }
}

async function main() {
  if (command === 'help' || command === '--help') {
    console.log('handoff config | doctor [--browser] | setup [--detect | --install [all|client]] [--dry-run] | chat --prompt TEXT | sync | index | archive --input FILE | summary | mcp [--help] | gui [--port PORT] [--no-open]\nConfiguration: HANDOFF_CONFIG or C:/GPT-Chat-codex-handoff/runtime.local.json\nProject routing: --project PATH and optional --project-id ID');
    return;
  }
  const config = loadConfig();
  if (command === 'config') { console.log(JSON.stringify({ ...config, resolvedProject: resolveProjectInfo() }, null, 2)); return; }
  if (command === 'setup') {
    const isDryRun = process.argv.includes('--dry-run');
    const isInstall = process.argv.includes('--install');
    const targetIdx = process.argv.indexOf('--install');
    const targetArg = targetIdx !== -1 && process.argv[targetIdx + 1] && !process.argv[targetIdx + 1].startsWith('--')
      ? process.argv[targetIdx + 1]
      : 'all';

    const detected = detectClientConfigs();
    if (!isInstall) {
      console.log(JSON.stringify({
        title: 'Detected IDE and Editor MCP Configurations',
        cliPath: path.resolve(__dirname, 'handoff.js'),
        nodePath: process.execPath,
        clients: detected,
      }, null, 2));
      return;
    }

    const results = [];
    const targetsToInstall = targetArg === 'all'
      ? detected.filter(d => d.dirExists || d.fileExists)
      : detected.filter(d => d.id === targetArg);

    if (targetsToInstall.length === 0) {
      console.log(`[setup] No matching installed client targets found for: ${targetArg}`);
      return;
    }

    for (const t of targetsToInstall) {
      try {
        const res = installClientConfig(
          t.id,
          path.resolve(__dirname, 'handoff.js'),
          process.env.HANDOFF_CONFIG || 'C:\\GPT-Chat-codex-handoff\\runtime.local.json',
          { dryRun: isDryRun }
        );
        results.push({ ...res, success: true });
      } catch (err) {
        results.push({ target: t.name, success: false, error: err.message });
      }
    }
    console.log(JSON.stringify({ dryRun: isDryRun, results }, null, 2));
    return;
  }
  if (command === 'doctor') {
    const checks = { codeRoot: fs.existsSync(config.codeRoot), historyRoot: fs.existsSync(config.historyRoot), masterProfilePresent: fs.existsSync(path.join(config.masterProfile, 'Local State')), nodeVersion: process.version, project: resolveProjectInfo() };
    if (process.argv.includes('--browser')) {
      checks.browsers = [];
      for (const port of config.cdpPorts) {
        try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500) }); const info = await response.json(); checks.browsers.push({ port, browser: info.Browser }); }
        catch { checks.browsers.push({ port, available: false }); }
      }
    }
    console.log(JSON.stringify(checks, null, 2));
    if (!checks.codeRoot || !checks.historyRoot || !checks.masterProfilePresent) process.exitCode = 1;
    return;
  }

  if (command === 'gui') {
    const portArgIdx = process.argv.indexOf('--port');
    const port = (portArgIdx !== -1 && process.argv[portArgIdx + 1] && !process.argv[portArgIdx + 1].startsWith('--'))
      ? parseInt(process.argv[portArgIdx + 1], 10)
      : (parseInt(process.env.GUI_PORT, 10) || 8765);
    const noOpen = process.argv.includes('--no-open');
    const serverPath = path.join(__dirname, '..', 'gui', 'server.js');

    if (!fs.existsSync(serverPath)) {
      throw new Error(`GUI server entry file not found: ${serverPath}`);
    }

    const guiArgs = ['--port', String(port)];
    if (noOpen) guiArgs.push('--no-open');

    for (let i = 3; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg !== '--port' && arg !== String(port) && arg !== '--no-open' && !guiArgs.includes(arg)) {
        guiArgs.push(arg);
      }
    }

    let isAlreadyRunning = false;
    try {
      const ping = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(500) });
      if (ping.ok) isAlreadyRunning = true;
    } catch {}

    if (isAlreadyRunning) {
      console.log(`[handoff gui] GUI server is already active on port ${port}.`);
      if (!noOpen) {
        const targetUrl = `http://127.0.0.1:${port}`;
        launchDesktopApp(targetUrl, config);
      }
      return;
    }

    console.log(`[handoff gui] Starting GUI server on port ${port}...`);
    const serverProc = spawn(process.execPath, [serverPath, ...guiArgs], {
      stdio: 'inherit',
      env: { ...process.env, GUI_PORT: String(port) },
    });

    if (!noOpen) {
      const targetUrl = `http://127.0.0.1:${port}`;
      setTimeout(() => {
        launchDesktopApp(targetUrl, config);
      }, 1200);
    }

    serverProc.on('error', (err) => {
      console.error(`[handoff gui] Failed to start GUI server: ${err.message}`);
      process.exitCode = 1;
    });

    serverProc.on('exit', (code) => {
      process.exitCode = code ?? 0;
    });

    process.on('SIGINT', () => {
      if (serverProc && !serverProc.killed) serverProc.kill('SIGINT');
    });
    process.on('SIGTERM', () => {
      if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
    });
    return;
  }

  const entry = commands[command];
  if (!entry) throw new Error(`Unknown command: ${command}`);
  const child = spawnSync(process.execPath, [path.join(__dirname, '..', entry), ...process.argv.slice(3)], { stdio: 'inherit', env: process.env });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
