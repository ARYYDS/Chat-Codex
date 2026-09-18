const fs = require('fs');
const path = require('path');

const DEFAULT_CDP_HOST = process.env.CDP_HOST || 'http://127.0.0.1:9222';
const STAGGER_INTERVAL_MS = 5000; // 严格间隔 5 秒
const { runOutput, loadConfig } = require('../lib/runtime-config');
const { dumpCookiesFromBrowserTarget, injectCookiesToWorker } = require('../lib/cdp-cookie-manager');
const { estimateTextTokens, generateTokenBill, appendTokenLedger } = require('../lib/token_counter');

function getDefaultOutputFile() {
    try {
        return runOutput('results_10_dispatched.json');
    } catch {
        const fallback = path.resolve(__dirname, '..', '..', 'runs', 'results_10_dispatched.json');
        try { fs.mkdirSync(path.dirname(fallback), { recursive: true }); } catch {}
        return fallback;
    }
}

const QUESTIONS = [
    {
        id: 1,
        title: "反爬与风控指纹演进 (Turnstile/Sentinel/JA4/PoW)",
        prompt: "请联网搜索分析：2026年针对 Cloudflare Turnstile 与 OpenAI Sentinel 的最新行为特征指纹检测机制深度演进（包括 TLS 1.3 JA4/JA4H 指纹、HTTP/2 SETTINGS 帧行为、Canvas/WebGL 探针、Proof of Work 动态难度自适应算法），并分析自动化客户端的最优对抗策略。"
    },
    {
        id: 2,
        title: "CDP 宿主性能与并发调度 (CDP Resource & Concurrency)",
        prompt: "请联网搜索分析：2026年 Chromium DevTools Protocol (CDP) 在高并发自动化场景下的资源消耗瓶颈与系统级优化方案（有头静默渲染 vs headless-new 区别、多 Tab 上下文复用、IPC 开销、以及单机稳定支撑多路会话的最佳实践）。"
    },
    {
        id: 3,
        title: "多 Agent 协作与状态机架构 (Multi-Agent Systems & State Machines)",
        prompt: "请联网搜索分析：2026年主流多 Agent 协作系统（如 AutoGen 0.4+, LangGraph, CrewAI 体系）在长程任务推理、状态机管理、以及多智能体通信协议（Agent-to-Agent Protocols）上的最新突破与架构差异。"
    },
    {
        id: 4,
        title: "混合端云协同与分流策略 (Hybrid Edge-Cloud Inference)",
        prompt: "请联网搜索分析：2026年大模型混合端云推理（Hybrid Edge-Cloud Inference）技术方案：本地小模型（如 Gemma 4, Qwen 2.5/3）与云端前沿大模型（如 GPT-5, Claude 3.5/3.7）的动态分流、投机采样（Speculative Decoding）与协同推理策略。"
    },
    {
        id: 5,
        title: "网络通道与抗审查协议演进 (Tunnel & Network Protocols)",
        prompt: "请联网搜索分析：2026年网络抗封锁与抗深度包检测（DPI）协议最新演进：VLESS Reality, Vision, ShadowTLS v3, TUIC v5 等协议的握手特征混淆、防重放攻击与传输性能对比分析。"
    },
    {
        id: 6,
        title: "浏览器会话保持与凭据热克隆 (Session Persistence & DPAPI/App-Bound)",
        prompt: "请联网搜索分析：2026年生产级分布式爬虫与浏览器集群中的会话保持（Session Persistence）方案：针对 Windows DPAPI / App-Bound Encryption (v20) 的安全机制演化与轻量级无状态 Profile 热克隆技术。"
    },
    {
        id: 7,
        title: "强化学习与代码自愈 Agent (RL-based Coding & Self-Healing)",
        prompt: "请联网搜索分析：2026年基于强化学习（RL / PPO / GRPO）的代码生成与软件工程自愈 Agent（Self-Healing Coding Agent）工业界落地现状，重点分析在 SWE-bench Verified 2026 上的最新顶级框架与自省修正机制。"
    },
    {
        id: 8,
        title: "长上下文与持久化记忆引擎 (Long Context vs Persistent Memory)",
        prompt: "请联网搜索分析：2026年大模型超长上下文（1M+ tokens）与外部持久化记忆系统（如 Mem0, Zep, GraphRAG）在企业级 Agent 中的工程权衡：检索召回精度、上下文窗口衰减（Lost in the Middle）与推理成本分析。"
    },
    {
        id: 9,
        title: "桌面端计算机操作 Agent (OS Computer-Use & Desktop GUI)",
        prompt: "请联网搜索分析：2026年桌面端操作系统交互 Agent（如 Claude Computer Use, OpenAI Operator, Windows Copilot Actions）在操作系统底层 API（UI Automation, Win32, Accessibility API, 视觉定位）上的最新工程落地架构与延迟优化。"
    },
    {
        id: 10,
        title: "自动化抗指纹工具链生态对比 (Stealth Browser Frameworks)",
        prompt: "请联网搜索分析：2026年自动化抗指纹工具链现状对比：原生 CDP 宿主管道直连、Puppeteer-Extra-Stealth、Playwright Stealth、以及深度定制化浏览器（Camoufox, Undetected Chrome, MultiLogin 内核）在顶级反爬系统下的存活率与指纹纯净度深度对比。"
    }
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Evaluate expression on target tab via temporary WebSocket connection
async function evalOnTab(wsUrl, expression, timeoutMs = 12000, awaitPromise = false) {
    return new Promise((resolve) => {
        let timer = null;
        let ws = null;
        try {
            ws = new WebSocket(wsUrl);
            timer = setTimeout(() => {
                if (ws) try { ws.close(); } catch(e) {}
                resolve(null);
            }, timeoutMs);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    id: 1,
                    method: 'Runtime.evaluate',
                    params: {
                        expression: expression,
                        returnByValue: true,
                        awaitPromise: awaitPromise
                    }
                }));
            };

            ws.onmessage = (e) => {
                clearTimeout(timer);
                try {
                    const res = JSON.parse(e.data);
                    resolve(res.result?.result?.value);
                } catch(err) {
                    resolve(null);
                } finally {
                    try { ws.close(); } catch(e) {}
                }
            };

            ws.onerror = () => {
                clearTimeout(timer);
                resolve(null);
            };
        } catch(err) {
            if (timer) clearTimeout(timer);
            resolve(null);
        }
    });
}

async function createTab(cdpHost = DEFAULT_CDP_HOST) {
    const res = await fetch(`${cdpHost}/json/new?https://chatgpt.com/`, { method: 'PUT' }).then(r => r.json());
    // Activate the tab
    await fetch(`${cdpHost}/json/activate/${res.id}`).catch(() => {});
    return res;
}

async function closeTab(cdpHost = DEFAULT_CDP_HOST, targetId) {
    try {
        await fetch(`${cdpHost}/json/close/${targetId}`);
    } catch(e) {}
}

/**
 * Execute staggered dispatch across multiple tabs with real-time lifecycle progress hooks.
 * Lifecycle stages: QUEUED -> DISPATCHED -> COMPOSING -> THINKING -> STREAMING -> SHADOW_VERIFIED -> COMPLETED / FAILED
 *
 * @param {Object} [options={}]
 * @param {string} [options.cdpHost]
 * @param {number} [options.staggerIntervalMs=5000]
 * @param {Array} [options.questions=QUESTIONS]
 * @param {boolean} [options.syncCookies=false]
 * @param {number} [options.maxRounds=100]
 * @param {string} [options.outputFile]
 * @param {boolean} [options.persistLedger=true]
 * @param {Function} [onProgress=null] Callback: ({ taskId, stage, chars, tokens, duration, error, searches, url, title }) => void
 * @returns {Promise<Array>} Results array
 */
async function runStaggeredDispatch(options = {}, onProgress = null) {
    const progressCb = onProgress || options.onProgress || null;
    const cdpHost = options.cdpHost || DEFAULT_CDP_HOST;
    const staggerIntervalMs = options.staggerIntervalMs !== undefined ? options.staggerIntervalMs : STAGGER_INTERVAL_MS;
    const questions = options.questions || options.tasks || QUESTIONS;
    const maxRounds = options.maxRounds || 100;
    const outputFile = options.outputFile || getDefaultOutputFile();
    const persistLedger = options.persistLedger !== false;

    function notifyProgress(data) {
        if (typeof progressCb === 'function') {
            try {
                progressCb(data);
            } catch (err) {
                console.warn('[runStaggeredDispatch] onProgress hook error:', err.message);
            }
        }
    }

    if (options.syncCookies) {
        const seedPort = 9225;
        const targetPort = parseInt(new URL(cdpHost).port, 10) || 9222;
        console.log(`[Cookie Sync] Synchronizing cookies from Master Seed (${seedPort}) to Worker (${targetPort})...`);
        try {
            const cookies = await dumpCookiesFromBrowserTarget(seedPort, 3000);
            await injectCookiesToWorker(targetPort, cookies, 3000);
            console.log(`[Cookie Sync] Successfully synced ${cookies.length} cookies into Worker.`);
        } catch (err) {
            console.warn(`[Cookie Sync] Warning: Cookie sync failed: ${err.message}. Proceeding with existing session.`);
        }
    }

    const tasks = questions.map((q, index) => ({
        id: q.id !== undefined ? q.id : index + 1,
        title: q.title || `Task ${index + 1}`,
        prompt: q.prompt || '',
        targetId: null,
        wsUrl: null,
        dispatchedAt: null,
        completedAt: null,
        status: 'pending', // pending, generating, done, error
        stage: 'QUEUED',
        chars: 0,
        tokens: 0,
        durationSec: 0,
        text: '',
        searches: [],
        conversationUrl: null,
        error: null,
    }));

    // Initialize all tasks in QUEUED state
    for (const task of tasks) {
        notifyProgress({
            taskId: task.id,
            stage: 'QUEUED',
            chars: 0,
            tokens: 0,
            duration: 0,
            error: null,
            searches: [],
            url: null,
            title: task.title,
        });
    }

    const globalStart = Date.now();

    // 1. 依次派遣任务，每个间隔 staggerIntervalMs 秒
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const elapsed = Math.round((Date.now() - globalStart) / 1000);
        task.stage = 'DISPATCHED';
        notifyProgress({
            taskId: task.id,
            stage: 'DISPATCHED',
            chars: 0,
            tokens: 0,
            duration: elapsed,
            error: null,
            searches: [],
            url: null,
            title: task.title,
        });
        console.log(`\n[T+${elapsed}s] 🚀 [派遣 ${task.id}/${tasks.length}] 正在派发任务: ${task.title}`);

        try {
            // 创建独立 Tab
            const tab = await createTab(cdpHost);
            task.targetId = tab.id;
            task.wsUrl = tab.webSocketDebuggerUrl;

            task.stage = 'COMPOSING';
            notifyProgress({
                taskId: task.id,
                stage: 'COMPOSING',
                chars: 0,
                tokens: 0,
                duration: Math.round((Date.now() - globalStart) / 1000),
                error: null,
                searches: [],
                url: null,
                title: task.title,
            });

            // 等待页面挂载 (2.5秒)
            await sleep(2500);

            // 注入 Prompt 并触发发送
            const escapedPrompt = JSON.stringify(task.prompt);
            const dispatchScript = `
                (async () => {
                    const el = document.querySelector('#prompt-textarea');
                    if (!el) return { success: false, error: 'no textarea' };
                    el.focus();
                    el.innerHTML = '<p>' + ${escapedPrompt} + '</p>';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    let clicked = false;
                    for (let a = 0; a < 15; a++) {
                        await new Promise(r => setTimeout(r, 200));
                        const btn = document.querySelector('button[data-testid="send-button"]') || 
                                    document.querySelector('[data-testid="send-button"]');
                        if (btn && !btn.disabled) {
                            btn.click();
                            clicked = true;
                            break;
                        }
                    }

                    // 再等待一小会确认 stop-button 出现或者 URL 改变
                    await new Promise(r => setTimeout(r, 500));
                    const isStreaming = !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"]');
                    const url = window.location.href;

                    return { success: clicked || isStreaming, url, isStreaming };
                })()
            `;

            const dispatchRes = await evalOnTab(task.wsUrl, dispatchScript, 10000, true);
            if (dispatchRes?.success) {
                task.status = 'generating';
                task.stage = 'THINKING';
                task.dispatchedAt = Date.now();
                notifyProgress({
                    taskId: task.id,
                    stage: 'THINKING',
                    chars: 0,
                    tokens: 0,
                    duration: 0,
                    error: null,
                    searches: [],
                    url: dispatchRes.url || null,
                    title: task.title,
                });
                console.log(`   ✅ 任务 ${task.id} 发送成功! 进入思考生成状态 (Tab: ${task.targetId.slice(0, 8)}...)`);
            } else {
                console.warn(`   ⚠️ 任务 ${task.id} 首次点击未生效，正在重试...`, dispatchRes);
                await sleep(1000);
                const retryRes = await evalOnTab(task.wsUrl, dispatchScript, 10000, true);
                task.status = 'generating';
                task.stage = 'THINKING';
                task.dispatchedAt = Date.now();
                notifyProgress({
                    taskId: task.id,
                    stage: 'THINKING',
                    chars: 0,
                    tokens: 0,
                    duration: 0,
                    error: null,
                    searches: [],
                    url: retryRes?.url || null,
                    title: task.title,
                });
                console.log(`   ✅ 任务 ${task.id} 重试发送完成 (Tab: ${task.targetId.slice(0, 8)}...)`);
            }
        } catch (err) {
            console.error(`   ❌ 任务 ${task.id} 派遣异常:`, err.message);
            task.status = 'error';
            task.stage = 'FAILED';
            task.error = err.message;
            notifyProgress({
                taskId: task.id,
                stage: 'FAILED',
                chars: 0,
                tokens: 0,
                duration: Math.round((Date.now() - globalStart) / 1000),
                error: err.message,
                searches: [],
                url: null,
                title: task.title,
            });
        }

        // 如果不是最后一个任务，严格间隔错峰时间
        if (i < tasks.length - 1) {
            console.log(`   ⏳ 等待 ${staggerIntervalMs / 1000} 秒安全间隔 (防行为风控)...`);
            await sleep(staggerIntervalMs);
        }
    }

    console.log('\n================================================================');
    console.log(`🏁 全部 ${tasks.length} 个任务已按错峰间隔完成派遣！开始实时监控生成进度...`);
    console.log('================================================================\n');

    // 2. 轮询监控所有任务生成进度
    const monitorScript = `
        (() => {
            const stopBtn = !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"]');
            const turn = document.querySelector('[data-message-author-role="assistant"]');
            const userTurn = document.querySelector('[data-message-author-role="user"]');
            const main = document.querySelector('main');
            
            let text = '';
            if (turn) {
                text = turn.innerText;
            } else if (main) {
                const full = main.innerText;
                const userText = userTurn ? userTurn.innerText : '';
                text = userText ? full.replace(userText, '').trim() : full;
            }

            const searches = Array.from(document.querySelectorAll('[data-testid*="search"], [aria-label*="Search"], [aria-label*="search"]'))
                .map(e => e.innerText || e.getAttribute('aria-label'))
                .filter(s => s && s.includes('Search'));
            
            return {
                isStreaming: stopBtn,
                textLength: text.length,
                text: text,
                searches: searches,
                url: window.location.href,
                pageTitle: document.title
            };
        })()
    `;

    let checkRound = 0;

    while (checkRound < maxRounds) {
        checkRound++;
        await sleep(5000);

        const activeTasks = tasks.filter(t => t.status === 'generating');
        const doneTasks = tasks.filter(t => t.status === 'done');
        const elapsed = Math.round((Date.now() - globalStart) / 1000);

        console.log(`[T+${elapsed}s | 轮次 ${checkRound}] 状态统计: 正在生成 ${activeTasks.length} | 已完成 ${doneTasks.length} | 错误 ${tasks.filter(t => t.status === 'error').length}`);

        if (activeTasks.length === 0) {
            console.log('🎉 所有任务均已完成！');
            break;
        }

        for (const task of activeTasks) {
            try {
                const info = await evalOnTab(task.wsUrl, monitorScript, 4000);
                if (!info) continue;

                if (info.searches && info.searches.length > 0) {
                    task.searches = info.searches;
                }
                if (info.url && info.url.includes('/c/')) {
                    task.conversationUrl = info.url;
                }

                const currentChars = info.textLength || 0;
                const currentTokens = estimateTextTokens(info.text || '');
                const currentDuration = task.dispatchedAt ? Math.round((Date.now() - task.dispatchedAt) / 1000) : 0;
                task.chars = currentChars;
                task.tokens = currentTokens;

                // 判定是否完成：停止按钮消失，且已有可观回复内容 (>150字)
                const isFinished = (!info.isStreaming && info.textLength > 150);
                
                if (isFinished) {
                    task.stage = 'SHADOW_VERIFIED';
                    task.text = info.text;
                    task.completedAt = Date.now();
                    task.durationSec = Math.round((task.completedAt - task.dispatchedAt) / 1000);

                    notifyProgress({
                        taskId: task.id,
                        stage: 'SHADOW_VERIFIED',
                        chars: task.text.length,
                        tokens: estimateTextTokens(task.text),
                        duration: task.durationSec,
                        error: null,
                        searches: task.searches,
                        url: task.conversationUrl,
                        title: task.title,
                    });

                    // 立即关闭对应 Tab 释放内存！
                    await closeTab(cdpHost, task.targetId);
                    task.status = 'done';
                    task.stage = 'COMPLETED';

                    // 生成详细账单并归档 Ledger
                    const bill = generateTokenBill({
                        promptText: task.prompt,
                        responseText: task.text,
                        thinkSeconds: task.durationSec,
                        effort: 'high',
                        model: 'o3-mini',
                        taskId: task.id,
                    });
                    task.tokenBill = bill;

                    if (persistLedger) {
                        try {
                            appendTokenLedger(bill);
                        } catch (e) {
                            // Ledger append error ignored in test or dry run
                        }
                    }

                    notifyProgress({
                        taskId: task.id,
                        stage: 'COMPLETED',
                        chars: task.text.length,
                        tokens: bill.totalTokens,
                        duration: task.durationSec,
                        error: null,
                        searches: task.searches,
                        url: task.conversationUrl,
                        title: task.title,
                        bill: bill,
                    });

                    console.log(`   ✨ [任务 ${task.id} 完成!] ${task.title} (耗时: ${task.durationSec}s, 字数: ${info.textLength}, 预估Tokens: ${bill.totalTokens})`);
                    console.log(`   🧹 Tab ${task.targetId.slice(0, 8)}... 已关闭，内存已释放。`);
                } else if (info.isStreaming || currentChars > 0) {
                    task.stage = 'STREAMING';
                    notifyProgress({
                        taskId: task.id,
                        stage: 'STREAMING',
                        chars: currentChars,
                        tokens: currentTokens,
                        duration: currentDuration,
                        error: null,
                        searches: info.searches || [],
                        url: task.conversationUrl,
                        title: task.title,
                    });
                    const searchStatus = info.searches.length > 0 ? `[${info.searches[info.searches.length - 1]}]` : '[推理生成中]';
                    console.log(`   ⏳ 任务 ${task.id}: ${searchStatus} 当前字数: ${info.textLength}`);
                }
            } catch (err) {
                // Ignore transient network errors
            }
        }
    }

    // 针对超时未完成的任务标记为 FAILED
    for (const task of tasks) {
        if (task.status === 'generating') {
            task.status = 'error';
            task.stage = 'FAILED';
            task.error = 'Timeout waiting for task completion';
            notifyProgress({
                taskId: task.id,
                stage: 'FAILED',
                chars: task.chars,
                tokens: task.tokens,
                duration: task.dispatchedAt ? Math.round((Date.now() - task.dispatchedAt) / 1000) : 0,
                error: task.error,
                searches: task.searches,
                url: task.conversationUrl,
                title: task.title,
            });
            if (task.targetId) {
                await closeTab(cdpHost, task.targetId);
            }
        }
    }

    // 3. 统计汇总并保存数据
    console.log('\n================================================================');
    console.log(`📊 执行总结报告 (${tasks.length} 路并发 CDP 调度)`);
    console.log('================================================================');

    const summary = tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        stage: t.stage,
        durationSec: t.durationSec,
        textLength: t.text?.length || 0,
        tokens: t.tokenBill?.totalTokens || t.tokens || 0,
        searches: t.searches
    }));

    console.table(summary);

    try {
        fs.writeFileSync(outputFile, JSON.stringify(tasks, null, 2), 'utf-8');
        console.log(`\n💾 全部 ${tasks.length} 份原始深度回答与分析结果已保存至: ${outputFile}`);
    } catch (err) {
        console.warn(`[runStaggeredDispatch] Failed to save output to ${outputFile}: ${err.message}`);
    }

    return tasks;
}

async function main() {
    console.log('================================================================');
    console.log('🚀 启动 10 路并发 ChatGPT 深度联网搜索调度管道 (CDP 宿主原生)');
    console.log(`⏱️ 调度策略: 严格每 5 秒错峰派遣 1 个任务 (总调度窗口 45 秒)`);
    console.log(`🎯 目标集群: ${DEFAULT_CDP_HOST}`);
    console.log('================================================================\n');

    const syncCookies = process.argv.includes('--sync-cookies');
    await runStaggeredDispatch({ syncCookies });
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal execution error:', err);
    });
}

module.exports = {
    runStaggeredDispatch,
    QUESTIONS,
    createTab,
    closeTab,
    evalOnTab,
};
