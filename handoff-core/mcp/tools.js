'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadConfig, resolveProjectInfo } = require('../lib/runtime-config');
const { AsyncTaskHandleManager } = require('../lib/mcp-async-handle');
const { createShadowWorktree } = require('../lib/git-shadow-sandbox');
const { runWithHardTimeout } = require('../lib/process-tree-guard');
const { manageSurface } = require('../lib/surface_manager');

const globalTaskManager = new AsyncTaskHandleManager();

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*(?!\[REDACTED\])\S+/i,
];

const REQUIRED_RESULT_SECTIONS = [
  '## Verdict',
  '## Assumptions',
  '## Evidence Used',
  '## Proposed Changes',
  '## Tests',
  '## Risks',
  '## Unknowns',
];

const toolsDefinition = [
  {
    name: 'chatgpt_reason',
    description: 'Dispatch a high-level reasoning task to ChatGPT Pro web session via CDP pipeline, supporting non-blocking async handles and human-in-the-loop arbitration.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The objective, question, or reasoning task prompt.' },
        surface: {
          type: 'string',
          enum: ['chat', 'work', 'auto'],
          default: 'auto',
          description: 'ChatGPT operating surface: "chat" (lightweight interactive discussion, quick code/qa) vs "work" (deep thought partner platform - TPP, persistent Outputs/Library files, and Sources panel). Autonomous choice by Agent.'
        },
        roomId: { type: 'string', enum: ['main', 'debug', 'critic', 'scratch'], default: 'main', description: 'The semantic room for session isolation.' },
        model: { type: 'string', description: 'Target ChatGPT model name or alias (e.g. "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "latest", "default").' },
        reasoningEffort: {
          type: 'string',
          enum: ['instant', 'light', 'medium', 'high', 'extra_high', 'max', 'ultra', 'pro', 'low'],
          default: 'high',
          description: 'Desired thinking depth gear. Named levels: instant/light (gear 0), medium (gear 1), high (gear 2), extra_high (gear 3), max/pro (gear 4 in Chat, gear 4 in Work), ultra (gear 5 in Work).'
        },
        timeoutMs: { type: 'number', default: 300000, description: 'Timeout in milliseconds (default 5m).' },
        action: { 
          type: 'string', 
          enum: ['dispatch', 'check_task', 'fetch_result', 'submit_human_review', 'abort_task'], 
          default: 'dispatch', 
          description: 'Async task handle lifecycle action: "dispatch" (submit reasoning), "check_task" (check status), "fetch_result" (retrieve completed result), "submit_human_review", or "abort_task".' 
        },
        asyncHandle: { type: 'boolean', default: false, description: 'Return instant task handle (<1ms) to avoid 60s IDE client RPC timeouts.' },
        taskId: { type: 'string', description: 'Task ID for check_task, fetch_result, submit_human_review, or abort_task.' },
        humanFeedback: { type: 'object', description: 'Human review feedback and steering notes.' },
      },
    },
  },
  {
    name: 'chatgpt_surface_manage',
    description: 'Inspect current ChatGPT web surface ("chat" vs "work"), switch modes autonomously, configure underlying model and reasoning effort gears, or list conversations by surface.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['detect', 'switch', 'list_conversations', 'configure'],
          default: 'detect',
          description: 'Action to perform: "detect" (inspect surface, model, and thinking gear), "switch" (switch Home surface), "configure" (set target surface, model, and thinking gear), or "list_conversations" (list historical conversations by surface).'
        },
        targetSurface: {
          type: 'string',
          enum: ['chat', 'work'],
          description: 'Target surface when action is "switch" or "configure" ("chat" or "work").'
        },
        model: {
          type: 'string',
          description: 'Target model when action is "configure" (e.g. "gpt-6-astra", "gpt-5.6-sol", "latest").'
        },
        effort: {
          type: 'string',
          enum: ['instant', 'light', 'medium', 'high', 'extra_high', 'max', 'ultra', 'pro', 'low'],
          description: 'Target thinking depth gear when action is "configure" (e.g. "extra_high", "ultra", "pro", "instant").'
        },
        port: {
          type: 'number',
          default: 9222,
          description: 'CDP Worker port (e.g. 9222 or 9223).'
        },
        limit: {
          type: 'number',
          default: 20,
          description: 'Limit for list_conversations.'
        }
      },
      required: ['action']
    },
  },
  {
    name: 'chatgpt_upload_context',
    description: 'Scan repository files, strip secrets, and generate a monofile context bundle for ChatGPT attachment.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to project root. Defaults to current workspace.' },
        includePaths: { type: 'array', items: { type: 'string' }, description: 'Specific relative paths or globs to include.' },
        maxFileBytes: { type: 'number', default: 100000, description: 'Max bytes per file to bundle.' },
      },
    },
  },
  {
    name: 'chatgpt_session_manage',
    description: 'List, switch, or inspect ChatGPT room sessions mapped to current Git project.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'inspect', 'reset'], default: 'list', description: 'Action to perform on session rooms.' },
        roomId: { type: 'string', enum: ['main', 'debug', 'critic', 'scratch'], description: 'Specific room ID to inspect or reset.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'chatgpt_doctor',
    description: 'Read-only preflight health check for CDP ports, browser sessions, master profile, and runtime configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        checkBrowser: { type: 'boolean', default: true, description: 'Probe CDP browser endpoints for active version.' },
      },
    },
  },
  {
    name: 'chatgpt_adoption_verify',
    description: 'Local Adoption Gate: Verify that ChatGPT response adheres to 7-section contract, check proposed file changes against workspace, and optionally execute sandboxed patch dry-run in an isolated Git Worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        resultMarkdown: { type: 'string', description: 'The raw markdown reasoning result from ChatGPT.' },
        projectRoot: { type: 'string', description: 'Target workspace root to verify files against.' },
        dryRunPatch: { type: 'boolean', default: false, description: 'Execute isolated shadow verification in a temporary Git Worktree.' },
        patchContent: { type: 'string', description: 'Unified diff or patch content to apply in shadow sandbox.' },
        testCommand: { type: 'string', description: 'Command to run inside the shadow sandbox (e.g. "npm test").' },
        timeoutMs: { type: 'number', default: 30000, description: 'Timeout in ms for the test command in shadow sandbox.' },
      },
      required: ['resultMarkdown'],
    },
  },
];

async function handleDoctor(args, config) {
  const checks = {
    codeRoot: fs.existsSync(config.codeRoot),
    runtimeRoot: fs.existsSync(config.runtimeRoot),
    historyRoot: fs.existsSync(config.historyRoot),
    masterProfilePresent: fs.existsSync(path.join(config.masterProfile, 'Local State')),
    nodeVersion: process.version,
    project: resolveProjectInfo(null, null, config),
    browsers: [],
  };

  if (args.checkBrowser !== false && Array.isArray(config.cdpPorts)) {
    for (const port of config.cdpPorts) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
        const info = await res.json();
        checks.browsers.push({ port, status: 'online', browser: info.Browser, wsUrl: info.webSocketDebuggerUrl });
      } catch {
        checks.browsers.push({ port, status: 'offline' });
      }
    }
  }

  return checks;
}

async function handleAdoptionVerify(args, config) {
  const { resultMarkdown, projectRoot = config.codeRoot } = args;
  const missingSections = REQUIRED_RESULT_SECTIONS.filter(s => !resultMarkdown.includes(s));
  const hasSecret = SECRET_PATTERNS.some(p => p.test(resultMarkdown));

  // Extract file mentions e.g. `path/to/file`
  const fileMatches = resultMarkdown.match(/`([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)`/g) || [];
  const filesChecked = [];

  for (const raw of new Set(fileMatches)) {
    const clean = raw.replace(/`/g, '').trim();
    if (clean.includes('/') || clean.includes('\\')) {
      const fullPath = path.resolve(projectRoot, clean);
      const exists = fs.existsSync(fullPath);
      filesChecked.push({ file: clean, exists, status: exists ? 'accepted' : 'rejected_missing_locally' });
    }
  }

  let sandboxResult = null;
  if (args.dryRunPatch && args.patchContent) {
    let shadow = null;
    try {
      shadow = createShadowWorktree(projectRoot);
      const patchFile = path.join(shadow.shadowDir, `.patch-${Date.now()}.diff`);
      fs.writeFileSync(patchFile, args.patchContent, 'utf8');

      const applyRes = spawnSync('git', ['apply', '--check', '--ignore-space-change', '--ignore-whitespace', patchFile], {
        cwd: shadow.shadowDir,
        encoding: 'utf8',
        windowsHide: true,
      });

      if (applyRes.status !== 0) {
        sandboxResult = {
          success: false,
          stage: 'apply_check',
          error: applyRes.stderr || applyRes.stdout || 'Patch does not apply cleanly',
        };
      } else {
        spawnSync('git', ['apply', '--ignore-space-change', '--ignore-whitespace', patchFile], {
          cwd: shadow.shadowDir,
          encoding: 'utf8',
          windowsHide: true,
        });

        if (args.testCommand) {
          const parts = args.testCommand.trim().split(/\s+/);
          const cmd = parts[0];
          const cmdArgs = parts.slice(1);
          const testRes = await runWithHardTimeout(cmd, cmdArgs, { cwd: shadow.shadowDir, shell: true }, args.timeoutMs || 30000);
          sandboxResult = {
            success: testRes.code === 0,
            stage: 'test_execution',
            exitCode: testRes.code,
            stdout: (testRes.stdout || '').slice(0, 1000),
            stderr: (testRes.stderr || '').slice(0, 1000),
          };
        } else {
          sandboxResult = {
            success: true,
            stage: 'patch_applied_cleanly',
          };
        }
      }
    } catch (err) {
      sandboxResult = {
        success: false,
        stage: 'sandbox_exception',
        error: err.message,
      };
    } finally {
      if (shadow) {
        try { shadow.cleanup(); } catch {}
      }
    }
  }

  const contractPassed = missingSections.length === 0 && !hasSecret;
  const sandboxPassed = sandboxResult ? sandboxResult.success : true;

  return {
    validContract: missingSections.length === 0,
    missingSections,
    hasPotentialSecrets: hasSecret,
    filesEvaluated: filesChecked,
    sandboxResult,
    gateStatus: (contractPassed && sandboxPassed) ? 'PASSED_ADOPTION_GATE' : 'NEEDS_REVISION',
  };
}

async function handleSessionManage(args, config) {
  const rooms = ['main', 'debug', 'critic', 'scratch'];
  const statePath = path.join(config.runtimeRoot, '.runtime', 'state', 'chrome-session.json');
  let sessionData = {};
  if (fs.existsSync(statePath)) {
    try { sessionData = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
  }

  if (args.action === 'list') {
    return {
      activeProjectId: config.archiveProjectId,
      rooms: rooms.map(r => ({
        roomId: r,
        role: r === 'main' ? 'Primary Architecture' : r === 'debug' ? 'Bug Diagnostics' : r === 'critic' ? 'Code Review' : 'Scratchpad',
        activeTarget: sessionData.currentRoom === r ? sessionData.targetId : null,
      })),
    };
  }

  return { action: args.action, roomId: args.roomId, status: 'acknowledged' };
}

async function handleUploadContext(args, config) {
  const root = path.resolve(args.projectRoot || config.codeRoot);
  const maxBytes = args.maxFileBytes || 100000;
  const bundle = [];
  let totalBytes = 0;

  function scan(dir, depth = 0) {
    if (depth > 5 || totalBytes > 1000000) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (['.git', 'node_modules', '.runtime', 'Cache', 'Crashpad'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scan(full, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (['.js', '.mjs', '.ts', '.py', '.json', '.md', '.ps1', '.bat'].includes(ext)) {
          const stat = fs.statSync(full);
          if (stat.size <= maxBytes) {
            const content = fs.readFileSync(full, 'utf8');
            const sanitized = SECRET_PATTERNS.some(p => p.test(content)) ? '[REDACTED DUE TO DETECTED SECRETS]' : content;
            bundle.push({ file: path.relative(root, full).replace(/\\/g, '/'), bytes: stat.size, content: sanitized });
            totalBytes += stat.size;
          }
        }
      }
    }
  }

  scan(root);
  return {
    projectRoot: root,
    bundledFilesCount: bundle.length,
    totalBytes,
    bundleSummary: bundle.map(b => ({ file: b.file, bytes: b.bytes })),
  };
}

async function handleReason(args, config) {
  const action = args.action || 'dispatch';

  if (action === 'check_task') {
    if (!args.taskId) throw new Error('taskId is required for check_task action');
    return globalTaskManager.checkTaskStatus(args.taskId);
  }

  if (action === 'fetch_result') {
    if (!args.taskId) throw new Error('taskId is required for fetch_result action');
    const task = globalTaskManager.getTask(args.taskId);
    if (!task) {
      return { success: false, status: 'NOT_FOUND', taskId: args.taskId, error: `Task ${args.taskId} not found` };
    }
    return {
      success: true,
      taskId: task.id,
      status: task.status,
      resultMarkdown: task.resultMarkdown || null,
      metadata: task.metadata || {},
      createdAt: task.createdAt,
      completedAt: task.completedAt || null,
      isCompleted: task.status === 'COMPLETED'
    };
  }

  if (action === 'submit_human_review') {
    if (!args.taskId) throw new Error('taskId is required for submit_human_review action');
    return globalTaskManager.submitHumanFeedback(args.taskId, args.humanFeedback || {});
  }

  if (action === 'abort_task') {
    if (!args.taskId) throw new Error('taskId is required for abort_task action');
    const task = globalTaskManager.getTask(args.taskId);
    if (task) {
      task.status = 'ABORTED_BY_USER';
      return { success: true, taskId: args.taskId, status: 'ABORTED_BY_USER' };
    }
    return { success: false, error: `Task ${args.taskId} not found` };
  }

  // Async mode: work mode or explicit asyncHandle (instant ticket <1ms, avoids stdio timeouts)
  if (args.asyncHandle || args.surface === 'work') {
    const isWork = args.surface === 'work';
    const task = globalTaskManager.createTask(args.prompt || 'Reasoning task', {
      roomId: args.roomId || 'main',
      surface: isWork ? 'work' : (args.surface || 'chat'),
      model: args.model || (isWork ? 'gpt-6-astra-wm' : 'latest'),
      reasoningEffort: args.reasoningEffort || 'high',
      status: isWork ? 'ACCEPTED' : 'AWAITING_HUMAN_INPUT'
    });

    if (isWork) {
      handleDoctor({ checkBrowser: true }, config).then(checks => {
        const b = checks.browsers.find(x => x.status === 'online');
        if (b) {
          const pipelineScript = path.join(__dirname, '..', 'pipeline', 'auto_chat_pipeline.js');
          const childArgs = [
            pipelineScript,
            '--port', String(b.port),
            '--surface', 'work',
            '--task-id', task.taskId,
            '--prompt', args.prompt || ''
          ];
          if (args.model) childArgs.push('--model', args.model);
          if (args.reasoningEffort) childArgs.push('--effort', args.reasoningEffort);
          if (args.upload) childArgs.push('--upload', args.upload);
          if (args.projectRoot) childArgs.push('--project', args.projectRoot);
          try {
            const child = spawn(process.execPath, childArgs, {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: process.env
            });
            child.unref();
          } catch {}
        }
      }).catch(() => {});
    }

    return {
      resultType: 'task',
      status: task.status,
      taskId: task.taskId,
      surface: isWork ? 'work' : (args.surface || 'chat'),
      estimatedWaitSec: isWork ? 120 : 25,
      message: isWork
        ? `Work mode task accepted (<500ms). Dispatched to background pipeline. Fetch final 7-section report via chatgpt_reason with action: "fetch_result" and taskId: "${task.taskId}".`
        : task.message,
      guiUrl: task.guiUrl
    };
  }

  // Preflight: Ensure CDP Worker is online (prefer dedicated worker ports 9222/9223 over master 9225)
  const checks = await handleDoctor({ checkBrowser: true }, config);
  const onlineBrowser = checks.browsers.find(b => b.status === 'online' && b.port !== 9225) || checks.browsers.find(b => b.status === 'online');
  const packetId = `pkt-${Date.now().toString(36)}`;

  if (!onlineBrowser) {
    return {
      status: 'BROWSER_UNAVAILABLE',
      packetId,
      message: 'No CDP Chrome instance is currently online. Please start worker with start_sub1.bat (Port 9222) or start_sub2.bat (Port 9223).',
      configuredPorts: config.cdpPorts,
    };
  }

  const prompt = args.prompt;
  if (!prompt) {
    return {
      status: 'DISPATCH_READY',
      packetId,
      roomId: args.roomId || 'main',
      surface: 'chat',
      model: args.model || 'latest',
      reasoningEffort: args.reasoningEffort || 'high',
      port: onlineBrowser.port,
      promptLength: 0,
      contractHeader: 'BEGIN_REASONING_RESULT',
      instructions: 'Send packet to browser CDP endpoint; parse 7 standard sections on completion.',
    };
  }

  // Synchronous Chat Mode: execute directly and return markdown reasoning result
  const { executeSingleTask } = require('../pipeline/auto_chat_pipeline');
  const projectInfo = resolveProjectInfo(args.projectRoot || config.codeRoot);

  const taskObj = {
    prompt,
    surface: 'chat',
    model: args.model,
    effort: args.reasoningEffort || 'high',
    reasoningEffort: args.reasoningEffort || 'high',
    upload: args.upload,
    maxRetries: 2
  };

  const res = await executeSingleTask(
    onlineBrowser.port,
    taskObj,
    1,
    1,
    projectInfo,
    { surface: 'chat', model: args.model, effort: args.reasoningEffort || 'high' }
  );

  let resultMarkdown = '';
  if (res && res.path && fs.existsSync(res.path)) {
    resultMarkdown = fs.readFileSync(res.path, 'utf8');
  }

  return {
    status: res.status || (res.success ? 'COMPLETED' : 'FAILED'),
    packetId,
    title: res.title,
    resultMarkdown,
    archivePath: res.path,
    chars: res.chars || resultMarkdown.length,
    durationSec: res.durationSec,
    retryCount: res.retryCount || 0,
    delegatedToLocal: !!res.delegatedToLocal,
    port: onlineBrowser.port,
    action: res.action || 'NONE',
    message: res.message || 'Task completed successfully.'
  };
}

async function executeTool(name, args, config = loadConfig()) {
  switch (name) {
    case 'chatgpt_doctor':
      return await handleDoctor(args, config);
    case 'chatgpt_adoption_verify':
      return await handleAdoptionVerify(args, config);
    case 'chatgpt_session_manage':
      return await handleSessionManage(args, config);
    case 'chatgpt_upload_context':
      return await handleUploadContext(args, config);
    case 'chatgpt_surface_manage':
      return await manageSurface(args);
    case 'chatgpt_reason':
      return await handleReason(args, config);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { toolsDefinition, executeTool, globalTaskManager };

