const { checkMasterSessionStatus } = require('../lib/cdp-cookie-manager');
const { listTasks } = require('../lib/mcp-async-handle');
const { loadConfig } = require('../lib/runtime-config');

const RESOURCES = [
    {
        uri: 'webchat://runtime/status',
        name: 'WebChat Assistant Runtime & Cluster Status',
        description: 'Live diagnosis of Master (Port 9225), Worker instances, and queue load.',
        mimeType: 'application/json'
    },
    {
        uri: 'webchat://sessions/rooms',
        name: 'WebChat Active Rooms and Context Cache',
        description: 'List of active reasoning room channels and mapped profiles.',
        mimeType: 'application/json'
    },
    {
        uri: 'webchat://tasks/history',
        name: 'Recent Reasoning Tasks Ledger',
        description: 'Persistent list of recent reasoning tasks, their statuses, and archive links.',
        mimeType: 'application/json'
    }
];

async function handleResourceRead(uri) {
    if (uri === 'webchat://runtime/status') {
        const masterStatus = await checkMasterSessionStatus(9225);
        const config = loadConfig();
        return {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
                timestamp: new Date().toISOString(),
                master: masterStatus,
                config
            }, null, 2)
        };
    }

    if (uri === 'webchat://sessions/rooms') {
        return {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
                rooms: [
                    { id: 'main', description: 'Primary collaborative reasoning room' },
                    { id: 'debug', description: 'Deep diagnostic and log inspection room' },
                    { id: 'critic', description: 'Adversarial counter-evaluation room' }
                ]
            }, null, 2)
        };
    }

    if (uri === 'webchat://tasks/history') {
        const tasks = listTasks();
        return {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(tasks.slice(0, 30), null, 2)
        };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
}

module.exports = {
    RESOURCES,
    handleResourceRead
};
