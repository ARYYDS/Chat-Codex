/**
 * index_builder.js
 * 
 * ==============================================================================
 * 自动化索引编排引擎 (Dual-Mode: ASCII 树状 README.md + CodeGraph 拓扑 JSON)
 * ==============================================================================
 * 
 * 核心功能：
 * 1. 自动递归扫描 PassSearchHistory 下的各项目分类目录；
 * 2. 解析所有最底层 .md 文件的 Frontmatter 元数据 (官方标题、字数、耗时、创建时间、会话链接)；
 * 3. 生成精致的 ASCII / Unicode Box-Drawing 文件托盘图 (细化到具体 markdown 文件)；
 * 4. 生成 CodeGraph / GraphRAG 标准知识图谱 schema (nodes & edges)；
 * 5. 自动编译落盘至 [项目分类]/README.md、[项目分类]/codegraph.json 以及全局根索引；
 * 6. 物理磁盘增删自愈：支持随时重扫，无缝识别文件新增、删除与重命名。
 */

const fs = require('fs');
const path = require('path');

const { loadConfig, projectId } = require('../lib/runtime-config');
const BASE_DIR = loadConfig().historyRoot;

function atomicWriteFileSync(targetPath, content) {
    const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, targetPath);
}

// 解析单个 Markdown 文件的元数据
function parseMarkdownMetadata(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const filename = path.basename(filePath);
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/, '');

        const convIdMatch = content.match(/会话标识[^`]*`([^`]+)`/);
        const convId = convIdMatch ? convIdMatch[1] : '';

        const createTimeMatch = content.match(/创建时间[^:]*:\s*([^\n\r]+)/);
        const createTimeStr = createTimeMatch ? createTimeMatch[1].replace(/\(时区.*?\)/, '').trim() : '';

        const urlMatch = content.match(/在线会话链接[^:]*:\s*(https:\/\/chatgpt\.com\/c\/[^\s\n\r]+)/);
        const convUrl = urlMatch ? urlMatch[1] : '';

        const wordCountMatch = content.match(/回复:\s*(\d+)\s*字/);
        const wordCount = wordCountMatch ? parseInt(wordCountMatch[1], 10) : content.length;

        // 提取前 3 个核心关键词作为 Topic Tags
        const keywords = [];
        const promptMatch = content.match(/## 1\. 原始提问[\s\S]*?\n\n([\s\S]*?)\n\n---/);
        const prompt = promptMatch ? promptMatch[1].trim() : '';
        const techTerms = ['CDP', 'VSS', 'SQLite', 'WAL', 'DPAPI', 'App-Bound', 'Turnstile', 'Sentinel', 'JA4', 'PoW', 'WAF', 'Agent', 'LevelDB', 'Ephemeral Tab', 'SO_REUSEADDR', 'SO_EXCLUSIVEADDRUSE', 'DELEGATED_TO_LOCAL', '本地接管'];
        for (const term of techTerms) {
            if (content.includes(term) || prompt.includes(term)) {
                keywords.push(term);
            }
        }

        // 探测伴生 outputs 资源箱
        const outputsDir = filePath.replace(/\.md$/, '.outputs');
        let outputs = null;
        if (fs.existsSync(outputsDir) && fs.statSync(outputsDir).isDirectory()) {
            const manifestPath = path.join(outputsDir, 'manifest.json');
            let manifest = null;
            if (fs.existsSync(manifestPath)) {
                try {
                    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                } catch (_) {}
            }
            const files = fs.readdirSync(outputsDir).filter(f => !f.endsWith('.tmp') && !f.endsWith('.crdownload'));
            outputs = {
                dir: outputsDir,
                count: files.filter(f => f !== 'manifest.json').length,
                files,
                manifest
            };
        }

        return {
            filename,
            title,
            filePath,
            convId,
            createTimeStr,
            convUrl,
            wordCount,
            keywords: keywords.slice(0, 5),
            outputs
        };
    } catch (e) {
        return null;
    }
}

// 扫描某个项目目录下的全部时段与 Markdown 文件
function scanProjectDirectory(projectDir) {
    const dates = [];
    if (!fs.existsSync(projectDir)) return { dates, totalDocs: 0, totalWords: 0 };

    const dateEntries = fs.readdirSync(projectDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
        .sort((a, b) => b.name.localeCompare(a.name)); // 按日期倒序

    let totalDocs = 0;
    let totalWords = 0;

    for (const d of dateEntries) {
        const dateStr = d.name;
        const datePath = path.join(projectDir, dateStr);
        const buckets = [];

        const bucketEntries = fs.readdirSync(datePath, { withFileTypes: true })
            .filter(b => b.isDirectory() && /^\d{2}(?:h)?-\d{2}(?:h)?$/.test(b.name))
            .sort((a, b) => b.name.localeCompare(a.name)); // 时段倒序

        for (const b of bucketEntries) {
            const bucketStr = b.name;
            const bucketPath = path.join(datePath, bucketStr);
            const mdFiles = fs.readdirSync(bucketPath)
                .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
                .map(f => path.join(bucketPath, f));

            const docs = [];
            for (const f of mdFiles) {
                const meta = parseMarkdownMetadata(f);
                if (meta) {
                    meta.relativeToProject = path.relative(projectDir, f).replace(/\\/g, '/');
                    docs.push(meta);
                    totalDocs++;
                    totalWords += meta.wordCount;
                }
            }

            if (docs.length > 0) {
                // 内部按字数降序或时间排序
                docs.sort((x, y) => y.wordCount - x.wordCount);
                buckets.push({
                    bucketStr,
                    docs
                });
            }
        }

        if (buckets.length > 0) {
            dates.push({
                dateStr,
                buckets
            });
        }
    }

    return { dates, totalDocs, totalWords };
}

// 生成 ASCII / Unicode Box-Drawing 文件托盘图
function renderAsciiTray(projectName, dates) {
    const lines = [];
    lines.push(`📁 ${projectName}/`);

    dates.forEach((dateObj, dIdx) => {
        const isLastDate = dIdx === dates.length - 1;
        const datePrefix = isLastDate ? '└── ' : '├── ';
        const dateChildPrefix = isLastDate ? '    ' : '│   ';

        lines.push(`${datePrefix}📅 ${dateObj.dateStr}/`);

        dateObj.buckets.forEach((bucketObj, bIdx) => {
            const isLastBucket = bIdx === dateObj.buckets.length - 1;
            const bucketPrefix = isLastBucket ? '└── ' : '├── ';
            const bucketChildPrefix = isLastBucket ? '    ' : '│   ';

            lines.push(`${dateChildPrefix}${bucketPrefix}⏰ ${bucketObj.bucketStr}/ (${bucketObj.docs.length} 篇检索)`);

            bucketObj.docs.forEach((doc, docIdx) => {
                const isLastDoc = docIdx === bucketObj.docs.length - 1;
                const docPrefix = isLastDoc ? '└── ' : '├── ';
                const wordFormatted = doc.wordCount ? `${(doc.wordCount).toLocaleString()} 字` : '';
                const timeShort = doc.createTimeStr ? doc.createTimeStr.split(' ')[1] || '' : '';
                const timeLabel = timeShort ? ` | ${timeShort}` : '';
                const outputBadge = (doc.outputs && doc.outputs.count > 0) ? ` 📦 [Outputs: ${doc.outputs.count} 个实体]` : '';
                const link = `[${doc.title}](./${doc.relativeToProject})`;

                lines.push(`${dateChildPrefix}${bucketChildPrefix}${docPrefix}📄 ${link} (${wordFormatted}${timeLabel})${outputBadge}`);
            });
        });
    });

    return lines.join('\n');
}

// 生成 CodeGraph 图表 JSON Schema (Nodes & Edges)
function generateCodeGraphJson(projectName, projectDir, dates, totalDocs, totalWords) {
    const nodes = [];
    const edges = [];

    // 1. 项目根节点
    const projectNodeId = `project:${projectName}`;
    nodes.push({
        id: projectNodeId,
        type: 'Project',
        label: projectName,
        path: projectDir,
        totalDocs,
        totalWords,
        lastUpdated: new Date().toISOString()
    });

    // 2. 遍历日期与时段节点
    const topicNodesSet = new Set();

    dates.forEach(dateObj => {
        const dateNodeId = `date:${projectName}:${dateObj.dateStr}`;
        nodes.push({
            id: dateNodeId,
            type: 'Date',
            label: dateObj.dateStr,
            project: projectName
        });
        edges.push({
            source: projectNodeId,
            target: dateNodeId,
            relation: 'CONTAINS_DATE'
        });

        dateObj.buckets.forEach(bucketObj => {
            const bucketNodeId = `bucket:${projectName}:${dateObj.dateStr}:${bucketObj.bucketStr}`;
            nodes.push({
                id: bucketNodeId,
                type: 'TimeBucket',
                label: bucketObj.bucketStr,
                date: dateObj.dateStr,
                docCount: bucketObj.docs.length
            });
            edges.push({
                source: dateNodeId,
                target: bucketNodeId,
                relation: 'CONTAINS_BUCKET'
            });

            bucketObj.docs.forEach(doc => {
                const docNodeId = `doc:${projectName}:${doc.convId || doc.title}`;
                nodes.push({
                    id: docNodeId,
                    type: 'Document',
                    label: doc.title,
                    filename: doc.filename,
                    relativePath: doc.relativeToProject,
                    wordCount: doc.wordCount,
                    createdAt: doc.createTimeStr,
                    conversationId: doc.convId,
                    url: doc.convUrl,
                    keywords: doc.keywords,
                    hasOutputs: !!(doc.outputs && doc.outputs.count > 0),
                    outputsCount: doc.outputs ? doc.outputs.count : 0
                });
                edges.push({
                    source: bucketNodeId,
                    target: docNodeId,
                    relation: 'CONTAINS_DOCUMENT'
                });

                // 关联伴生产物资产节点
                if (doc.outputs && doc.outputs.count > 0) {
                    const artifactNodeId = `artifact:${projectName}:${doc.convId || doc.title}`;
                    nodes.push({
                        id: artifactNodeId,
                        type: 'Artifact',
                        label: doc.outputs.manifest?.filename || 'Work Outputs',
                        count: doc.outputs.count,
                        files: doc.outputs.files,
                        sha256: doc.outputs.manifest?.sha256 || null,
                        bytes: doc.outputs.manifest?.bytes || null
                    });
                    edges.push({
                        source: docNodeId,
                        target: artifactNodeId,
                        relation: 'HAS_ARTIFACT'
                    });
                }

                // 关联主题标签节点
                doc.keywords.forEach(kw => {
                    const topicNodeId = `topic:${kw}`;
                    if (!topicNodesSet.has(topicNodeId)) {
                        topicNodesSet.add(topicNodeId);
                        nodes.push({
                            id: topicNodeId,
                            type: 'Topic',
                            label: kw
                        });
                    }
                    edges.push({
                        source: docNodeId,
                        target: topicNodeId,
                        relation: 'TAGGED_WITH'
                    });
                });
            });
        });
    });

    return {
        schemaVersion: 'codegraph-v1.0',
        project: projectName,
        projectPath: projectDir,
        generatedAt: new Date().toISOString(),
        summary: {
            totalNodes: nodes.length,
            totalEdges: edges.length,
            totalDocs,
            totalWords
        },
        nodes,
        edges
    };
}

// 为单个项目构建并落盘 README.md 与 codegraph.json
function buildProjectIndex(projectName) {
    projectId(projectName);
    const projectDir = path.join(BASE_DIR, projectName);
    if (!fs.existsSync(projectDir)) return;

    console.log(`🔨 正在构建项目 [${projectName}] 的自动化索引与 CodeGraph...`);
    const { dates, totalDocs, totalWords } = scanProjectDirectory(projectDir);

    const now = new Date();
    const updateTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    // 1. 生成 ASCII 托盘图
    const asciiTray = renderAsciiTray(projectName, dates);

    // 2. 生成结构化明细表格
    const tableRows = [];
    dates.forEach(d => {
        d.buckets.forEach(b => {
            b.docs.forEach(doc => {
                const link = `[${doc.title}](./${doc.relativeToProject})`;
                const kwTags = doc.keywords.map(k => `\`#${k}\``).join(' ');
                const outputCell = (doc.outputs && doc.outputs.count > 0) ? `📦 \`${doc.outputs.count} 个实体\`` : '-';
                tableRows.push(`| ${link} | \`${d.dateStr} / ${b.bucketStr}\` | **${doc.wordCount.toLocaleString()}** | ${outputCell} | ${doc.createTimeStr} | ${kwTags || '-'} |`);
            });
        });
    });

    // 3. 组装 README.md 内容
    const readmeContent = [
        `# 📁 项目历史搜索成果索引库：${projectName}`,
        '',
        `> **项目全景概览 (Project Dashboard)**`,
        `> - **项目名称 (Identifier)**: \`${projectName}\``,
        `> - **归属根目录 (Path)**: \`${projectDir}\``,
        `> - **索引刷新时间 (Last Updated)**: \`${updateTimeStr}\``,
        `> - **累计归档文献**: **${totalDocs}** 篇`,
        `> - **累计技术字数**: **${totalWords.toLocaleString()}** 字`,
        `> - **双模索引资产**: [ASCII 托盘图](#1-文件托盘结构图-ascii-tray-map) | [CodeGraph 拓扑 JSON](./codegraph.json)`,
        '',
        '---',
        '',
        '## 1. 文件托盘结构图 (ASCII Tray Map)',
        '',
        '以下为本项目历史检索成果的层级树状拓扑图，已细化罗列至最底层的 `.md` 具体标题与字数：',
        '',
        '```text',
        asciiTray,
        '```',
        '',
        '---',
        '',
        '## 2. 成果文献结构化检索大盘 (Document Registry)',
        '',
        '| 文献标题 (点击跳转) | 所属时段桶 (24h/4h) | 技术字数 | 伴生产物 | 归档时间 | 核心技术标签 |',
        '| :--- | :---: | :---: | :---: | :---: | :--- |',
        tableRows.length > 0 ? tableRows.join('\n') : '| *暂无成果文献* | - | - | - | - | - |',
        '',
        '---',
        '',
        '## 3. CodeGraph 图表知识图谱模型',
        '',
        '本项目已同步生成符合 GraphRAG / CodeGraph 标准规范的图谱模型文件：',
        `- **图模型文件**: [\`codegraph.json\`](./codegraph.json)`,
        `- **图谱构成**: 节点包含 \`Project\`、\`Date\`、\`TimeBucket\`、\`Document\`、\`Artifact\`、\`Topic\`；边包含 \`CONTAINS_DATE\`、\`CONTAINS_BUCKET\`、\`CONTAINS_DOCUMENT\`、\`HAS_ARTIFACT\`、\`TAGGED_WITH\``,
        '- **机器检索优势**: 外部 Agent 或自动化脚本无需加载万字 Markdown 原文，解析 `codegraph.json` 即可微秒级完成跨时段知识检索与拓扑回溯。',
        ''
    ].join('\n');

    // 原子发布 README.md
    const readmePath = path.join(projectDir, 'README.md');
    atomicWriteFileSync(readmePath, readmeContent);

    // 4. 生成并原子发布 codegraph.json
    const graphData = generateCodeGraphJson(projectName, projectDir, dates, totalDocs, totalWords);
    const graphPath = path.join(projectDir, 'codegraph.json');
    atomicWriteFileSync(graphPath, JSON.stringify(graphData, null, 2));

    console.log(`   ✨ 已生成 [${projectName}/README.md] (含 ${totalDocs} 篇精细条目) 与 [${projectName}/codegraph.json]`);
    return { projectName, totalDocs, totalWords };
}

// 构建 PassSearchHistory 根目录的全局总索引
function buildGlobalMasterIndex(projectSummaries) {
    console.log(`🌐 正在生成全局总索引 PassSearchHistory/README.md ...`);

    let globalDocs = 0;
    let globalWords = 0;
    const projectCards = [];

    projectSummaries.forEach(ps => {
        globalDocs += ps.totalDocs;
        globalWords += ps.totalWords;
        projectCards.push(`- 📂 **[${ps.projectName}](./${ps.projectName}/README.md)**: 累计 **${ps.totalDocs}** 篇深度检索 | **${ps.totalWords.toLocaleString()}** 字 | [查看知识图谱](./${ps.projectName}/codegraph.json)`);
    });

    const now = new Date();
    const updateTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const globalReadmeContent = [
        '# 🏛️ PassSearchHistory 全局历史搜索成果索引中心',
        '',
        '> **全站知识图谱总览 (Global Knowledge Gateway)**',
        `> - **管理项目总数**: **${projectSummaries.length}** 个开发项目`,
        `> - **全站总归档文献**: **${globalDocs}** 篇深度调研成果`,
        `> - **全站总技术字数**: **${globalWords.toLocaleString()}** 字`,
        `> - **最近自动编排时间**: \`${now.toLocaleString()}\``,
        '',
        '---',
        '',
        '## 1. 活跃开发项目索引清单',
        '',
        projectCards.join('\n'),
        '',
        '---',
        '',
        '## 2. 存储拓扑结构规范',
        '',
        '```text',
        'PassSearchHistory/',
        '├── README.md                          <-- [全局索引中心] (本文档)',
        '│',
        ...projectSummaries.map((ps, idx) => {
            const isLast = idx === projectSummaries.length - 1;
            const prefix = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';
            return [
                `${prefix}${ps.projectName}/`,
                `${childPrefix}├── README.md                  <-- [项目精细 ASCII 托盘图与索引大盘]`,
                `${childPrefix}├── codegraph.json              <-- [项目 CodeGraph 图表知识图谱]`,
                `${childPrefix}└── YYYY-MM-DD/HHh-HHh/*.md     <-- [24h/4h 分层 Markdown 原文]`
            ].join('\n');
        }),
        '```',
        '',
        '---',
        '',
        '## 3. 双模自愈编排机制说明',
        '- **自动编排**: 任何新任务经由 `auto_chat_pipeline.js` 或 `sync_search_history.js` 落盘后，自动触发本索引刷新；',
        '- **物理自愈**: 直接扫描物理文件系统，任意手动新增、删除、移动 `.md` 文件均会在下次触发时自动自愈，彻底杜绝死链。',
        ''
    ].join('\n');

    atomicWriteFileSync(path.join(BASE_DIR, 'README.md'), globalReadmeContent);
    console.log(`   ✨ 全局总索引生成完毕: PassSearchHistory/README.md`);
}

// 供外部全量调用的入口函数
function buildAllIndexes() {
    if (!fs.existsSync(BASE_DIR)) {
        console.log(`⚠️ 目录不存在: ${BASE_DIR}`);
        return [];
    }

    const projects = fs.readdirSync(BASE_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !/^\d{4}-\d{2}-\d{2}$/.test(d.name))
        .map(d => d.name);

    console.log(`================================================================`);
    console.log(`🚀 开始扫描并自动化编排全部项目索引 (共 ${projects.length} 个项目)`);
    console.log(`================================================================`);

    const summaries = [];
    for (const p of projects) {
        const res = buildProjectIndex(p);
        if (res) summaries.push(res);
    }

    buildGlobalMasterIndex(summaries);

    console.log(`================================================================`);
    console.log(`🎉 索引自动化编排与 CodeGraph 知识图谱已全部构建完成！`);
    console.log(`================================================================\n`);
    return summaries;
}

// 供单项目触发调用的入口函数
function updateProjectIndex(projectName) {
    if (!projectName) return;
    const res = buildProjectIndex(projectName);
    // 同时刷新全局总索引
    const projects = fs.readdirSync(BASE_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !/^\d{4}-\d{2}-\d{2}$/.test(d.name))
        .map(d => d.name);
    const summaries = projects.map(p => {
        const { totalDocs, totalWords } = scanProjectDirectory(path.join(BASE_DIR, p));
        return { projectName: p, totalDocs, totalWords };
    });
    buildGlobalMasterIndex(summaries);
    return res;
}

// CLI 直接运行支持
if (require.main === module) {
    const args = process.argv.slice(2);
    let targetProject = null;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
            targetProject = args[i + 1];
            i++;
        }
    }

    if (args.includes('--help')) {
        console.log('index [--project PROJECT_ID]');
    } else if (targetProject) {
        updateProjectIndex(targetProject);
    } else {
        buildAllIndexes();
    }
}

module.exports = {
    buildAllIndexes,
    updateProjectIndex,
    buildProjectIndex,
    scanProjectDirectory,
    renderAsciiTray,
    generateCodeGraphJson
};
