const path = require('path');
const fs = require('fs');
const { CdpClient, fetchJson } = require('../lib/cdp-client');

async function testFileInputProbe() {
    console.log('=== Plan B 探针测试：探测 CDP DOM.setFileInputFiles 交互响应 ===');
    
    // 1. 创建测试文件
    const testFilePath = path.resolve('C:\\GPT-Chat-codex-handoff\\runs\\test_upload_probe.md');
    fs.writeFileSync(testFilePath, '# WebChat-Assistant Architecture Probe\n\nThis is a physical file upload probe test.\nCore advantage: Native CDP Master-Worker Dual-Tier Sandbox.\n', 'utf-8');
    console.log(`1. 测试物理文件就绪: ${testFilePath} (${fs.statSync(testFilePath).size} bytes)`);

    // 2. 连接现有或创建新 ChatGPT Tab
    const workerPort = 9222;
    const browserInfo = await fetchJson(`http://127.0.0.1:${workerPort}/json/version`);
    const browser = new CdpClient(browserInfo.webSocketDebuggerUrl);
    await browser.connect();

    console.log('2. 正在创建全新 ChatGPT 测试 Tab...');
    const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetId = createRes.targetId;
    console.log(`   Target 创建成功: ${targetId}`);

    const client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
    await client.connect();

    try {
        console.log('3. 等待页面加载与输入框就绪...');
        let ready = false;
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 600));
            ready = await client.evaluate(`
                !!(document.querySelector('#prompt-textarea') && document.querySelector('#upload-files'))
            `);
            if (ready) break;
        }

        if (!ready) {
            console.error('❌ 等待超时：页面未能加载 #prompt-textarea 或 #upload-files');
            return;
        }
        console.log('✅ 页面与文件上传 input[type=file]#upload-files 已确认就绪！');

        // 4. 调用 CDP DOM 域查找 nodeId 并注入文件
        await client.send('DOM.enable');
        const doc = await client.send('DOM.getDocument', { depth: -1 });
        const queryRes = await client.send('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: '#upload-files'
        });

        console.log(`4. 获取 #upload-files nodeId: ${queryRes.nodeId}`);
        if (!queryRes.nodeId) {
            throw new Error('未能通过 DOM.querySelector 获取 #upload-files 的 nodeId');
        }

        console.log(`5. 执行 CDP DOM.setFileInputFiles...`);
        await client.send('DOM.setFileInputFiles', {
            files: [testFilePath],
            nodeId: queryRes.nodeId
        });
        console.log('✅ DOM.setFileInputFiles 发送完成！');

        // 6. 观察 ChatGPT UI DOM 变化 (是否出现附件卡片/进度条)
        console.log('6. 轮询检测 ChatGPT 页面是否捕获并渲染附件卡片...');
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const attachmentStatus = await client.evaluate(`
                (() => {
                    const cards = Array.from(document.querySelectorAll('[data-testid*="attachment"], [class*="attachment"], [class*="file"], div[role="progressbar"]')).map(el => ({
                        tag: el.tagName,
                        text: el.innerText ? el.innerText.trim().slice(0, 100) : '',
                        testid: el.getAttribute('data-testid'),
                        className: el.className
                    }));

                    const composerText = document.querySelector('#prompt-textarea') ? document.querySelector('#prompt-textarea').innerText : '';
                    const sendBtn = document.querySelector('button[data-testid="send-button"]');

                    return {
                        foundCardsCount: cards.length,
                        cards: cards.filter(c => c.text.includes('test_upload_probe') || (c.testid && c.testid.includes('attachment'))),
                        sendBtnDisabled: sendBtn ? sendBtn.disabled : null
                    };
                })()
            `);

            console.log(`   [${i+1}s] 附件探测结果:`, JSON.stringify(attachmentStatus));
            if (attachmentStatus.cards && attachmentStatus.cards.length > 0) {
                console.log('🎉 成功捕获到页面渲染的附件卡片！');
                break;
            }
        }

    } finally {
        console.log('7. 清理测试 Tab...');
        try {
            await browser.send('Target.closeTarget', { targetId });
        } catch (_) {}
        client.close();
        browser.close();
        console.log('=== 探针测试结束 ===');
    }
}

testFileInputProbe().catch(console.error);
