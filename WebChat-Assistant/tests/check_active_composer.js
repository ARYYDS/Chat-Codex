const { CdpClient, fetchJson } = require('../lib/cdp-client');

async function checkAll() {
    const list = await fetchJson('http://127.0.0.1:9222/json/list');
    const pages = list.filter(p => p.url.startsWith('https://chatgpt.com') && p.type === 'page');
    for (const p of pages) {
        try {
            const c = new CdpClient(p.webSocketDebuggerUrl);
            await c.connect();
            const res = await c.evaluate(`
                (() => {
                    const composer = document.querySelector('#prompt-textarea');
                    const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).map(a => a.innerText.slice(0, 80));
                    const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') || document.querySelector('button[data-testid="stop-button"]'));
                    const btn = document.querySelector('button[data-testid="send-button"]');
                    return {
                        url: window.location.href,
                        composerLen: composer ? composer.innerText.length : 0,
                        composerText: composer ? composer.innerText.slice(0, 60) : '',
                        hasStop,
                        btnAriaDisabled: btn ? btn.getAttribute('aria-disabled') : null,
                        assistants
                    };
                })()
            `);
            console.log(p.id, JSON.stringify(res));
            c.close();
        } catch(e) {
            console.log(p.id, e.message);
        }
    }
}

checkAll().catch(console.error);
