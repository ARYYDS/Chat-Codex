const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testComposerTyping() {
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

        console.log('Composer ready. Checking initial state...');
        const initial = await client.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea');
                const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send prompt"]');
                return {
                    composerContent: composer ? composer.innerHTML : null,
                    sendBtnFound: !!sendBtn,
                    sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
                    sendBtnAriaDisabled: sendBtn ? sendBtn.getAttribute('aria-disabled') : null
                };
            })()
        `);
        console.log('Initial state:', initial);

        // Focus and Insert text
        console.log('Focusing composer and sending Input.insertText...');
        await client.evaluate(`document.querySelector('#prompt-textarea').focus()`);
        await client.send('Input.insertText', { text: 'Hello ChatGPT test' });

        const afterInsert = await client.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea');
                const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send prompt"]');
                return {
                    composerText: composer ? composer.innerText : null,
                    sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
                    sendBtnAriaDisabled: sendBtn ? sendBtn.getAttribute('aria-disabled') : null,
                    sendBtnClass: sendBtn ? sendBtn.className : null
                };
            })()
        `);
        console.log('After Input.insertText:', afterInsert);

        // If still disabled, test dispatching InputEvent
        if (afterInsert.sendBtnDisabled) {
            console.log('Send button still disabled! Testing dispatchEvent(input)...');
            const afterDispatch = await client.evaluate(`
                (() => {
                    const composer = document.querySelector('#prompt-textarea');
                    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
                    const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                    document.querySelector('button[aria-label="Send prompt"]');
                    return {
                        sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
                        sendBtnAriaDisabled: sendBtn ? sendBtn.getAttribute('aria-disabled') : null
                    };
                })()
            `);
            console.log('After dispatchEvent(input):', afterDispatch);
        }

        // Test clicking sendBtn if enabled
        const clickResult = await client.evaluate(`
            (() => {
                const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send prompt"]');
                if (sendBtn && !sendBtn.disabled) {
                    sendBtn.click();
                    return { clicked: true };
                }
                return { clicked: false, disabled: sendBtn ? sendBtn.disabled : null };
            })()
        `);
        console.log('Click send button result:', clickResult);

        // Wait 3 seconds and check if conversation started (url changed or articles appeared)
        await new Promise(r => setTimeout(r, 3000));
        const postCheck = await client.evaluate(`
            (() => {
                return {
                    url: window.location.href,
                    articlesCount: document.querySelectorAll('article').length,
                    hasStop: !!(document.querySelector('button[aria-label="Stop generating"]') || document.querySelector('button[data-testid="stop-button"]'))
                };
            })()
        `);
        console.log('Post-send check:', postCheck);

    } finally {
        await browser.send('Target.closeTarget', { targetId });
        client.close();
        browser.close();
    }
}

testComposerTyping().catch(console.error);
