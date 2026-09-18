const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testFocus() {
    const ws = await getBrowserWsUrl(9222);
    const b = new CdpClient(ws);
    await b.connect();

    console.log('Creating new target...');
    const { targetId } = await b.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const c = new CdpClient(`ws://127.0.0.1:9222/devtools/page/${targetId}`);
    await c.connect();

    try {
        console.log('Bringing tab to front with Page.bringToFront...');
        await c.send('Page.bringToFront');

        console.log('Waiting for composer...');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 600));
            const ready = await c.evaluate(`!!document.querySelector('#prompt-textarea')`);
            if (ready) break;
        }

        console.log('Focusing composer element in DOM...');
        await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                el.focus();
                el.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 300));

        console.log('Sending Input.insertText...');
        await c.send('Input.insertText', { text: 'Test text injected via brought-to-front tab!' });

        await new Promise(r => setTimeout(r, 500));
        const result = await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                const btn = document.querySelector('button[data-testid="send-button"]');
                return {
                    text: el ? el.innerText : '',
                    btnDisabled: btn ? btn.disabled : null,
                    btnAriaDisabled: btn ? btn.getAttribute('aria-disabled') : null
                };
            })()
        `);
        console.log('Result after Page.bringToFront:', result);
    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testFocus().catch(console.error);
