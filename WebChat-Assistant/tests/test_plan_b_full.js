const path = require('path');
const fs = require('fs');
const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');
const { uploadFileViaCdp, checkTurnConvergence, extractFullResponse } = require('../lib/surface-manager');

async function testPlanB() {
    console.log('======================================================');
    console.log('🧪 方案 B 可行性测试：CDP 原生协议物理文件上传 (Physical File Upload)');
    console.log('======================================================');

    // 1. 准备待上传的物理文件
    const uploadFilePath = path.resolve(__dirname, '..', 'WebChat-Assistant-Architecture.md');
    if (!fs.existsSync(uploadFilePath)) {
        throw new Error(`待上传文件不存在: ${uploadFilePath}`);
    }
    const fileSize = fs.statSync(uploadFilePath).size;
    console.log(`1. 待上传本地物理文件: ${uploadFilePath} (${fileSize} 字节)`);

    // 2. 连接 Worker (Port 9222) 并创建独立 Tab
    const workerPort = 9222;
    const browserWs = await getBrowserWsUrl(workerPort);
    const browser = new CdpClient(browserWs);
    await browser.connect();

    console.log('2. 正在 Worker 9222 创建独立会话 Tab...');
    const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetId = createRes.targetId;
    const client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
    await client.connect();

    const startTime = Date.now();

    try {
        await client.send('Page.bringToFront');

        // 3. 等待输入框与上传元素就绪
        console.log('3. 等待 ChatGPT 输入框与 #upload-files DOM 节点就绪...');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            const ready = await client.evaluate(`
                !!(document.querySelector('#prompt-textarea') && document.querySelector('#upload-files'))
            `);
            if (ready) break;
        }

        // 4. 调用 CDP 原生协议注入本地物理文件
        console.log('4. 正在通过 CDP DOM.setFileInputFiles 注入本地物理文件...');
        const uploadResult = await uploadFileViaCdp(client, uploadFilePath);
        console.log('✅ 物理文件注入完成:', uploadResult);

        // 5. 注入配套提问指令
        const accompanyingPrompt = "请仔细阅读我刚才上传的《WebChat-Assistant-Architecture.md》本地工程架构文件，请用两句话精确回答当前 WebChat-Assistant 核心架构的优势是什么？";
        console.log('5. 正在注入配套提问指令并触发发送...');

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
            })(${JSON.stringify(accompanyingPrompt)})
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
            console.log('⚠️ Send 按钮未在时限内激活，触发回车键发送...');
            await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
        }

        // 6. 轮询回答收敛与生成结果
        console.log('6. 正在监听思考与流式生成收敛状态...');
        let lastLen = 0;
        let unchangedMs = 0;
        let finalResponse = null;

        for (let round = 0; round < 60; round++) {
            await new Promise(r => setTimeout(r, 3000));
            const conv = await checkTurnConvergence(client, lastLen, unchangedMs);
            lastLen = conv.textLength;
            unchangedMs = conv.unchangedDurationMs;

            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            process.stdout.write(`\r   [${elapsed}s] 状态: ${conv.hasStop ? '生成中(Thinking/Streaming)' : '就绪'} | 字数: ${conv.textLength} chars`);

            if (conv.isSettled) {
                console.log('\n✅ 检测到回答生成收敛！');
                finalResponse = await extractFullResponse(client);
                break;
            }
        }

        const durationSec = Math.floor((Date.now() - startTime) / 1000);
        const responseText = finalResponse?.text || '';

        console.log('\n======================================================');
        console.log(`🎉 方案 B 测试成功！总耗时: ${durationSec}s | 回复字数: ${responseText.length} chars`);
        console.log('---------------- 提取到的 ChatGPT 回复内容 ----------------');
        console.log(responseText.trim());
        console.log('======================================================');

        // 保存本次测试结果
        const reportPath = path.resolve('C:\\GPT-Chat-codex-handoff\\runs\\plan_b_test_result.json');
        fs.writeFileSync(reportPath, JSON.stringify({
            plan: 'Plan B (CDP Physical File Upload via DOM.setFileInputFiles)',
            success: true,
            durationSec,
            uploadedFile: uploadFilePath,
            fileSizeBytes: fileSize,
            outputChars: responseText.length,
            response: responseText
        }, null, 2), 'utf-8');

        return { success: true, durationSec, responseText };
    } finally {
        console.log('7. 正在清理会话 Tab，释放 Blink 进程内存...');
        try { await browser.send('Target.closeTarget', { targetId }); } catch (_) {}
        client.close();
        browser.close();
    }
}

testPlanB().catch(err => {
    console.error('❌ 方案 B 测试失败:', err);
    process.exitCode = 1;
});
