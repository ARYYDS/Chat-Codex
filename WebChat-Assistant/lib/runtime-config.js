const fs = require('fs');
const path = require('path');

const RUNTIME_ROOT = 'C:\\GPT-Chat-codex-handoff';
const CONFIG_FILE = path.join(RUNTIME_ROOT, 'runtime.local.json');

const DEFAULT_CONFIG = {
    masterPort: 9225,
    workerPorts: [9222, 9223],
    masterSeedDir: path.join(RUNTIME_ROOT, 'master-seed-profile'),
    historyRoot: path.join(RUNTIME_ROOT, 'PassSearchHistory'),
    runsRoot: path.join(RUNTIME_ROOT, 'runs'),
    tokenLedgerFile: path.join(RUNTIME_ROOT, 'runs', 'token_ledger.json'),
    chromeExecutable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    guiPort: 8765
};

function ensureDirs() {
    [RUNTIME_ROOT, DEFAULT_CONFIG.masterSeedDir, DEFAULT_CONFIG.historyRoot, DEFAULT_CONFIG.runsRoot].forEach(dir => {
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
        }
    });
}

function loadConfig() {
    ensureDirs();
    if (!fs.existsSync(CONFIG_FILE)) {
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
        } catch (e) {}
        return DEFAULT_CONFIG;
    }
    try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) {
        return DEFAULT_CONFIG;
    }
}

function getChromePath() {
    const config = loadConfig();
    if (fs.existsSync(config.chromeExecutable)) return config.chromeExecutable;
    const fallbacks = [
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    for (const fb of fallbacks) {
        if (fs.existsSync(fb)) return fb;
    }
    return config.chromeExecutable;
}

module.exports = {
    RUNTIME_ROOT,
    CONFIG_FILE,
    DEFAULT_CONFIG,
    loadConfig,
    ensureDirs,
    getChromePath
};
