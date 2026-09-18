const { CdpClient, getBrowserWsUrl, fetchJson } = require('./cdp-client');

const TARGET_DOMAINS = ['.chatgpt.com', 'chatgpt.com', '.openai.com', 'openai.com'];

async function dumpCookiesFromBrowserTarget(port = 9225) {
    const wsUrl = await getBrowserWsUrl(port);
    const client = new CdpClient(wsUrl);
    await client.connect();

    try {
        let cookies = [];
        try {
            const res = await client.send('Storage.getCookies');
            cookies = res.cookies || [];
        } catch (_) {
            const res = await client.send('Network.getCookies');
            cookies = res.cookies || [];
        }
        return cookies;
    } finally {
        client.close();
    }
}

async function injectCookiesToWorker(port = 9222, cookies = []) {
    if (!cookies || cookies.length === 0) return { injected: 0 };
    const wsUrl = await getBrowserWsUrl(port);
    const client = new CdpClient(wsUrl);
    await client.connect();

    try {
        const sanitized = cookies.map(c => {
            const copy = { ...c };
            delete copy.size;
            delete copy.priority;
            delete copy.sameParty;
            delete copy.sourceScheme;
            delete copy.sourcePort;
            return copy;
        });

        try {
            await client.send('Storage.setCookies', { cookies: sanitized });
        } catch (_) {
            await client.send('Network.setCookies', { cookies: sanitized });
        }
        return { injected: sanitized.length };
    } finally {
        client.close();
    }
}

async function checkMasterSessionStatus(port = 9225) {
    try {
        const cookies = await dumpCookiesFromBrowserTarget(port);
        const sessionToken = cookies.find(c => 
            (c.domain.includes('chatgpt') || c.domain.includes('openai')) && 
            c.name.includes('session-token')
        );

        const cfClearance = cookies.find(c => c.name === 'cf_clearance');

        return {
            connected: true,
            totalCookies: cookies.length,
            hasSessionToken: !!sessionToken,
            hasCfClearance: !!cfClearance,
            sessionTokenExpiry: sessionToken?.expires || 0,
            cookies
        };
    } catch (err) {
        return {
            connected: false,
            error: err.message,
            totalCookies: 0,
            hasSessionToken: false
        };
    }
}

async function syncMasterCookiesToWorkers(masterPort = 9225, workerPorts = [9222, 9223]) {
    const masterStatus = await checkMasterSessionStatus(masterPort);
    if (!masterStatus.connected || !masterStatus.hasSessionToken) {
        throw new Error(
            masterStatus.connected
                ? 'Master browser (Port ' + masterPort + ') is reachable, but ChatGPT session token was not found. Please log in first.'
                : 'Master browser (Port ' + masterPort + ') is not running. Launch it with start_master.bat.'
        );
    }

    const results = {};
    for (const p of workerPorts) {
        try {
            const syncRes = await injectCookiesToWorker(p, masterStatus.cookies);
            results[p] = { success: true, count: syncRes.injected };
        } catch (err) {
            results[p] = { success: false, error: err.message };
        }
    }
    return { masterStatus, workers: results };
}

module.exports = {
    dumpCookiesFromBrowserTarget,
    injectCookiesToWorker,
    checkMasterSessionStatus,
    syncMasterCookiesToWorkers
};
