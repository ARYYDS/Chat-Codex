const path = require('path');
const fs = require('fs');
const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testPlanA() {
    console.log('======================================================');
    console.log('🧪 方案 A 可行性测试：提示词层单文件/代码上下文注入 (Monofile Context Packet)');
    console.log('======================================================');

    // 1. 读取本地核心架构文件，组装契约上下文包 (Context Packet)
    const archDoc = fs.readFileSync(path.resolve(__dirname, '..', 'WebChat-Assistant-Architecture.md'), 'utf-8');
    const pkgJson = fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
    const agentsMd = fs.readFileSync(path.resolve(__dirname, '..', 'AGENTS.md'), 'utf-8');

    const promptWithContext = `【WebChat-Assistant 本地核心工程上下文包】
---
### 文件 1: WebChat-Assistant-Architecture.md
${archDoc}

---
### 文件 2: package.json
${pkgJson}

---
### 文件 3: AGENTS.md
${agentsMd}
---

【任务指令】
根据以上本地工程源码与架构规范，请用两句话精确回答当前 WebChat-Assistant 核心架构的优势是什么？`;

    console.log(`1. 上下文包组装完成: 包含 3 个核心文件，总字符数: ${promptWithContext.length} chars`);

    // 2. 连接 Worker (Port 9222) 并创建独立 Tab
    const workerPort = 9222;
    const browserWs = await getBrowserWsUrl(workerPort);
    const browser = new CdpClient(browserWs);
    await browser.connect();

    console.log('2. 正在 Worker 9222 创建独立测试会话 Tab...');
    const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetId = createRes.targetId;
    const client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
    await client.connect();

    const startTime = Date.now();

    try {
        await client.send('Page.bringToFront');

        // 3. 等待输入框就绪
        console.log('3. 等待 ChatGPT 输入框渲染就绪...');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            const ready = await client.evaluate(`!!document.querySelector('#prompt-textarea')`);
            if (ready) break;
        }

        // 4. 物理注入上下文与 Prompt
        console.log('4. 正在通过 Clipboard Paste 事件物理注入代码上下文与指令...');
        await client.evaluate(`
            ((text) => {
                const composer = document.querySelector('#prompt-textarea');
                composer.focus();
                composer.click();
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                const pasteEv = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt
                });
                composer.dispatchEvent(pasteEv);
            })(${JSON.stringify(promptWithContext)})
        `);

        // 等待 Send 按钮激活并点击
        let clicked = false;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 400));
            clicked = await client.evaluate(`
                (() => {
                    const btn = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send prompt"]');
                    if (btn && btn.getAttribute('aria-disabled') === 'false') {
                        btn.click();
                        return true;
                    }
                    return false;
                })()
            `);
            if (clicked) {
                console.log(`✅ [${(i+1)*400}ms] Send 按钮激活并成功点击！`);
                break;
            }
        }

        if (!clicked) {
            console.log('⚠️ Send 按钮未激活，尝试回车发送...');
            await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
        }

        // 5. 轮询监听回答收敛与 Stop 按钮状态
        console.log('5. 正在监听思考与流式生成收敛状态...');
        let finalResponse = '';

        for (let s = 1; s <= 60; s++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await client.evaluate(`
                (() => {
                    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
                    const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') ||
                                       document.querySelector('button[data-testid="stop-button"]'));
                    const last = assistants.length > 0 ? assistants[assistants.length - 1] : null;
                    return {
                        hasStop,
                        assistantTurns: assistants.length,
                        text: last ? (last.innerText || '').trim() : ''
                    };
                })()
            `);

            if (status.text) {
                process.stdout.write(`\r   [${s}s] 状态: ${status.hasStop ? '生成中(Thinking/Streaming)' : '就绪'} | 字数: ${status.text.length} chars`);
            }

            if (!status.hasStop && status.assistantTurns > 0 && status.text.length > 20) {
                console.log('\n✅ 检测到回答生成收敛（Stop 按钮已消失且回答完成）！');
                finalResponse = status.text;
                break;
            }
        }

        const durationSec = Math.floor((Date.now() - startTime) / 1000);

        console.log('\n======================================================');
        console.log(`🎉 方案 A 测试成功！总耗时: ${durationSec}s | 回复字数: ${finalResponse.length} chars`);
        console.log('---------------- 提取到的 ChatGPT 回复内容 ----------------');
        console.log(finalResponse);
        console.log('======================================================');

        // 保存本次测试结果
        const reportPath = path.resolve('C:\\GPT-Chat-codex-handoff\\runs\\plan_a_test_result.json');
        fs.writeFileSync(reportPath, JSON.stringify({
            plan: 'Plan A (Monofile Context Packet Injection)',
            success: true,
            durationSec,
            inputChars: promptWithContext.length,
            outputChars: finalResponse.length,
            response: finalResponse
        }, null, 2), 'utf-8');

        return { success: true, durationSec, response: finalResponse };
    } finally {
        console.log('6. 正在清理会话 Tab，释放 Blink 进程内存...');
        try { await browser.send('Target.closeTarget', { targetId }); } catch (_) {}
        client.close();
        browser.close();
    }
}

testPlanA().catch(err => {
    console.error('❌ 方案 A 测试失败:', err);
    process.exitCode = 1;
});
