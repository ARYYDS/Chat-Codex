const { CdpClient, fetchJson } = require('../lib/cdp-client');

async function inspect() {
    const list = await fetchJson('http://127.0.0.1:9222/json/list');
    const chatPage = list.find(p => p.url.startsWith('https://chatgpt.com') && p.type === 'page');
    if (!chatPage) {
        console.error('No ChatGPT page found on port 9222. URLs:', list.map(p => p.url));
        return;
    }

    console.log('Connecting to ChatGPT page:', chatPage.title, chatPage.url);
    const client = new CdpClient(chatPage.webSocketDebuggerUrl);
    await client.connect();

    try {
        const domAnalysis = await client.evaluate(`
            (() => {
                const composer = document.querySelector('#prompt-textarea') || 
                                 document.querySelector('div[contenteditable="true"]') ||
                                 document.querySelector('textarea');
                
                const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
                    ariaLabel: b.getAttribute('aria-label'),
                    testid: b.getAttribute('data-testid'),
                    text: b.innerText ? b.innerText.trim() : '',
                    className: b.className
                })).filter(b => b.ariaLabel || b.testid || b.text);

                const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(inp => ({
                    id: inp.id,
                    name: inp.name,
                    accept: inp.accept,
                    multiple: inp.multiple,
                    style: inp.getAttribute('style'),
                    className: inp.className
                }));

                const allInputs = Array.from(document.querySelectorAll('input')).map(inp => ({
                    type: inp.type,
                    id: inp.id,
                    name: inp.name
                }));

                return {
                    url: window.location.href,
                    hasComposer: !!composer,
                    composerTag: composer ? composer.tagName : null,
                    composerId: composer ? composer.id : null,
                    allInputs,
                    fileInputs,
                    buttons: buttons.filter(b => (b.ariaLabel && (b.ariaLabel.toLowerCase().includes('attach') || b.ariaLabel.toLowerCase().includes('file') || b.ariaLabel.toLowerCase().includes('send') || b.ariaLabel.toLowerCase().includes('上传') || b.ariaLabel.toLowerCase().includes('发送') || b.ariaLabel.toLowerCase().includes('add') || b.ariaLabel.toLowerCase().includes('plus'))) || (b.testid && b.testid.toLowerCase().includes('attach')))
                };
            })()
        `);

        console.log('DOM Analysis Result:');
        console.log(JSON.stringify(domAnalysis, null, 2));
    } finally {
        client.close();
    }
}

inspect().catch(console.error);
