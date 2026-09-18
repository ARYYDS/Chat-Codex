const path = require('path');
const fs = require('fs');
const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testPasteContextAndSend() {
    console.log('=== 测试：通过 DataTransfer Paste 注入 3902 字符完整上下文包 ===');

    const archDoc = fs.readFileSync(path.resolve(__dirname, '..', 'WebChat-Assistant-Architecture.md'), 'utf-8');
    const pkgJson = fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
    const agentsMd = fs.readFileSync(path.resolve(__dirname, '..', 'AGENTS.md'), 'utf-8');

    const promptWithContext = `【WebChat-Assistant 本地工程上下文包】
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

    console.log(`包大小: ${promptWithContext.length} 字符`);

    const ws = await getBrowserWsUrl(9222);
    const b = new CdpClient(ws);
    await b.connect();
    const { targetId } = await b.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const c = new CdpClient(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
    await c.connect();

    try {
        await c.send('Page.bringToFront');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            if (await c.evaluate(`!!document.querySelector('#prompt-textarea')`)) break;
        }

        console.log('1. 正在通过 Clipboard Paste 事件注入上下文...');
        const injectRes = await c.evaluate(`
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
                return {
                    length: composer.innerText.length,
                    first50: composer.innerText.slice(0, 50)
                };
            })(${JSON.stringify(promptWithContext)})
        `);
        console.log('注入结果:', injectRes);

        console.log('2. 等待 Send 按钮变为可点击并点击...');
        let clicked = false;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 400));
            clicked = await c.evaluate(`
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
                console.log(`✅ [${(i+1)*400}ms] Send 按钮已成功激活并点击！`);
                break;
            }
        }

        if (!clicked) {
            console.log('⚠️ Send 按钮未激活，尝试回车触发...');
            await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
            await c.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
        }

        console.log('3. 监听回答生成状态 (15秒)...');
        for (let s = 1; s <= 20; s++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await c.evaluate(`
                (() => {
                    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
                    const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') ||
                                       document.querySelector('button[data-testid="stop-button"]'));
                    const last = assistants.length > 0 ? assistants[assistants.length - 1] : null;
                    return {
                        url: window.location.href,
                        hasStop,
                        assistantTurns: assistants.length,
                        text: last ? last.innerText.slice(0, 150) : ''
                    };
                })()
            `);
            console.log(`[${s}s]:`, JSON.stringify(status));
            if (!status.hasStop && status.assistantTurns > 0 && status.text.length > 20) {
                console.log('🎉 回答完成！完整内容:');
                const fullText = await c.evaluate(`document.querySelectorAll('[data-message-author-role="assistant"]')[document.querySelectorAll('[data-message-author-role="assistant"]').length - 1].innerText`);
                console.log(fullText);
                break;
            }
        }

    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testPasteContextAndSend().catch(console.error);
