const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./runtime-config');

const EFFORT_RATES = {
    high: 52,
    medium: 38,
    low: 22
};

function estimateTextTokens(text = '') {
    if (!text || typeof text !== 'string') return 0;
    
    // CJK characters
    const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    // English/Latin words
    const wordMatches = text.match(/[A-Za-z0-9_-]+/g);
    const wordCount = wordMatches ? wordMatches.length : 0;

    // Symbols & whitespace
    const symbolMatches = text.match(/[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
    const symbolCount = symbolMatches ? symbolMatches.length : 0;

    const estimated = (cjkCount * 1.35) + (wordCount * 1.30) + (symbolCount * 0.40);
    return Math.ceil(Math.max(1, estimated));
}

function estimateReasoningTokens(thinkSeconds = 0, effort = 'medium') {
    const rate = EFFORT_RATES[effort.toLowerCase()] || EFFORT_RATES.medium;
    return Math.ceil(Math.max(0, thinkSeconds * rate));
}

function generateTokenBill({ promptText = '', responseText = '', thinkSeconds = 0, effort = 'medium', model = 'chatgpt-pro' }) {
    const promptTokens = estimateTextTokens(promptText);
    const completionTokens = estimateTextTokens(responseText);
    const reasoningTokens = estimateReasoningTokens(thinkSeconds, effort);
    const totalTokens = promptTokens + completionTokens + reasoningTokens;

    // Pricing estimation (approx $15/1M input, $60/1M output for top tier reasoning)
    const costPrompt = (promptTokens / 1_000_000) * 15.0;
    const costCompletion = ((completionTokens + reasoningTokens) / 1_000_000) * 60.0;
    const estimatedCostUSD = Number((costPrompt + costCompletion).toFixed(4));

    return {
        timestamp: new Date().toISOString(),
        model,
        effort,
        thinkSeconds,
        promptTokens,
        completionTokens,
        reasoningTokens,
        totalTokens,
        estimatedCostUSD
    };
}

function appendTokenLedger(bill, ledgerPath) {
    const targetFile = ledgerPath || loadConfig().tokenLedgerFile;
    try {
        const dir = path.dirname(targetFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let entries = [];
        if (fs.existsSync(targetFile)) {
            try {
                entries = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
            } catch (_) {
                entries = [];
            }
        }
        entries.push(bill);
        fs.writeFileSync(targetFile, JSON.stringify(entries, null, 2), 'utf-8');
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    EFFORT_RATES,
    estimateTextTokens,
    estimateReasoningTokens,
    generateTokenBill,
    appendTokenLedger
};
