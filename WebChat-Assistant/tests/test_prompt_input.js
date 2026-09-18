const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testPromptInput() {
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

        const prompt = '测试快速问答：请用一句话回答TCP三次握手的核心目的是什么？';
        console.log('1. Focusing composer...');
        await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                el.focus();
                el.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 200));

        console.log('2. Inserting text via Input.insertText...');
        await c.send('Input.insertText', { text: prompt });

        const check1 = await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                const btn = document.querySelector('button[data-testid="send-button"]');
                return {
                    text: el ? el.innerText : '',
                    len: el ? el.innerText.length : 0,
                    btnAriaDisabled: btn ? btn.getAttribute('aria-disabled') : null
                };
            })()
        `);
        console.log('Check after insertText:', check1);

        console.log('3. Clicking Send button...');
        await c.evaluate(`
            (() => {
                const btn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label="Send prompt"]');
                if (btn) btn.click();
            })()
        `);

        console.log('4. Watching response...');
        for (let s = 1; s <= 15; s++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await c.evaluate(`
                (() => {
                    const userTurns = Array.from(document.querySelectorAll('[data-message-author-role="user"]')).map(el => el.innerText);
                    const assistantTurns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).map(el => el.innerText);
                    const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') || document.querySelector('button[data-testid="stop-button"]'));
                    return {
                        url: window.location.href,
                        hasStop,
                        userText: userTurns[0] || '',
                        assistantText: assistantTurns[0] || ''
                    };
                })()
            `);
            console.log(`[${s}s]:`, JSON.stringify(status));
            if (!status.hasStop && status.assistantText.length > 5) {
                console.log('🎉 成功收到回答:');
                console.log(status.assistantText);
                break;
            }
        }
    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testPromptInput().catch(console.error);
