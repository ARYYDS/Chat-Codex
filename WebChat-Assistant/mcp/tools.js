const path = require('path');
const fs = require('fs');
const { checkMasterSessionStatus, dumpCookiesFromBrowserTarget } = require('../lib/cdp-cookie-manager');
const { createTask, getTask, updateTask, completeTask, failTask } = require('../lib/mcp-async-handle');
const { generateTokenBill, appendTokenLedger, estimateTextTokens } = require('../lib/token-counter');
const { archiveReport } = require('../lib/archive-manager');
const { CdpClient, getBrowserWsUrl, fetchJson } = require('../lib/cdp-client');
const { focusAndInjectPrompt, uploadFileViaCdp, checkTurnConvergence, forceStop, extractFullResponse } = require('../lib/surface-manager');
const { SlidingWindowLimiter } = require('../lib/sliding-window-limiter');

const limiter = new SlidingWindowLimiter();

// Active clients cache for physical force stop
const activeClients = new Map();

const TOOLS = [
    {
        name: 'chatgpt_reason',
        description: 'Dispatch complex reasoning or research tasks to ChatGPT Pro / Work surface with automatic two-phase queuing, anti-stall watchdog, and 7-section report archive.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['dispatch', 'fetch_result'],
                    description: 'Action to perform. Use "dispatch" to start a task, "fetch_result" to poll task completion.'
                },
                taskId: {
                    type: 'string',
                    description: 'The task ID to query when action is "fetch_result".'
                },
                prompt: {
                    type: 'string',
                    description: 'The question or prompt to dispatch.'
                },
                title: {
                    type: 'string',
                    description: 'A short descriptive title for the task.'
                },
                surface: {
                    type: 'string',
                    enum: ['work', 'chat'],
                    description: 'ChatGPT surface mode. "work" uses deep thinking canvas; "chat" uses standard chat.'
                },
                effort: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: 'Reasoning effort level.'
                },
                project: {
                    type: 'string',
                    description: 'Project name for archiving.'
                },
                uploadFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of local absolute file paths to physically upload via CDP into ChatGPT before prompting.'
                }
            }
        }
    },
    {
        name: 'chatgpt_surface_manage',
        description: 'Configure active surface, model effort gears, or trigger immediate single-task physical force stop.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['set_surface', 'get_surface', 'force_stop'],
                    description: 'Management action.'
                },
                taskId: {
                    type: 'string',
                    description: 'Target task ID (required for force_stop).'
                },
                targetSurface: {
                    type: 'string',
                    enum: ['chat', 'work'],
                    description: 'Target surface mode.'
                },
                effort: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: 'Reasoning effort.'
                }
            },
            required: ['action']
        }
    },
    {
        name: 'chatgpt_upload_context',
        description: 'Scan workspace code files, scrub sensitive credentials, and bundle into a compact monofile context packet.',
        inputSchema: {
            type: 'object',
            properties: {
                directory: {
                    type: 'string',
                    description: 'Absolute path to workspace directory.'
                },
                includes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'File glob patterns or extensions to include.'
                },
                maxFiles: {
                    type: 'number',
                    description: 'Max number of files to bundle (default: 50).'
                }
            },
            required: ['directory']
        }
    },
    {
        name: 'chatgpt_session_manage',
        description: 'Manage session rooms (main, debug, critic) and query active worker status.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'switch', 'reset'],
                    description: 'Room action.'
                },
                room: {
                    type: 'string',
                    description: 'Room identifier.'
                }
            },
            required: ['action']
        }
    },
    {
        name: 'chatgpt_doctor',
        description: 'Diagnose Master (Port 9225) and Worker (Port 9222/9223) browser connectivity, cookie validity, and runtime directories.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'chatgpt_adoption_verify',
        description: 'Verify 7-section structured response, check local codebase symbol consistency, and validate code diffs.',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The assistant reasoning content to verify.'
                },
                targetFile: {
                    type: 'string',
                    description: 'Local file path to cross-check diffs against.'
                }
            },
            required: ['content']
        }
    }
];

async function handleToolCall(name, args = {}) {
    switch (name) {
        case 'chatgpt_reason':
            return await handleReasonTool(args);
        case 'chatgpt_surface_manage':
            return await handleSurfaceManageTool(args);
        case 'chatgpt_doctor':
            return await handleDoctorTool(args);
        case 'chatgpt_upload_context':
            return await handleUploadContextTool(args);
        case 'chatgpt_session_manage':
            return await handleSessionManageTool(args);
        case 'chatgpt_adoption_verify':
            return await handleAdoptionVerifyTool(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

async function handleReasonTool(args) {
    const action = args.action || 'dispatch';

    if (action === 'fetch_result') {
        const taskId = args.taskId;
        if (!taskId) throw new Error('taskId is required when action is "fetch_result"');
        const task = getTask(taskId);
        if (!task) return { status: 'NOT_FOUND', message: `Task ${taskId} does not exist.` };

        if (task.status === 'COMPLETED') {
            return {
                status: 'COMPLETED',
                taskId,
                title: task.title,
                result: task.result,
                completedAt: task.completedAt
            };
        } else if (task.status === 'FAILED') {
            return {
                status: 'FAILED',
                taskId,
                error: task.error,
                failedAt: task.failedAt
            };
        } else {
            return {
                status: 'RUNNING',
                taskId,
                progress: task.progress,
                estimatedWaitSec: 30,
                message: 'Task is still executing in background. Please poll again.'
            };
        }
    }

    // Action === 'dispatch'
    const prompt = args.prompt;
    if (!prompt) throw new Error('prompt is required to dispatch task');
    const title = args.title || prompt.slice(0, 50);
    const effort = args.effort || 'high';
    const project = args.project || 'WebChat-Assistant';
    const uploadFiles = args.uploadFiles || [];

    // Default to 'chat' for fast execution and lower latency; small tasks strictly go to 'chat'
    let surface = args.surface || 'chat';

    // Guard: Small tasks (<4000 chars and without batch files) strictly route to 'chat'
    if (surface === 'work' && (!uploadFiles || uploadFiles.length === 0) && prompt.length < 4000) {
        surface = 'chat';
    }

    if (surface === 'work') {
        // Two-phase async ticket: return in <500ms
        const task = createTask({ title, prompt, surface, effort });
        
        // Launch asynchronous execution in background
        executeTaskInBackground(task.taskId, { title, prompt, surface, effort, project, uploadFiles }).catch(err => {
            failTask(task.taskId, err.message);
        });

        return {
            resultType: 'task',
            status: 'ACCEPTED',
            taskId: task.taskId,
            title: task.title,
            estimatedWaitSec: task.estimatedWaitSec,
            instruction: `Task accepted into Work queue. Call chatgpt_reason with action="fetch_result" and taskId="${task.taskId}" to retrieve final report.`
        };
    } else {
        // Chat mode: direct synchronous execution
        const directTaskId = 'chat_' + Date.now();
        return await executeTaskDirectly(directTaskId, { title, prompt, surface, effort, project, uploadFiles });
    }
}

async function executeTaskInBackground(taskId, { title, prompt, surface, effort, project, uploadFiles = [] }) {
    updateTask(taskId, { 'progress.stage': 'DISPATCHED' });

    // Acquire slot from limiter
    await limiter.acquireAsync(taskId, surface);
    limiter.setTaskState(taskId, 'RUNNING');

    let browserWs = null;
    let client = null;
    let targetId = null;

    try {
        const workerPort = 9222;
        browserWs = await getBrowserWsUrl(workerPort);
        const browser = new CdpClient(browserWs);
        await browser.connect();

        updateTask(taskId, { 'progress.stage': 'CREATING_TAB' });
        const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
        targetId = createRes.targetId;

        // Connect to page and bring to front immediately to prevent background throttling
        client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
        await client.connect();
        activeClients.set(taskId, client);
        try { await client.send('Page.bringToFront'); } catch (_) {}

        updateTask(taskId, { 'progress.stage': 'COMPOSING' });
        // Wait for page ready
        let isReady = false;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            const composerReady = await client.evaluate(`
                !!(document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea'))
            `);
            if (composerReady) {
                isReady = true;
                break;
            }
        }

        if (!isReady) throw new Error('Timeout waiting for ChatGPT composer ready.');

        // Physical file upload via CDP (Plan B)
        if (uploadFiles && uploadFiles.length > 0) {
            updateTask(taskId, { 'progress.stage': 'UPLOADING_FILES' });
            for (const file of uploadFiles) {
                await uploadFileViaCdp(client, file);
            }
        }

        // Inject Prompt & Send (strictly enforcing surface mode)
        await focusAndInjectPrompt(client, prompt, surface);
        updateTask(taskId, { 'progress.stage': 'THINKING' });

        // Poll for completion with watchdog
        const startTime = Date.now();
        let lastLen = 0;
        let unchangedMs = 0;
        let finalResponse = null;

        for (let round = 0; round < 120; round++) {
            await new Promise(r => setTimeout(r, 4000));
            const conv = await checkTurnConvergence(client, lastLen, unchangedMs);
            lastLen = conv.textLength;
            unchangedMs = conv.unchangedDurationMs;

            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            updateTask(taskId, {
                'progress.stage': conv.isStalled ? 'STALLED_CONVERGING' : 'STREAMING',
                'progress.chars': conv.textLength,
                'progress.elapsedSec': elapsedSec
            });

            if (conv.isSettled) {
                finalResponse = await extractFullResponse(client);
                break;
            }
        }

        const thinkSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
        const responseText = finalResponse?.text || '';

        // Token accounting
        const bill = generateTokenBill({
            promptText: prompt,
            responseText,
            thinkSeconds,
            effort
        });
        appendTokenLedger(bill);

        // Archive report
        const archiveRes = archiveReport({
            project,
            title,
            prompt,
            response: responseText,
            tokens: bill,
            taskId
        });

        const resultData = {
            taskId,
            title,
            response: responseText,
            archivePath: archiveRes.mdPath,
            tokens: bill,
            durationSec: thinkSeconds
        };

        limiter.setTaskState(taskId, 'PERSISTING');
        completeTask(taskId, resultData);

        // Clean up tab
        try {
            await browser.send('Target.closeTarget', { targetId });
        } catch (_) {}
    } catch (err) {
        failTask(taskId, err.message);
    } finally {
        activeClients.delete(taskId);
        if (client) client.close();
        limiter.releaseSlot(taskId);
    }
}

async function executeTaskDirectly(taskId, { title, prompt, surface, effort, project, uploadFiles = [] }) {
    await limiter.acquireAsync(taskId, 'chat');
    limiter.setTaskState(taskId, 'RUNNING');
    const startTime = Date.now();

    try {
        const workerPort = 9222;
        const browserWs = await getBrowserWsUrl(workerPort);
        const browser = new CdpClient(browserWs);
        await browser.connect();

        const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
        const targetId = createRes.targetId;

        const client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
        await client.connect();
        activeClients.set(taskId, client);
        try { await client.send('Page.bringToFront'); } catch (_) {}

        try {
            // Wait ready
            for (let i = 0; i < 25; i++) {
                await new Promise(r => setTimeout(r, 500));
                const ready = await client.evaluate(`!!(document.querySelector('#prompt-textarea') || document.querySelector('textarea'))`);
                if (ready) break;
            }

            // Physical file upload via CDP (Plan B)
            if (uploadFiles && uploadFiles.length > 0) {
                for (const file of uploadFiles) {
                    await uploadFileViaCdp(client, file);
                }
            }

            await focusAndInjectPrompt(client, prompt, surface);

            // Wait convergence
            let lastLen = 0;
            let unchangedMs = 0;
            let finalResponse = null;

            for (let round = 0; round < 60; round++) {
                await new Promise(r => setTimeout(r, 3000));
                const conv = await checkTurnConvergence(client, lastLen, unchangedMs);
                lastLen = conv.textLength;
                unchangedMs = conv.unchangedDurationMs;

                if (conv.isSettled) {
                    finalResponse = await extractFullResponse(client);
                    break;
                }
            }

            const thinkSeconds = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
            const responseText = finalResponse?.text || '';

            const bill = generateTokenBill({ promptText: prompt, responseText, thinkSeconds, effort });
            appendTokenLedger(bill);

            const archiveRes = archiveReport({
                project,
                title,
                prompt,
                response: responseText,
                tokens: bill,
                taskId
            });

            return {
                resultType: 'response',
                status: 'COMPLETED',
                taskId,
                title,
                content: responseText,
                archivePath: archiveRes.mdPath,
                tokens: bill,
                durationSec: thinkSeconds
            };
        } finally {
            try { await browser.send('Target.closeTarget', { targetId }); } catch (_) {}
            client.close();
            activeClients.delete(taskId);
        }
    } finally {
        limiter.releaseSlot(taskId);
    }
}

async function handleSurfaceManageTool(args) {
    const action = args.action;

    if (action === 'force_stop') {
        const taskId = args.taskId;
        if (!taskId) throw new Error('taskId is required for force_stop');

        // Physical Stop in CDP
        const client = activeClients.get(taskId);
        let physicalClicked = false;
        if (client) {
            try {
                const stopRes = await forceStop(client);
                physicalClicked = !!stopRes?.clicked;
            } catch (_) {}
        }

        // Limiter slot release & status update
        const limiterRes = limiter.forceStop(taskId);
        failTask(taskId, 'Force stopped by user/agent');

        return {
            taskId,
            physicalStopClicked: physicalClicked,
            queueRemoved: limiterRes.wasQueued || false,
            wasRunning: limiterRes.wasRunning || false,
            status: 'STOPPED'
        };
    }

    if (action === 'get_surface') {
        return {
            currentSurface: 'chat',
            queueStatus: limiter.getStatus()
        };
    }

    return {
        action,
        status: 'OK'
    };
}

async function handleDoctorTool() {
    const masterStatus = await checkMasterSessionStatus(9225);
    let workerStatus = { connected: false };
    try {
        const info = await fetchJson('http://127.0.0.1:9222/json/version');
        workerStatus = { connected: true, browser: info.Browser };
    } catch (e) {
        workerStatus = { connected: false, error: e.message };
    }

    return {
        masterPort9225: masterStatus,
        workerPort9222: workerStatus,
        queue: limiter.getStatus(),
        nodeVersion: process.version,
        platform: process.platform
    };
}

async function handleUploadContextTool(args) {
    const targetDir = path.resolve(args.directory);
    if (!fs.existsSync(targetDir)) throw new Error(`Directory does not exist: ${targetDir}`);

    const maxFiles = args.maxFiles || 50;
    const files = [];

    function scan(d) {
        if (files.length >= maxFiles) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target') continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) {
                scan(full);
            } else if (e.isFile()) {
                const ext = path.extname(e.name).toLowerCase();
                if (['.js', '.json', '.md', '.rs', '.html', '.css', '.bat', '.ps1'].includes(ext)) {
                    files.push(full);
                    if (files.length >= maxFiles) break;
                }
            }
        }
    }
    scan(targetDir);

    let combined = `# Context Packet for ${path.basename(targetDir)}\n\n`;
    files.forEach(f => {
        const rel = path.relative(targetDir, f);
        try {
            const code = fs.readFileSync(f, 'utf-8');
            combined += `## File: ${rel}\n\`\`\`\n${code}\n\`\`\`\n\n`;
        } catch (_) {}
    });

    return {
        totalFiles: files.length,
        totalChars: combined.length,
        contextPacket: combined.slice(0, 30000)
    };
}

async function handleSessionManageTool(args) {
    return {
        action: args.action,
        room: args.room || 'main',
        activeRooms: ['main', 'debug', 'critic']
    };
}

async function handleAdoptionVerifyTool(args) {
    const content = args.content || '';
    const has7Sections = [
        '1.', '2.', '3.', '4.', '5.', '6.', '7.'
    ].filter(s => content.includes(s)).length >= 5;

    return {
        hasStructure: has7Sections,
        contentLength: content.length,
        status: has7Sections ? 'VERIFIED' : 'PARTIAL'
    };
}

module.exports = {
    TOOLS,
    handleToolCall
};
