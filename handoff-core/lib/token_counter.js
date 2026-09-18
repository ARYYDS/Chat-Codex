'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Dual-track 1: OpenAI o200k_base tokenizer heuristic
 * Formula: ceil((CJK字符数 * 1.35) + (英文单词数 * 1.30) + (特殊符号数 * 0.40))
 *
 * @param {string} text
 * @returns {number} Estimated text tokens
 */
function estimateTextTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  // CJK characters (Unified Ideographs, Ext A, Compatibility, Kana, Hangul)
  const cjkMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // English words and alphanumeric tokens
  const wordMatches = text.match(/[A-Za-z0-9_]+/g);
  const wordCount = wordMatches ? wordMatches.length : 0;

  // Code & special symbols: non-whitespace, non-alphanumeric, non-CJK
  const symbolMatches = text.match(/[^A-Za-z0-9_\s\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  const symbolCount = symbolMatches ? symbolMatches.length : 0;

  const rawTokens = (cjkCount * 1.35) + (wordCount * 1.30) + (symbolCount * 0.40);
  return Math.ceil(rawTokens);
}

/**
 * Dual-track 2: o1 / o3 implicit reasoning tokens estimation
 * RateEffort: High: 52 tok/s, Medium: 38 tok/s, Low: 22 tok/s
 */
const EFFORT_RATES = {
  high: 52,
  medium: 38,
  low: 22,
};

/**
 * Estimate implicit reasoning tokens from think seconds and effort tier
 *
 * @param {number} seconds Duration in seconds
 * @param {string} effort 'high' | 'medium' | 'low'
 * @returns {number} Estimated reasoning tokens
 */
function estimateReasoningTokens(seconds, effort = 'Medium') {
  const s = Math.max(0, Number(seconds) || 0);
  const effortKey = String(effort || 'medium').toLowerCase();
  const rate = EFFORT_RATES[effortKey] !== undefined ? EFFORT_RATES[effortKey] : EFFORT_RATES.medium;
  return Math.round(s * rate);
}

/**
 * Generate detailed token bill for a prompt/response exchange
 *
 * @param {Object} params
 * @param {string} [params.promptText='']
 * @param {string} [params.responseText='']
 * @param {number} [params.thinkSeconds=0]
 * @param {string} [params.effort='Medium']
 * @param {string} [params.model='o3-mini']
 * @param {string|number} [params.taskId=null]
 * @returns {Object} Bill with promptTokens, completionTokens, reasoningTokens, totalTokens, estimatedCostUSD
 */
function generateTokenBill({
  promptText = '',
  responseText = '',
  thinkSeconds = 0,
  effort = 'Medium',
  model = 'o3-mini',
  taskId = null,
} = {}) {
  const promptTokens = estimateTextTokens(promptText);
  const completionTokens = estimateTextTokens(responseText);
  const reasoningTokens = estimateReasoningTokens(thinkSeconds, effort);
  const totalTokens = promptTokens + completionTokens + reasoningTokens;

  // OpenAI o3-mini pricing reference ($1.10 / 1M prompt, $4.40 / 1M completion+reasoning)
  const promptCost = (promptTokens / 1000000) * 1.10;
  const outputCost = ((completionTokens + reasoningTokens) / 1000000) * 4.40;
  const estimatedCostUSD = Number((promptCost + outputCost).toFixed(6));

  return {
    taskId,
    timestamp: new Date().toISOString(),
    model,
    effort: String(effort),
    thinkSeconds: Number(thinkSeconds) || 0,
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    estimatedCostUSD,
    details: {
      promptLength: promptText ? promptText.length : 0,
      responseLength: responseText ? responseText.length : 0,
      inputCostUSD: Number(promptCost.toFixed(6)),
      outputCostUSD: Number(outputCost.toFixed(6)),
    },
  };
}

/**
 * Resolve the default path for runs/token_ledger.json
 *
 * @returns {string}
 */
function resolveLedgerPath() {
  try {
    const { runOutput } = require('./runtime-config');
    return runOutput('token_ledger.json');
  } catch {
    const fallback = path.resolve(__dirname, '..', '..', 'runs', 'token_ledger.json');
    return fallback;
  }
}

/**
 * Append bill record into runs/token_ledger.json
 *
 * @param {Object} bill
 * @param {string} [ledgerPath=null]
 * @returns {string} Absolute path of the ledger file
 */
function appendTokenLedger(bill, ledgerPath = null) {
  const targetPath = ledgerPath ? path.resolve(ledgerPath) : resolveLedgerPath();
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let ledger = [];
  if (fs.existsSync(targetPath)) {
    try {
      const content = fs.readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (content) {
        ledger = JSON.parse(content);
        if (!Array.isArray(ledger)) {
          ledger = [ledger];
        }
      }
    } catch {
      ledger = [];
    }
  }

  ledger.push(bill);
  fs.writeFileSync(targetPath, JSON.stringify(ledger, null, 2), 'utf8');
  return targetPath;
}

module.exports = {
  estimateTextTokens,
  estimateReasoningTokens,
  generateTokenBill,
  appendTokenLedger,
  EFFORT_RATES,
};
