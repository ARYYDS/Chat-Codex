const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testMultiline() {
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

        console.log('Testing Method 1: Input.insertText with newlines');
        await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                el.focus();
                el.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 300));
        await c.send('Input.insertText', { text: "Line 1\nLine 2\nLine 3" });
        await new Promise(r => setTimeout(r, 400));
        const res1 = await c.evaluate(`document.querySelector('#prompt-textarea').innerText`);
        console.log('Method 1 Result:', JSON.stringify(res1));

        console.log('\nTesting Method 2: Clipboard Paste / DataTransfer');
        await c.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea');
                composer.focus();
                const dt = new DataTransfer();
                dt.setData('text/plain', "Pasted Line 1\\nPasted Line 2\\n# Title\\nCode block");
                const pasteEv = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt
                });
                composer.dispatchEvent(pasteEv);
            })()
        `);
        await new Promise(r => setTimeout(r, 500));
        const res2 = await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                const btn = document.querySelector('button[data-testid="send-button"]');
                return {
                    text: el ? el.innerText : '',
                    btnAriaDisabled: btn ? btn.getAttribute('aria-disabled') : null
                };
            })()
        `);
        console.log('Method 2 (Paste Event) Result:', res2);

        console.log('\nTesting Method 3: Line-by-line / Shift+Enter key injection or execCommand');
        await c.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea');
                composer.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, "ExecCommand Line 1\\nExecCommand Line 2");
            })()
        `);
        await new Promise(r => setTimeout(r, 500));
        const res3 = await c.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea');
                const btn = document.querySelector('button[data-testid="send-button"]');
                return {
                    text: el ? el.innerText : '',
                    btnAriaDisabled: btn ? btn.getAttribute('aria-disabled') : null
                };
            })()
        `);
        console.log('Method 3 (document.execCommand) Result:', res3);

    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testMultiline().catch(console.error);
