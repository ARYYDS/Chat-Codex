const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig, getChromePath } = require('../lib/runtime-config');
const { checkMasterSessionStatus, syncMasterCookiesToWorkers } = require('../lib/cdp-cookie-manager');
const { listTasks, getTask } = require('../lib/mcp-async-handle');
const { handleToolCall } = require('../mcp/tools');
const { fetchJson } = require('../lib/cdp-client');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function startGuiServer(options = {}) {
    const port = options.port || 8765;
    const publicDir = path.resolve(__dirname, 'public');
    const sseClients = new Set();

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${port}`);
        const pathname = url.pathname;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        // SSE Event Stream
        if (pathname === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write('event: connected\ndata: {"status":"connected"}\n\n');
            sseClients.add(res);

            req.on('close', () => {
                sseClients.delete(res);
            });
            return;
        }

        // REST API
        if (pathname === '/api/status' && req.method === 'GET') {
            const master = await checkMasterSessionStatus(9225);
            let worker = { connected: false };
            try {
                const w = await fetchJson('http://127.0.0.1:9222/json/version');
                worker = { connected: true, browser: w.Browser };
            } catch (_) {}

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ master, worker, config: loadConfig() }));
        }

        if (pathname === '/api/telemetry' && req.method === 'GET') {
            const tasks = listTasks();
            const active = tasks.filter(t => t.status === 'RUNNING' || t.status === 'ACCEPTED').length;
            const completed = tasks.filter(t => t.status === 'COMPLETED').length;

            let totalTokens = 0;
            tasks.forEach(t => {
                if (t.result?.tokens?.totalTokens) {
                    totalTokens += t.result.tokens.totalTokens;
                }
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                activeTasks: active,
                completedTasks: completed,
                totalTokens
            }));
        }

        if (pathname === '/api/tasks' && req.method === 'GET') {
            const tasks = listTasks();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(tasks));
        }

        if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/stop') && req.method === 'POST') {
            const parts = pathname.split('/');
            const taskId = parts[3];
            try {
                const stopResult = await handleToolCall('chatgpt_surface_manage', {
                    action: 'force_stop',
                    taskId
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(stopResult));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        }

        if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/report') && req.method === 'GET') {
            const parts = pathname.split('/');
            const taskId = parts[3];
            const task = getTask(taskId);
            if (!task) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Task not found' }));
            }

            let markdown = task.result?.response || '';
            if (task.result?.archivePath && fs.existsSync(task.result.archivePath)) {
                try {
                    markdown = fs.readFileSync(task.result.archivePath, 'utf-8');
                } catch (_) {}
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                taskId,
                title: task.title,
                archivePath: task.result?.archivePath || '',
                markdown
            }));
        }

        if (pathname === '/api/master/sync' && req.method === 'POST') {
            try {
                const syncRes = await syncMasterCookiesToWorkers(9225, [9222, 9223]);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(syncRes));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        }

        if (pathname === '/api/tasks/dispatch' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    const prompt = parsed.prompt;
                    const surface = parsed.surface || 'work';
                    const effort = parsed.effort || 'high';

                    const dispatchRes = await handleToolCall('chatgpt_reason', {
                        action: 'dispatch',
                        prompt,
                        surface,
                        effort
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(dispatchRes));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Static file serving
        let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403);
            return res.end('Forbidden');
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(publicDir, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';

        try {
            const content = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': mime });
            res.end(content);
        } catch (_) {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    // 1Hz Telemetry broadcast
    const broadcastTimer = setInterval(async () => {
        if (sseClients.size === 0) return;
        const tasks = listTasks();
        const active = tasks.filter(t => t.status === 'RUNNING' || t.status === 'ACCEPTED').length;
        const completed = tasks.filter(t => t.status === 'COMPLETED').length;

        const data = JSON.stringify({
            timestamp: Date.now(),
            activeTasks: active,
            completedTasks: completed,
            tasks: tasks.slice(0, 15)
        });

        for (const client of sseClients) {
            try {
                client.write(`event: telemetry\ndata: ${data}\n\n`);
            } catch (_) {
                sseClients.delete(client);
            }
        }
    }, 1000);

    return new Promise((resolve) => {
        server.listen(port, () => {
            console.log(`=======================================================`);
            console.log(`🌟 WebChat-Assistant Studio GUI Server is LIVE!`);
            console.log(`📡 Local Address : http://localhost:${port}`);
            console.log(`⚡ SSE Streaming : http://localhost:${port}/api/events`);
            console.log(`📁 Public Dir    : ${publicDir}`);
            console.log(`=======================================================`);

            if (!options.noOpen) {
                const chrome = getChromePath();
                if (fs.existsSync(chrome)) {
                    spawn(chrome, [
                        `--app=http://127.0.0.1:${port}`,
                        '--window-size=1440,900',
                        '--user-data-dir=C:\\GPT-Chat-codex-handoff\\gui-app-profile'
                    ], { detached: true, stdio: 'ignore' }).unref();
                }
            }

            resolve(server);
        });
    });
}

module.exports = { startGuiServer };
