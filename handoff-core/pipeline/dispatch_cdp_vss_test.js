const fs = require('fs');
const path = require('path');

const CDP_PORT = loadConfig().cdpPorts[0]; // 刚拉起的新子端端口
const CDP_HOST = `http://127.0.0.1:${CDP_PORT}`;
const { runOutput, loadConfig } = require('../lib/runtime-config');
const OUTPUT_FILE = runOutput('results_cdp_vss_5queries.json');

const QUESTIONS = [
    {
        id: 1,
        title: "VSS 热克隆与 SQLite 独占锁穿透机制",
        prompt: "请联网搜索并深入分析：在 Windows 生产环境下，基于 Windows 卷影复制服务 (VSS / Volume Shadow Copy) 对运行中的 Chromium 浏览器 Profile 进行无感热克隆（Hot-Cloning）的技术机制与边界。重点分析：VSS 快照如何绕过 SQLite 对 Cookies 与 Local Storage 的独占文件排他锁？如何通过白名单过滤（剔除 Cache、GPUCache、Crashpad、*.lock）将克隆体积从 500MB+ 压缩至 15MB 极简胶囊？相比停机冷备份与内存 Hook，VSS 热克隆有哪些性能与稳定性优势？"
    },
    {
        id: 2,
        title: "CDP 宿主集群并发调度与 Ephemeral Tab 内存回收模型",
        prompt: "请联网搜索并深入分析：现代 Chromium DevTools Protocol (CDP) 在高并发会话调度中的最佳实践架构。重点分析：为什么单 Browser 实例内通过 CDP HTTP 原语（PUT /json/new、POST /json/activate、GET /json/close）动态开闭短生命周期页签（Ephemeral Tabs）相比多开完整独立 Chrome 窗口能大幅压降物理内存（WorkingSet 从数 GB 压至 ~84MB）？如何设计事件监听与超时监控以防 Renderer 进程僵死或内存泄漏？"
    },
    {
        id: 3,
        title: "VSS 克隆 Profile 在 CDP 环境下的指纹纯净度与反爬 WAF 存活率",
        prompt: "请联网搜索并深入分析：通过 VSS 卷影从真实母本（Master Seed）克隆出的轻量级 Chromium Profile，在经由 CDP 协议（剥离 --enable-automation）驱动时，在 Cloudflare Turnstile、OpenAI Sentinel 及现代 WAF 系统下的反检测与存活率表现。重点分析：为什么这种方案能够 100% 继承真实宿主的 TLS 1.3 JA4 指纹、HTTP/2 SETTINGS 帧序列、以及 Canvas/WebGL 硬件渲染特征？相比 Puppeteer-Extra-Stealth 等 JS 补丁注入方案，为什么它不会产生原型链污染与指纹断层？"
    },
    {
        id: 4,
        title: "Windows 凭据保护演进：DPAPI v10 vs App-Bound Encryption v20 与 VSS 克隆的配合",
        prompt: "请联网搜索并深入分析：Chrome 127+ 引入的 Windows App-Bound Encryption (v20 保护机制) 对自动化浏览器凭据持久化的影响，以及结合 VSS 热克隆的应对方案。重点分析：为什么默认 %LOCALAPPDATA% 目录下的 Cookie 无法直接跨环境解密？为什么通过显式 --user-data-dir 启动母本能触发 Chromium 降级回退至 Windows 原生 DPAPI (v10 保护)？在同用户权限下，VSS 提取的 Local State 与 Cookies 数据库是如何实现即插即用、免重新登录的？"
    },
    {
        id: 5,
        title: "生产级架构：基于 VSS 动态快照与 CDP 多端口池的分布式 Agent 伸缩范式",
        prompt: "请联网搜索并深入分析：构建企业级 AI 自动化集群时，基于「VSS 纯净母本快照 + CDP 多端口工作池（9222/9223/9224...）+ 随机抖动错峰调度」的系统伸缩架构设计。重点分析：如何实现母本只读防写锁、子实例无状态按需创建与自动销毁？在持续高并发任务流下，如何结合动态间隔抖动（如 10s + 1~10s 随机波动）防范边缘 API 的突发突增限流（Burst Rate Limiting）？"
    }
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 动态计算 10s + (1~10s 随机波动)
function getRandomStaggerDelayMs() {
    // 10s 基础 + 1000ms ~ 10000ms 随机浮动
    const jitterMs = Math.floor(Math.random() * 9000) + 1000;
    return 10000 + jitterMs;
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

async function createTab() {
    const res = await fetch(`${CDP_HOST}/json/new?https://chatgpt.com/`, { method: 'PUT' }).then(r => r.json());
    // 强制激活页签防止后台挂起
    await fetch(`${CDP_HOST}/json/activate/${res.id}`).catch(() => {});
    return res;
}

async function closeTab(targetId) {
    try {
        await fetch(`${CDP_HOST}/json/close/${targetId}`);
    } catch(e) {}
}

async function main() {
    console.log('================================================================');
    console.log('🚀 启动新子端 (Port 9225) CDP + VSS 专题 5 路检索调度测试');
    console.log(`⏱️ 调度策略: 10s 基础步长 + [1s ~ 10s] 动态随机抖动`);
    console.log(`🎯 目标集群: ${CDP_HOST}`);
    console.log('================================================================\n');

    const tasks = QUESTIONS.map(q => ({
        ...q,
        targetId: null,
        wsUrl: null,
        dispatchedAt: null,
        completedAt: null,
        status: 'pending',
        text: '',
        searches: [],
        durationSec: 0,
        jitterDelayMs: 0
    }));

    const globalStart = Date.now();

    // 1. 依次派遣 5 个任务，使用 10s + 1~10s 随机波动错峰
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const elapsed = Math.round((Date.now() - globalStart) / 1000);
        console.log(`\n[T+${elapsed}s] 🚀 [派遣 ${task.id}/5] 正在派发任务: ${task.title}`);

        try {
            // 创建独立 Tab
            const tab = await createTab();
            task.targetId = tab.id;
            task.wsUrl = tab.webSocketDebuggerUrl;

            // 等待页面水合挂载 (2.5秒)
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

                    await new Promise(r => setTimeout(r, 500));
                    const isStreaming = !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"]');
                    const url = window.location.href;

                    return { success: clicked || isStreaming, url, isStreaming };
                })()
            `;

            const dispatchRes = await evalOnTab(task.wsUrl, dispatchScript, 10000, true);
            if (dispatchRes?.success) {
                task.status = 'generating';
                task.dispatchedAt = Date.now();
                console.log(`   ✅ 任务 ${task.id} 发送成功! 进入生成状态 (Tab: ${task.targetId.slice(0, 8)}...)`);
            } else {
                console.warn(`   ⚠️ 任务 ${task.id} 首次点击未生效，正在重试...`, dispatchRes);
                await sleep(1000);
                const retryRes = await evalOnTab(task.wsUrl, dispatchScript, 10000, true);
                task.status = 'generating';
                task.dispatchedAt = Date.now();
                console.log(`   ✅ 任务 ${task.id} 重试发送完成 (Tab: ${task.targetId.slice(0, 8)}...)`);
            }
        } catch (err) {
            console.error(`   ❌ 任务 ${task.id} 派遣异常:`, err.message);
            task.status = 'error';
        }

        // 如果不是最后一个任务，动态计算 10s + 1~10s 的随机波动等待
        if (i < tasks.length - 1) {
            const delayMs = getRandomStaggerDelayMs();
            task.nextIntervalSec = Math.round(delayMs / 1000 * 10) / 10;
            const jitterPart = Math.round((delayMs - 10000) / 1000 * 10) / 10;
            console.log(`   🎲 [动态随机抖动] 下一个问题将在 ${task.nextIntervalSec} 秒后发起 (10s 基础 + ${jitterPart}s 随机扰动)...`);
            await sleep(delayMs);
        }
    }

    console.log('\n================================================================');
    console.log('🏁 全部 5 个任务已按随机抖动错峰派遣完成！开始实时监控生成进度...');
    console.log('================================================================\n');

    // 2. 轮询监控生成状态
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
    const maxRounds = 80;

    while (checkRound < maxRounds) {
        checkRound++;
        await sleep(5000);

        const activeTasks = tasks.filter(t => t.status === 'generating');
        const doneTasks = tasks.filter(t => t.status === 'done');
        const elapsed = Math.round((Date.now() - globalStart) / 1000);

        console.log(`[T+${elapsed}s | 轮次 ${checkRound}] 状态: 生成中 ${activeTasks.length} | 已完成 ${doneTasks.length} | 异常 ${tasks.filter(t => t.status === 'error').length}`);

        if (activeTasks.length === 0) {
            console.log('🎉 全部 5 个 CDP + VSS 专题任务均已生成完成！');
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

                // 完成条件：Stop 按钮消失且文本长度大于 150
                const isFinished = (!info.isStreaming && info.textLength > 150);
                
                if (isFinished) {
                    task.status = 'done';
                    task.completedAt = Date.now();
                    task.durationSec = Math.round((task.completedAt - task.dispatchedAt) / 1000);
                    task.text = info.text;
                    console.log(`   ✨ [任务 ${task.id} 完成!] ${task.title} (耗时: ${task.durationSec}s, 字数: ${info.textLength})`);

                    // 立即销毁 Tab 释放物理内存
                    await closeTab(task.targetId);
                    console.log(`   🧹 Tab ${task.targetId.slice(0, 8)}... 已关闭，内存即刻释放。`);
                } else if (info.isStreaming) {
                    const searchStatus = info.searches.length > 0 ? `[${info.searches[info.searches.length - 1]}]` : '[深度推理中]';
                    console.log(`   ⏳ 任务 ${task.id}: ${searchStatus} 当前生成字数: ${info.textLength}`);
                }
            } catch (err) {
                // Ignore transient network errors
            }
        }
    }

    // 3. 统计汇总并输出大盘
    console.log('\n================================================================');
    console.log('📊 CDP + VSS 专题测试大盘 (新子端 Port 9225)');
    console.log('================================================================');

    const summary = tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        durationSec: t.durationSec,
        textLength: t.text?.length || 0,
        nextIntervalSec: t.nextIntervalSec || 'N/A'
    }));

    console.table(summary);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
    console.log(`\n💾 原始测试结果集已保存至: ${OUTPUT_FILE}`);
}

main().catch(err => {
    console.error('Fatal execution error:', err);
});
