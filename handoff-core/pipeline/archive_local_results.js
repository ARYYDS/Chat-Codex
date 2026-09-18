/**
 * archive_local_results.js
 * 
 * 将 pipeline/results_10_dispatched.json 与 pipeline/results_cdp_vss_5queries.json 中的测试结果，
 * 按照 24h 每 4h 分层标准，一键归档转换到 PassSearchHistory 目录下的 Markdown 文件。
 */

const fs = require('fs');
const path = require('path');

const { loadConfig, resolveProjectInfo, option } = require('../lib/runtime-config');
const { writeArchive } = require('../lib/archive-write');
const BASE_OUT_DIR = loadConfig().historyRoot;

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
    if (!name) return 'Untitled_Search';
    return name
        .replace(/[\\/]/g, '_')
        .replace(/[:]/g, '：')
        .replace(/[?]/g, '？')
        .replace(/[*]/g, '★')
        .replace(/["]/g, "'")
        .replace(/[<]/g, '《')
        .replace(/[>]/g, '》')
        .replace(/[|]/g, '—')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

function archiveFile(jsonPath) {
    const project = resolveProjectInfo();
    if (!fs.existsSync(jsonPath)) {
        console.log(`⚠️ 文件未找到: ${jsonPath}`);
        return 0;
    }

    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const list = JSON.parse(raw.replace(/^\uFEFF/, ''));
    console.log(`\n📄 开始处理源文件: ${path.basename(jsonPath)} (包含 ${list.length} 条记录)...`);

    let count = 0;
    for (const item of list) {
        const title = item.title || '未命名检索事件';
        const timestamp = item.dispatchedAt ?? item.completedAt;
        if (timestamp == null || Number.isNaN(new Date(timestamp).getTime())) throw new Error('A valid record timestamp is required');
        const dateObj = new Date(timestamp);
        const dateStr = formatDate(dateObj);
        const bucketStr = getTimeBucket(dateObj);

        const targetDir = path.join(BASE_OUT_DIR, project.projectIdentifier, dateStr, bucketStr);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const safeFilename = sanitizeFilename(title);
        const mdPath = path.join(targetDir, `${safeFilename}.md`);

        const convId = item.conversationUrl ? item.conversationUrl.split('/c/')[1] || item.id : item.id;
        const mdContent = [
            `# ${title}`,
            '',
            '> **元数据信息 (Metadata)**',
            `> - **会话标识 (Conversation ID)**: \`${convId}\``,
            `> - **所属时段桶 (Time Bucket)**: \`${dateStr} / ${bucketStr}\``,
            `> - **发起时间 (Dispatched At)**: ${formatDateTime(dateObj)}`,
            `> - **完成时间 (Completed At)**: ${item.completedAt ? formatDateTime(new Date(item.completedAt)) : 'N/A'}`,
            `> - **执行耗时 (Duration)**: ${item.durationSec || 'N/A'} 秒`,
            `> - **在线会话链接 (URL)**: ${item.conversationUrl || 'N/A'}`,
            `> - **状态**: ${item.status || 'done'}`,
            '',
            '---',
            '',
            '## 1. 原始提问 (User Prompt)',
            '',
            item.prompt ? item.prompt : '*[无原始问题输入]*',
            '',
            '---',
            '',
            '## 2. 联网检索轨迹 (Web Searches & Citations)',
            '',
            item.searches && item.searches.length > 0
                ? item.searches.map((s, idx) => `${idx + 1}. **[Search]**: \`${s}\``).join('\n')
                : '*[无联网搜索记录]*',
            '',
            '---',
            '',
            '## 3. 完整深度回复 (Assistant Markdown Content)',
            '',
            item.text ? item.text : '*[回复内容为空]*',
            ''
        ].join('\n');

        writeArchive(mdPath, mdContent);
        console.log(`   💾 已归档: ${dateStr}\\${bucketStr}\\${safeFilename}.md (${item.text?.length || 0} 字)`);
        count++;
    }
    return count;
}

function main() {
    console.log('================================================================');
    console.log('📦 本地测试大盘结果集 4h 分层规整归档引擎');
    console.log('================================================================');

    if (process.argv.includes('--help')) { console.log('archive --input FILE [--project PATH] [--project-id ID]'); return; }
    const input = option('--input');
    if (!input) throw new Error('Explicit --input required; no automatic historical re-import');
    const JSON_FILES = [path.resolve(input)];
    let total = 0;
    for (const f of JSON_FILES) {
        total += archiveFile(f);
    }

    console.log('\n================================================================');
    console.log(`🎉 离线测试结果集规整完成！共生成/更新 ${total} 份 Markdown 文档。`);
    console.log('================================================================\n');
}

if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { archiveFile, main };
