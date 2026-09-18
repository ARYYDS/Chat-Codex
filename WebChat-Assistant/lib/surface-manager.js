const fs = require('fs');
const path = require('path');
const { CdpClient, attachFlatSession } = require('./cdp-client');

const EFFORT_GEARS = {
    chat: {
        high: { label: 'High Reasoning', model: 'o3-mini', effort: 'high' },
        medium: { label: 'Medium Reasoning', model: 'o3-mini', effort: 'medium' },
        low: { label: 'Low Reasoning', model: 'gpt-4o', effort: 'low' }
    },
    work: {
        high: { label: 'Canvas Work Deep', model: 'chatgpt-pro', effort: 'high' },
        medium: { label: 'Canvas Work Standard', model: 'chatgpt-pro', effort: 'medium' },
        low: { label: 'Canvas Work Fast', model: 'chatgpt-pro', effort: 'low' }
    }
};

const STOP_BUTTON_SELECTORS = [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop answering"]',
    'button[data-testid="stop-button"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="停止回答"]'
];

async function ensureSurfaceMode(client, targetSurface = 'chat') {
    const isChat = targetSurface.toLowerCase() !== 'work';
    
    await client.evaluate(`
        ((targetIsChat) => {
            const workBtn = document.querySelector('.uFxlGa_WorkTrigger, [class*="WorkTrigger"]');
            
            if (targetIsChat) {
                if (workBtn) {
                    workBtn.click();
                    const radios = Array.from(document.querySelectorAll('[role="radio"]'));
                    const chatRadio = radios.find(r => (r.innerText || '').trim() === 'Chat');
                    if (chatRadio) chatRadio.click();
                }
            } else {
                if (!workBtn) {
                    const radios = Array.from(document.querySelectorAll('[role="radio"]'));
                    const workRadio = radios.find(r => (r.innerText || '').trim() === 'Work');
                    if (workRadio) workRadio.click();
                }
            }
        })(${isChat})
    `);
    await new Promise(r => setTimeout(r, 300));
}

async function focusAndInjectPrompt(client, promptText, surface = 'chat') {
    try {
        await client.send('Page.bringToFront');
    } catch (_) {}

    // 0. Ensure target surface mode (strictly force Chat mode for normal/small tasks)
    await ensureSurfaceMode(client, surface);

    // 1. Focus and click composer
    const focused = await client.evaluate(`
        (() => {
            const composer = document.querySelector('#prompt-textarea') || 
                             document.querySelector('div[contenteditable="true"]') ||
                             document.querySelector('textarea');
            if (composer) {
                composer.focus();
                composer.click();
                return true;
            }
            return false;
        })()
    `);

    if (!focused) {
        throw new Error('Could not find or focus ChatGPT input composer.');
    }

    await new Promise(r => setTimeout(r, 200));

    // 2. Inject text: for normal prompts (<3000 chars), use fast Input.insertText; for large context packets, use paste
    if (promptText.length < 3000) {
        await client.send('Input.insertText', { text: promptText });
        await new Promise(r => setTimeout(r, 200));
        
        // Verification: if empty, fall back to execCommand
        const isFilled = await client.evaluate(`
            (() => {
                const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
                return el && (el.innerText || el.value || '').trim().length > 0;
            })()
        `);
        if (!isFilled) {
            await client.evaluate(`
                ((text) => {
                    const el = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
                    if (el) {
                        el.focus();
                        document.execCommand('insertText', false, text);
                    }
                })(${JSON.stringify(promptText)})
            `);
        }
    } else {
        await client.evaluate(`
            ((text) => {
                const composer = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
                if (composer) {
                    composer.focus();
                    composer.click();
                    const dt = new DataTransfer();
                    dt.setData('text/plain', text);
                    const pasteEv = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dt
                    });
                    composer.dispatchEvent(pasteEv);
                }
            })(${JSON.stringify(promptText)})
        `);
    }

    // 3. Wait for send button to become active (aria-disabled === 'false') and click
    let sent = false;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 300));
        sent = await client.evaluate(`
            (() => {
                const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                                document.querySelector('button[aria-label="Send prompt"]') ||
                                document.querySelector('button[aria-label="发送提示"]');
                if (sendBtn && sendBtn.getAttribute('aria-disabled') === 'false') {
                    sendBtn.click();
                    return true;
                }
                return false;
            })()
        `);
        if (sent) break;
    }

    if (!sent) {
        // Fallback: dispatch Enter key
        await client.send('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            windowsVirtualKeyCode: 13,
            unmodifiedText: '\r',
            text: '\r'
        });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
    }

    // 4. Wait up to 5 seconds for turn acknowledgment
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        const ack = await client.evaluate(`
            (() => {
                const hasUser = document.querySelectorAll('[data-message-author-role="user"]').length > 0;
                const hasStop = !!(document.querySelector('button[aria-label="Stop generating"]') ||
                                   document.querySelector('button[data-testid="stop-button"]') ||
                                   document.querySelector('button[aria-label="停止生成"]'));
                const urlChanged = window.location.href.includes('/c/');
                return hasUser || hasStop || urlChanged;
            })()
        `);
        if (ack) break;
    }

    return true;
}

async function uploadFileViaCdp(client, filePath) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`File does not exist: ${absPath}`);
    }

    try {
        await client.send('Page.bringToFront');
    } catch (_) {}

    await client.send('DOM.enable');
    const doc = await client.send('DOM.getDocument', { depth: -1 });
    let queryRes = await client.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#upload-files'
    });

    if (!queryRes || !queryRes.nodeId) {
        queryRes = await client.send('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: 'input[type="file"]'
        });
    }

    if (!queryRes || !queryRes.nodeId) {
        throw new Error('Could not find file input element in ChatGPT composer DOM.');
    }

    await client.send('DOM.setFileInputFiles', {
        files: [absPath],
        nodeId: queryRes.nodeId
    });

    // Wait for attachment tile to mount in composer
    const baseName = path.basename(absPath);
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const attached = await client.evaluate(`
            (() => {
                const cards = Array.from(document.querySelectorAll('[data-testid*="attachment"], [class*="file-tile"], [class*="file"]')).map(el => el.innerText || '');
                return cards.some(t => t.includes(${JSON.stringify(baseName)}));
            })()
        `);
        if (attached) return { success: true, fileName: baseName };
    }
    return { success: true, fileName: baseName, note: 'Attachment dispatched' };
}

async function checkTurnConvergence(client, lastTextLength = 0, unchangedDurationMs = 0) {
    const status = await client.evaluate(`
        (() => {
            const stopSelectors = ${JSON.stringify(STOP_BUTTON_SELECTORS)};
            let hasStop = false;
            for (const s of stopSelectors) {
                if (document.querySelector(s)) {
                    hasStop = true;
                    break;
                }
            }

            // Extract assistant messages strictly via data-message-author-role="assistant"
            // (NEVER query 'article', as landing page cards use <article class="...DqFnpa_tile">)
            const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
            let targetNode = assistants.length > 0 ? assistants[assistants.length - 1] : null;

            let text = targetNode ? (targetNode.innerText || '').trim() : '';

            // Extract search pills
            const searchNodes = document.querySelectorAll('button[data-testid*="search"], div[data-testid*="search"]');
            const searches = Array.from(searchNodes).map(n => n.innerText).filter(Boolean);

            // Check if there is an error banner
            const errorBanner = document.querySelector('[data-testid*="error"]') || document.querySelector('.text-red-500');

            return {
                hasStop,
                hasAssistantNode: !!targetNode,
                textLength: text.length,
                textSnippet: text.slice(-300),
                searches,
                hasError: !!errorBanner
            };
        })()
    `);

    if (!status) {
        return { isSettled: false, isStalled: false, textLength: 0 };
    }

    const currentLen = status.textLength;
    const isTextSame = currentLen > 0 && currentLen === lastTextLength;
    const newUnchangedMs = isTextSame ? unchangedDurationMs + 3000 : 0;

    // Stall watchdog: text has not changed for >= 45 seconds while stop button is present
    const isStalled = isTextSame && newUnchangedMs >= 45000;

    // True settlement: Stop button vanished, an assistant node exists, and text length > 0
    const isSettled = (!status.hasStop && status.hasAssistantNode && currentLen > 0) || isStalled;

    return {
        isSettled,
        isStalled,
        hasStop: status.hasStop,
        hasAssistantNode: status.hasAssistantNode,
        textLength: currentLen,
        textSnippet: status.textSnippet,
        searches: status.searches || [],
        unchangedDurationMs: newUnchangedMs
    };
}

async function forceStop(client) {
    return await client.evaluate(`
        (() => {
            const stopSelectors = ${JSON.stringify(STOP_BUTTON_SELECTORS)};
            for (const s of stopSelectors) {
                const btn = document.querySelector(s);
                if (btn) {
                    btn.click();
                    return { clicked: true, selector: s };
                }
            }
            return { clicked: false };
        })()
    `);
}

async function extractFullResponse(client) {
    return await client.evaluate(`
        (() => {
            const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
            let targetNode = assistants.length > 0 ? assistants[assistants.length - 1] : null;

            if (!targetNode) {
                return { text: '', html: '', length: 0 };
            }

            return {
                text: (targetNode.innerText || '').trim(),
                html: targetNode.innerHTML || '',
                length: (targetNode.innerText || '').trim().length
            };
        })()
    `);
}

module.exports = {
    EFFORT_GEARS,
    STOP_BUTTON_SELECTORS,
    ensureSurfaceMode,
    focusAndInjectPrompt,
    uploadFileViaCdp,
    checkTurnConvergence,
    forceStop,
    extractFullResponse
};
