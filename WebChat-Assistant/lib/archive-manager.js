const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./runtime-config');

function getTimeBucket(date) {
    const hour = date.getHours();
    if (hour < 4) return '00h-04h';
    if (hour < 8) return '04h-08h';
    if (hour < 12) return '08h-12h';
    if (hour < 16) return '12h-16h';
    if (hour < 20) return '16h-20h';
    return '20h-24h';
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function sanitizeFilename(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 70);
}

function archiveReport({
    project = 'WebChat-Assistant',
    title = 'Analysis Report',
    prompt = '',
    response = '',
    searches = [],
    tokens = {},
    taskId = ''
}) {
    const config = loadConfig();
    const now = new Date();
    const dateStr = formatDate(now);
    const bucketStr = getTimeBucket(now);

    const safeTitle = sanitizeFilename(title || prompt.slice(0, 40) || 'Task_Result');
    const projectDir = path.join(config.historyRoot, project, dateStr, bucketStr);

    if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
    }

    const mdPath = path.join(projectDir, `${safeTitle}.md`);

    const mdContent = [
        `# ${title}`,
        '',
        '> **自动研报落盘凭据 (Automated Reasoning Archive)**',
        `> - **任务 ID**: \`${taskId || 'N/A'}\``,
        `> - **落盘时间**: \`${formatDateTime(now)}\``,
        `> - **预估 Token**: 总量 \`${tokens.totalTokens || 'N/A'}\` (输入: \`${tokens.promptTokens || 'N/A'}\`, 输出: \`${tokens.completionTokens || 'N/A'}\`, 思考: \`${tokens.reasoningTokens || 'N/A'}\`)`,
        `> - **预估算力成本**: \`$${tokens.estimatedCostUSD || '0.0000'}\``,
        '',
        '---',
        '',
        '## 1. 任务契约与原始问题 (Task Prompt)',
        '',
        '```markdown',
        prompt,
        '```',
        '',
        '---',
        '',
        '## 2. 联网搜索与实时溯源 (Web Search Logs)',
        '',
        searches && searches.length > 0
            ? searches.map((s, idx) => `${idx + 1}. **[Search]**: \`${s}\``).join('\n')
            : '*[无联网搜索调用]*',
        '',
        '---',
        '',
        '## 3. 完整深度回复与推理正文 (Assistant Content)',
        '',
        response || '*[无输出内容]*',
        ''
    ].join('\n');

    fs.writeFileSync(mdPath, mdContent, 'utf-8');

    // Update local index
    updateSearchIndex({
        project,
        title,
        mdPath,
        taskId,
        date: dateStr,
        tokens: tokens.totalTokens || 0
    });

    return { mdPath, length: response.length };
}

function updateSearchIndex(entry) {
    const config = loadConfig();
    const indexPath = path.join(config.historyRoot, 'search_index.json');
    let indexData = [];
    try {
        if (fs.existsSync(indexPath)) {
            indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        }
    } catch (_) {
        indexData = [];
    }

    indexData.unshift({
        ...entry,
        timestamp: new Date().toISOString()
    });

    if (indexData.length > 500) indexData = indexData.slice(0, 500);

    try {
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
    } catch (_) {}
}

module.exports = {
    archiveReport,
    updateSearchIndex
};
