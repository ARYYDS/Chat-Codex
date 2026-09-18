const fs = require('fs');
const path = require('path');
const os = require('os');

function getMcpEntry(mcpServerScript) {
    const scriptPath = mcpServerScript || path.resolve(__dirname, '..', 'mcp', 'index.js');
    return {
        command: 'node',
        args: [scriptPath],
        env: {
            NODE_ENV: 'production'
        }
    };
}

function detectConfigTargets() {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const appData = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');

    return [
        {
            name: 'Claude Desktop',
            configPath: path.join(appData, 'Claude', 'claude_desktop_config.json'),
            key: 'mcpServers'
        },
        {
            name: 'Cursor',
            configPath: path.join(userProfile, '.cursor', 'mcp.json'),
            key: 'mcpServers'
        },
        {
            name: 'VS Code Roo-Code / Cline',
            configPath: path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'),
            key: 'mcpServers'
        },
        {
            name: 'Antigravity MCP Settings',
            configPath: path.join(userProfile, '.gemini', 'antigravity', 'mcp_config.json'),
            key: 'mcpServers'
        }
    ];
}

function installMcpConfig(options = {}) {
    const dryRun = !!options.dryRun;
    const serverName = options.serverName || 'webchat-assistant';
    const entry = getMcpEntry(options.mcpScript);
    const targets = detectConfigTargets();
    const results = [];

    for (const target of targets) {
        const dir = path.dirname(target.configPath);
        let exists = fs.existsSync(target.configPath);
        let currentJson = {};

        if (exists) {
            try {
                const raw = fs.readFileSync(target.configPath, 'utf-8');
                currentJson = JSON.parse(raw);
            } catch (_) {
                currentJson = {};
            }
        }

        if (!currentJson[target.key]) {
            currentJson[target.key] = {};
        }

        currentJson[target.key][serverName] = entry;

        if (!dryRun) {
            try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(target.configPath, JSON.stringify(currentJson, null, 2), 'utf-8');
                results.push({ name: target.name, path: target.configPath, installed: true });
            } catch (err) {
                results.push({ name: target.name, path: target.configPath, installed: false, error: err.message });
            }
        } else {
            results.push({ name: target.name, path: target.configPath, installed: false, dryRun: true, exists });
        }
    }

    return results;
}

module.exports = {
    getMcpEntry,
    detectConfigTargets,
    installMcpConfig
};
