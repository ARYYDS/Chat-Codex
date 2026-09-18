const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testClickChatRadio() {
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

        console.log('1. Checking current mode...');
        const initialMode = await c.evaluate(`
            (() => {
                const workBtn = document.querySelector('.uFxlGa_WorkTrigger, [class*="WorkTrigger"]');
                return {
                    workTriggerText: workBtn ? workBtn.innerText : null
                };
            })()
        `);
        console.log('Initial mode:', initialMode);

        console.log('2. Opening mode dropdown and clicking Chat radio...');
        const switched = await c.evaluate(`
            (() => {
                const workBtn = document.querySelector('.uFxlGa_WorkTrigger, [class*="WorkTrigger"]');
                if (workBtn) {
                    workBtn.click();
                }
                return true;
            })()
        `);

        await new Promise(r => setTimeout(r, 400));

        const clickChat = await c.evaluate(`
            (() => {
                const radios = Array.from(document.querySelectorAll('[role="radio"]'));
                const chatRadio = radios.find(r => (r.innerText || '').trim() === 'Chat');
                if (chatRadio) {
                    chatRadio.click();
                    return { clicked: true };
                }
                return { clicked: false, foundRadios: radios.map(r => r.innerText) };
            })()
        `);
        console.log('Click chat radio result:', clickChat);

        await new Promise(r => setTimeout(r, 1000));

        console.log('3. Checking mode after switching to Chat...');
        const postMode = await c.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea');
                const workBtn = document.querySelector('.uFxlGa_WorkTrigger, [class*="WorkTrigger"]');
                const pills = Array.from(document.querySelectorAll('[class*="pill"], button')).map(b => b.innerText.trim()).filter(Boolean);
                return {
                    workTriggerStillPresent: !!workBtn,
                    workTriggerText: workBtn ? workBtn.innerText : null,
                    pills: pills.slice(0, 10)
                };
            })()
        `);
        console.log('Post-switch mode:', postMode);

        console.log('4. Now sending a test chat prompt in Chat mode...');
        const prompt = '请用一句话回答：TCP三次握手的核心目的是什么？';
        await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                el.focus();
                el.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 200));
        await c.send('Input.insertText', { text: prompt });
        await new Promise(r => setTimeout(r, 300));
        await c.evaluate(`
            (() => {
                const btn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label="Send prompt"]');
                if (btn) btn.click();
            })()
        `);

        console.log('5. Monitoring response in Chat mode...');
        for (let s = 1; s <= 15; s++) {
            await new Promise(r => setTimeout(r, 1000));
            const status = await c.evaluate(`
                (() => {
                    const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).map(el => el.innerText);
                    const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') || document.querySelector('button[data-testid="stop-button"]'));
                    return {
                        hasStop,
                        url: window.location.href,
                        assistant: assistants[0] || ''
                    };
                })()
            `);
            console.log(`[${s}s]:`, JSON.stringify(status));
            if (!status.hasStop && status.assistant.length > 5) {
                console.log('\n🎉 Chat 模式真实调用成功！回答:');
                console.log(status.assistant);
                break;
            }
        }

    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testClickChatRadio().catch(console.error);
