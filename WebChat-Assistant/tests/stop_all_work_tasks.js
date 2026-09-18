const { CdpClient, fetchJson, getBrowserWsUrl } = require('../lib/cdp-client');
const { STOP_BUTTON_SELECTORS } = require('../lib/surface-manager');

async function stopAll() {
    console.log('=== 扫描并强制终止所有活跃任务与 Worker 上的 Work 状态 ===');
    
    // 检查 9222
    try {
        const list = await fetchJson('http://127.0.0.1:9222/json/list');
        const pages = list.filter(p => p.url.startsWith('https://chatgpt.com') && p.type === 'page');
        for (const p of pages) {
            try {
                const c = new CdpClient(p.webSocketDebuggerUrl);
                await c.connect();
                const res = await c.evaluate(`
                    (() => {
                        const stopSelectors = ${JSON.stringify(STOP_BUTTON_SELECTORS)};
                        for (const s of stopSelectors) {
                            const btn = document.querySelector(s);
                            if (btn) {
                                btn.click();
                                return { stopped: true, selector: s };
                            }
                        }
                        return { stopped: false };
                    })()
                `);
                console.log(`Tab [${p.title || p.id}]:`, res);
                c.close();
            } catch (err) {
                console.log(`Tab [${p.id}] check error:`, err.message);
            }
        }
    } catch (e) {
        console.log('Worker 9222 is not reachable:', e.message);
    }

    // 检查 9223
    try {
        const list2 = await fetchJson('http://127.0.0.1:9223/json/list');
        const pages2 = list2.filter(p => p.url.startsWith('https://chatgpt.com') && p.type === 'page');
        for (const p of pages2) {
            try {
                const c = new CdpClient(p.webSocketDebuggerUrl);
                await c.connect();
                const res = await c.evaluate(`
                    (() => {
                        const stopSelectors = ${JSON.stringify(STOP_BUTTON_SELECTORS)};
                        for (const s of stopSelectors) {
                            const btn = document.querySelector(s);
                            if (btn) {
                                btn.click();
                                return { stopped: true, selector: s };
                            }
                        }
                        return { stopped: false };
                    })()
                `);
                console.log(`Worker2 Tab [${p.title || p.id}]:`, res);
                c.close();
            } catch (err) {
                console.log(`Worker2 Tab [${p.id}] check error:`, err.message);
            }
        }
    } catch (e) {
        // 9223 not running, ignore
    }

    console.log('✅ 所有活跃 Tab 的 Stop 按钮与生成状态已完成扫描与物理强停！');
}

stopAll().catch(console.error);
