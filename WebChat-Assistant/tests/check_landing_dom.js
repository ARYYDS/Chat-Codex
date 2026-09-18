const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function checkLandingDom() {
    const ws = await getBrowserWsUrl(9222);
    const b = new CdpClient(ws);
    await b.connect();
    const { targetId } = await b.send('Target.createTarget', { url: 'https://chatgpt.com/' });
    const c = new CdpClient('ws://127.0.0.1:9222/devtools/page/' + targetId);
    await c.connect();

    try {
        await new Promise(r => setTimeout(r, 6000));
        const res = await c.evaluate(`
            (() => {
                const nodes = Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.includes('Create a project kickoff brief'));
                return nodes.map(n => ({
                    tag: n.tagName,
                    id: n.id,
                    className: n.className,
                    dataTestId: n.getAttribute('data-testid'),
                    role: n.getAttribute('role'),
                    childrenCount: n.children.length,
                    text: n.innerText
                }));
            })()
        `);
        console.log('Landing match:', JSON.stringify(res, null, 2));
    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

checkLandingDom().catch(console.error);
