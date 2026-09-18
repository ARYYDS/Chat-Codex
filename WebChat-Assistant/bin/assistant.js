#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig, getChromePath, RUNTIME_ROOT } = require('../lib/runtime-config');
const { checkMasterSessionStatus, syncMasterCookiesToWorkers } = require('../lib/cdp-cookie-manager');
const { installMcpConfig } = require('../lib/installer');
const { startGuiServer } = require('../gui/server');
const { startServer: startMcpServer } = require('../mcp/server');
const { handleToolCall } = require('../mcp/tools');
const { fetchJson } = require('../lib/cdp-client');

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
    switch (command) {
        case 'doctor':
            await runDoctor();
            break;
        case 'sync':
            await runSync();
            break;
        case 'chat':
            await runChat(args.slice(1));
            break;
        case 'setup':
            await runSetup();
            break;
        case 'gui':
            await runGui();
            break;
        case 'mcp':
            startMcpServer();
            break;
        case 'master':
            await launchMaster();
            break;
        case 'worker':
            await launchWorker();
            break;
        case 'help':
        default:
            printHelp();
            break;
    }
}

async function runDoctor() {
    console.log('======================================================');
    console.log('🩺 WebChat-Assistant 运行时健康与多沙盒状态诊断');
    console.log('======================================================');

    const config = loadConfig();
    console.log(`📁 运行态根目录 : ${RUNTIME_ROOT} [${fs.existsSync(RUNTIME_ROOT) ? 'OK' : 'MISSING'}]`);
    console.log(`📁 种子沙盒目录 : ${config.masterSeedDir} [${fs.existsSync(config.masterSeedDir) ? 'OK' : 'MISSING'}]`);
    console.log(`📁 研报归档目录 : ${config.historyRoot} [${fs.existsSync(config.historyRoot) ? 'OK' : 'MISSING'}]`);
    console.log(`📁 执行流水目录 : ${config.runsRoot} [${fs.existsSync(config.runsRoot) ? 'OK' : 'MISSING'}]`);
    console.log(`🌐 宿主 Chrome  : ${getChromePath()} [${fs.existsSync(getChromePath()) ? 'OK' : 'NOT FOUND'}]`);
    console.log(`⚡ Node.js 引擎 : ${process.version}`);

    console.log('\n--- 母版沙盒 (Port 9225) 凭据嗅探 ---');
    const masterStatus = await checkMasterSessionStatus(9225);
    if (masterStatus.connected) {
        console.log(`✅ 母版 CDP 连通: 活跃 (检测到 ${masterStatus.totalCookies} 枚 Cookie)`);
        if (masterStatus.hasSessionToken) {
            console.log(`🔑 ChatGPT Session Token: 已登录有效 (到期时间戳: ${masterStatus.sessionTokenExpiry})`);
        } else {
            console.log(`⚠️ ChatGPT Session Token: 未找到。请在母版中访问 chatgpt.com 完成登录。`);
        }
    } else {
        console.log(`❌ 母版 CDP 未运行 (Port 9225 连接超时)。可通过 'node bin/assistant.js master' 拉起。`);
    }

    console.log('\n--- Worker 运行时 (Port 9222) 自动化状态 ---');
    try {
        const workerInfo = await fetchJson('http://127.0.0.1:9222/json/version');
        console.log(`✅ Worker 9222 连通: ${workerInfo.Browser}`);
    } catch (e) {
        console.log(`❌ Worker 9222 未运行: ${e.message}。可通过 'node bin/assistant.js worker' 拉起。`);
    }

    console.log('======================================================\n');
}

async function runSync() {
    console.log('🔄 正在从母版沙盒 (Port 9225) 热同步凭据至 Worker...');
    try {
        const res = await syncMasterCookiesToWorkers(9225, [9222, 9223]);
        console.log(`✅ 凭据热分发完成！`);
        console.log(`   母版 Cookie 总数: ${res.masterStatus.totalCookies}`);
        for (const [port, s] of Object.entries(res.workers)) {
            if (s.success) {
                console.log(`   👉 Worker (Port ${port}): 成功热注入 ${s.count} 枚 Cookie`);
            } else {
                console.log(`   👉 Worker (Port ${port}): 注入失败 (${s.error})`);
            }
        }
    } catch (err) {
        console.error(`❌ 同步失败: ${err.message}`);
        process.exitCode = 1;
    }
}

async function runChat(chatArgs) {
    let contextDir = null;
    const uploadFiles = [];
    let surface = 'chat';
    let effort = 'high';
    const cleanWords = [];

    for (let i = 0; i < chatArgs.length; i++) {
        const a = chatArgs[i];
        if (a === '--context') {
            contextDir = path.resolve(__dirname, '..');
        } else if (a === '--context-dir') {
            contextDir = path.resolve(chatArgs[++i]);
        } else if (a === '--upload-file' || a === '-f') {
            uploadFiles.push(path.resolve(chatArgs[++i]));
        } else if (a === '--surface') {
            surface = chatArgs[++i];
        } else if (a === '--effort') {
            effort = chatArgs[++i];
        } else {
            cleanWords.push(a);
        }
    }

    let prompt = cleanWords.join(' ').trim();
    if (!prompt) {
        console.error('Usage: node bin/assistant.js chat "Your prompt" [--context] [--upload-file <path>]');
        process.exitCode = 1;
        return;
    }

    if (contextDir) {
        console.log(`📦 [方案 A] 正在扫描并组装工程上下文包: ${contextDir}...`);
        const ctx = await handleToolCall('chatgpt_upload_context', { directory: contextDir });
        console.log(`✅ 上下文包组装完成: ${ctx.totalFiles} 个文件，${ctx.totalChars} 字符`);
        prompt = `【本地工程上下文包】\n${ctx.contextPacket}\n\n【用户指令】\n${prompt}`;
    }

    if (uploadFiles.length > 0) {
        console.log(`📎 [方案 B] 准备通过 CDP 物理上传本地文件:`);
        uploadFiles.forEach(f => console.log(`   👉 ${f} (${fs.existsSync(f) ? fs.statSync(f).size + ' 字节' : '文件不存在!'})`));
    }

    console.log(`\n🚀 正在派发任务到 WebChat-Assistant 执行引擎...`);
    console.log(`📝 指令摘要: "${prompt.slice(0, 80)}..."\n`);

    try {
        const res = await handleToolCall('chatgpt_reason', {
            action: 'dispatch',
            prompt,
            surface,
            effort,
            uploadFiles,
            title: cleanWords.join(' ').slice(0, 40)
        });

        console.log('======================================================');
        console.log(`🎉 任务执行完成 (耗时: ${res.durationSec}s | Token: ${res.tokens.totalTokens})`);
        console.log(`📁 研报已落盘至: ${res.archivePath}`);
        console.log('------------------------------------------------------');
        console.log(res.content || res.result?.response || res.instruction || '');
        console.log('======================================================');
    } catch (err) {
        console.error(`❌ 任务执行异常: ${err.message}`);
        process.exitCode = 1;
    }
}

async function runSetup() {
    console.log('📦 正在自动侦测并将 WebChat-Assistant 注册至主流 Agent 与 IDE...');
    const results = installMcpConfig({
        serverName: 'webchat-assistant',
        mcpScript: path.resolve(__dirname, '..', 'mcp', 'index.js')
    });

    results.forEach(r => {
        if (r.installed) {
            console.log(`   ✅ [${r.name}] 成功写入配置: ${r.path}`);
        } else {
            console.log(`   ❌ [${r.name}] 写入失败: ${r.error || 'Unknown'}`);
        }
    });
    console.log('\n🎉 MCP 服务注册完成！重新启动对应 IDE 即可使用。');
}

async function runGui() {
    const portIndex = args.indexOf('--port');
    const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 8765;
    const noOpen = args.includes('--no-open');

    await startGuiServer({ port, noOpen });
}

async function launchMaster() {
    const config = loadConfig();
    const profileDir = config.masterSeedDir;
    const prefFile = path.join(profileDir, 'Default', 'Preferences');

    if (fs.existsSync(prefFile)) {
        try {
            const p = JSON.parse(fs.readFileSync(prefFile, 'utf-8'));
            if (!p.profile) p.profile = {};
            p.profile.exit_type = 'Normal';
            p.profile.exited_cleanly = true;
            fs.writeFileSync(prefFile, JSON.stringify(p, null, 2), 'utf-8');
        } catch (_) {}
    }

    const script = path.resolve(__dirname, '..', 'start_master.bat');
    console.log(`🚀 正在前台交互式拉起母版浏览器 (Port: 9225)...`);

    try {
        const { execSync } = require('child_process');
        execSync(`schtasks /create /tn LaunchMaster /tr "${script}" /sc once /st 00:00 /it /f`, { stdio: 'ignore' });
        execSync(`schtasks /run /tn LaunchMaster`, { stdio: 'ignore' });
        console.log(`✅ 母版已通过交互式任务计划拉起，请在视窗中登录 ChatGPT。`);
    } catch (_) {
        const chrome = getChromePath();
        const proc = spawn(chrome, [
            '--remote-debugging-port=9225',
            '--remote-debugging-address=127.0.0.1',
            `--user-data-dir=${profileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            'https://chatgpt.com'
        ], { detached: true, stdio: 'ignore' });
        proc.unref();
        console.log(`✅ 母版已拉起。`);
    }
}

async function launchWorker() {
    const script = path.resolve(__dirname, '..', 'start_worker.bat');
    console.log(`🚀 正在前台交互式启动 Worker 1 (Port: 9222)...`);

    try {
        const { execSync } = require('child_process');
        execSync(`schtasks /create /tn LaunchWorker1 /tr "${script}" /sc once /st 00:00 /it /f`, { stdio: 'ignore' });
        execSync(`schtasks /run /tn LaunchWorker1`, { stdio: 'ignore' });
        console.log(`✅ Worker 1 已通过交互式任务计划启动。`);
    } catch (_) {
        const chrome = getChromePath();
        const workerProfile = path.resolve(__dirname, '..', '..', 'sub-instance-1');
        const proc = spawn(chrome, [
            '--remote-debugging-port=9222',
            '--remote-debugging-address=127.0.0.1',
            `--user-data-dir=${workerProfile}`,
            '--disable-background-networking',
            '--disk-cache-size=10485760',
            '--no-first-run',
            '--no-default-browser-check',
            'https://chatgpt.com'
        ], { detached: true, stdio: 'ignore' });
        proc.unref();
        console.log(`✅ Worker 1 已启动。`);
    }
}

function printHelp() {
    console.log(`
WebChat-Assistant - Enterprise Reasoning Companion & Master-Worker CDP Engine

Usage:
  node bin/assistant.js <command> [options]

Commands:
  doctor              Diagnose Master 9225, Worker 9222, cookies, and paths.
  sync                Hot-sync cookies from Master 9225 to Worker 9222/9223.
  chat "<prompt>"     Dispatch reasoning task via CDP and save report.
  setup               Auto-install MCP configuration into Antigravity & IDEs.
  gui [--port 8765]   Launch lightweight Web GUI & SSE telemetry server.
  mcp                 Start standard JSON-RPC 2.0 Stdio MCP server.
  master              Launch Master-Seed browser for human authentication.
  worker              Launch Worker 1 headless/headful automation browser.
`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
}
