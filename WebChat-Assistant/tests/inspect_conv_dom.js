const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function inspectConversationDom() {
    const workerPort = 9222;
    const browserWs = await getBrowserWsUrl(workerPort);
    const browser = new CdpClient(browserWs);
    await browser.connect();

    console.log('Creating fresh ChatGPT tab...');
    const createRes = await browser.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const targetId = createRes.targetId;
    const client = new CdpClient(`ws://127.0.0.1:${workerPort}/devtools/page/${targetId}`);
    await client.connect();

    try {
        console.log('Waiting for composer...');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            const ready = await client.evaluate(`!!document.querySelector('#prompt-textarea')`);
            if (ready) break;
        }

        console.log('Injecting prompt: "1+1等于几？用一句话回答"');
        await client.evaluate(`document.querySelector('#prompt-textarea').focus()`);
        await client.send('Input.insertText', { text: '1+1等于几？用一句话回答' });
        await new Promise(r => setTimeout(r, 400));
        await client.evaluate(`document.querySelector('button[data-testid="send-button"]').click()`);

        console.log('Sent prompt. Watching DOM structure for 10 seconds...');
        for (let i = 1; i <= 10; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const domInfo = await client.evaluate(`
                (() => {
                    const articles = document.querySelectorAll('article');
                    const agentTurns = document.querySelectorAll('[data-message-author-role="assistant"]');
                    const markdownBodies = document.querySelectorAll('.markdown, [class*="markdown"]');
                    const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[data-testid="stop-button"], button[aria-label="停止生成"]');
                    
                    return {
                        url: window.location.href,
                        articlesCount: articles.length,
                        articlesText: Array.from(articles).map(a => a.innerText.slice(0, 100)),
                        agentTurnsCount: agentTurns.length,
                        agentTurnsText: Array.from(agentTurns).map(a => a.innerText.slice(0, 100)),
                        markdownCount: markdownBodies.length,
                        markdownText: Array.from(markdownBodies).map(m => m.innerText.slice(0, 100)),
                        hasStop: !!stopBtn
                    };
                })()
            `);
            console.log(`[${i}s]:`, JSON.stringify(domInfo));
            if (!domInfo.hasStop && (domInfo.agentTurnsCount > 0 || domInfo.markdownCount > 0)) {
                console.log('Finished!');
                break;
            }
        }
    } finally {
        await browser.send('Target.closeTarget', { targetId });
        client.close();
        browser.close();
    }
}

inspectConversationDom().catch(console.error);
