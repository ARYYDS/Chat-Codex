const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function inspectModels() {
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

        const info = await c.evaluate(`
            (() => {
                const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                    text: (b.innerText || '').trim(),
                    testid: b.getAttribute('data-testid'),
                    ariaLabel: b.getAttribute('aria-label'),
                    className: b.className
                }));

                const modelPicker = buttons.filter(b => 
                    (b.testid && b.testid.includes('model')) || 
                    (b.ariaLabel && (b.ariaLabel.includes('Model') || b.ariaLabel.includes('模型'))) ||
                    b.text.includes('GPT') || b.text.includes('Work') || b.text.includes('Chat')
                );

                return {
                    url: window.location.href,
                    allButtonsCount: buttons.length,
                    modelPicker
                };
            })()
        `);

        console.log('Model Picker & Surface Info:');
        console.log(JSON.stringify(info, null, 2));

    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

inspectModels().catch(console.error);
