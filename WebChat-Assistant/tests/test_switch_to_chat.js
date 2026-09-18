const { CdpClient, getBrowserWsUrl } = require('../lib/cdp-client');

async function testSwitchToChat() {
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

        console.log('Clicking Work Trigger button...');
        const clickRes = await c.evaluate(`
            (() => {
                const btn = document.querySelector('.uFxlGa_WorkTrigger, [class*="WorkTrigger"]');
                if (btn) {
                    btn.click();
                    return { clicked: true, text: btn.innerText };
                }
                return { clicked: false };
            })()
        `);
        console.log('Work trigger clicked:', clickRes);

        await new Promise(r => setTimeout(r, 800));

        // 检查弹出的菜单项
        const menuItems = await c.evaluate(`
            (() => {
                const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], div[data-radix-collection-item], button')).map(el => ({
                    role: el.getAttribute('role'),
                    text: (el.innerText || '').trim().slice(0, 80),
                    className: el.className
                })).filter(i => i.text.length > 0);
                return items.slice(0, 30);
            })()
        `);
        console.log('Opened Menu Items:', JSON.stringify(menuItems, null, 2));

    } finally {
        await b.send('Target.closeTarget', { targetId });
        c.close();
        b.close();
    }
}

testSwitchToChat().catch(console.error);
