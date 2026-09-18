/**
 * sync_search_history.js
 * 
 * 核心职责：
 * 1. 支持自动推导项目物理路径或接收 --project 参数指定归属项目分类；
 * 2. 借道真实 Chrome 实例 (默认 Port 9225，备选 9222/9223) 执行 in-browser evaluate;
 * 3. 从 OpenAI 官方后端接口抓取完整会话历史 (/backend-api/conversations) 与详情 (/backend-api/conversation/{id});
 * 4. 准确提取 GPT 官方自动生成的 Title、Prompt、未截断 Assistant Markdown 原文与检索轨迹;
 * 5. 自动按 24h 每 4h 进行分桶计算 (00h-04h, 04h-08h, 08h-12h, 12h-16h, 16h-20h, 20h-24h);
 * 6. 处理 Windows 非法字符转义与 "New chat" 智能语义回退兜底;
 * 7. 写入规范三层拓扑: C:\GPT-Chat-codex-handoff\PassSearchHistory\[项目分类]\[YYYY-MM-DD]\[HHh-HHh]\[事件标题].md
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveProjectInfo } = require('../lib/runtime-config');
const { writeArchive } = require('../lib/archive-write');
const { buildAllIndexes } = require('./index_builder');

const BASE_OUT_DIR = loadConfig().historyRoot;
const CDP_PORTS = loadConfig().cdpPorts;

// 双轨自适应项目地址解析引擎

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

function fallbackTitleFromPrompt(prompt) {
    if (!prompt) return '未命名检索任务';
    let clean = prompt
        .replace(/^(请联网搜索并深入分析[：:]?|请深入分析[：:]?|请分析[：:]?|请问|请检索|请搜索)/g, '')
        .replace(/^[、，。\s]+/, '')
        .trim();
    const match = clean.match(/^([^，。！？\n]{4,30})/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return clean.slice(0, 25).trim() || '未命名检索任务';
}

async function findActiveCdpPage() {
    for (const port of CDP_PORTS) {
        try {
            const listRes = await fetch(`http://127.0.0.1:${port}/json`);
            if (!listRes.ok) continue;
            const tabs = await listRes.json();
            const page = tabs.find(t => t.type === 'page' && t.url && t.url.includes('chatgpt.com'));
            if (page) {
                console.log(`🔌 成功发现活跃 CDP 页面: Port ${port}, URL: ${page.url}`);
                return { port, page };
            }
        } catch (e) {}
    }
    throw new Error(`未在端口 ${CDP_PORTS.join(', ')} 发现存活且打开 chatgpt.com 的 Chrome 实例！`);
}

function cdpEvaluate(wsUrl, expression) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('CDP Evaluate Timeout (30s)'));
        }, 30000);

        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: 101,
                method: 'Runtime.evaluate',
                params: {
                    expression,
                    awaitPromise: true,
                    returnByValue: true
                }
            }));
        };

        ws.onmessage = (e) => {
            clearTimeout(timer);
            try {
                const data = JSON.parse(e.data);
                if (data.id === 101) {
                    ws.close();
                    resolve(data.result?.result?.value);
                }
            } catch (err) {
                ws.close();
                reject(err);
            }
        };

        ws.onerror = (err) => {
            clearTimeout(timer);
            reject(err);
        };
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) { console.log('sync [--project PATH] [--project-id ID]'); return; }
    let customProject = null;
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
            customProject = args[i + 1];
            i++;
        }
    }

    const projectInfo = resolveProjectInfo(customProject);

    console.log('================================================================');
    console.log('🚀 GPT-Chat-Codex 历史搜索呈现与【项目-4h时段-标题】同步引擎');
    console.log(`📁 归属项目: [${projectInfo.projectIdentifier}] (${projectInfo.projectFullPath})`);
    console.log(`📂 归档根目录: ${BASE_OUT_DIR}\\${projectInfo.projectIdentifier}`);
    console.log('================================================================\n');

    const projectBaseDir = path.join(BASE_OUT_DIR, projectInfo.projectIdentifier);
    if (!fs.existsSync(projectBaseDir)) {
        fs.mkdirSync(projectBaseDir, { recursive: true });
    }

    const { port, page } = await findActiveCdpPage();

    console.log('📡 正在通过 in-browser evaluate 提取近期的会话元数据列表...');
    const listScript = `
        (async () => {
            const session = await fetch('/api/auth/session').then(r => r.json());
            const token = session.accessToken;
            if (!token) return { error: 'No accessToken found in session' };

            const res = await fetch('/backend-api/conversations?offset=0&limit=50&order=updated', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return { error: 'Conversations API status ' + res.status };
            const data = await res.json();
            return {
                user: session.user?.email,
                items: data.items || []
            };
        })()
    `;

    const listResult = await cdpEvaluate(page.webSocketDebuggerUrl, listScript);
    if (!listResult || listResult.error) {
        throw new Error(`获取会话列表失败: ${listResult?.error || '未知错误'}`);
    }

    const conversations = listResult.items;
    console.log(`✅ 成功获取用户 [${listResult.user}] 的近期会话列表，共计 ${conversations.length} 条！\n`);

    let syncCount = 0;
    let skipCount = 0;

    for (let i = 0; i < conversations.length; i++) {
        const item = conversations[i];
        const convId = item.id;
        const rawTitle = (item.title || '').trim();
        const createEpoch = item.create_time ? new Date(item.create_time).getTime() / 1000 : Date.now() / 1000;
        const createDate = new Date(createEpoch * 1000);
        const updateEpoch = item.update_time ? new Date(item.update_time).getTime() / 1000 : createEpoch;
        const updateDate = new Date(updateEpoch * 1000);

        const dateDirName = formatDate(createDate);
        const timeBucket = getTimeBucket(createDate);
        const targetBucketDir = path.join(projectBaseDir, dateDirName, timeBucket);

        console.log(`[${i + 1}/${conversations.length}] 🔍 正在同步会话 [${convId.slice(0, 8)}] 原始标题: "${rawTitle}" (时间: ${formatDateTime(createDate)})`);

        const detailScript = `
            (async () => {
                const session = await fetch('/api/auth/session').then(r => r.json());
                const token = session.accessToken;
                const res = await fetch('/backend-api/conversation/${convId}', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) return { ok: false, status: res.status };
                const data = await res.json();
                
                const mapping = data.mapping || {};
                let userPrompt = '';
                let assistantText = '';
                const searches = [];

                for (const key in mapping) {
                    const node = mapping[key];
                    const msg = node.message;
                    if (!msg) continue;

                    const role = msg.author?.role;
                    if (role === 'user' && !userPrompt) {
                        const parts = msg.content?.parts || [];
                        userPrompt = parts.filter(p => typeof p === 'string').join('\\n');
                    } else if (role === 'assistant') {
                        const parts = msg.content?.parts || [];
                        const text = parts.filter(p => typeof p === 'string').join('\\n');
                        if (text.length > assistantText.length) {
                            assistantText = text;
                        }
                    } else if (role === 'tool') {
                        const toolName = msg.author?.name;
                        searches.push({
                            tool: toolName,
                            content: (msg.content?.text || '').slice(0, 200)
                        });
                    }
                }

                return {
                    ok: true,
                    title: data.title,
                    userPrompt: userPrompt,
                    assistantText: assistantText,
                    searches: searches
                };
            })()
        `;

        try {
            const detail = await cdpEvaluate(page.webSocketDebuggerUrl, detailScript);
            if (!detail || !detail.ok) {
                console.log(`   ⚠️ 无法获取会话详情 (状态: ${detail?.status || 'Null'})，跳过。`);
                skipCount++;
                continue;
            }

            let finalTitle = rawTitle;
            let isFallback = false;
            if (!finalTitle || finalTitle === 'New chat' || finalTitle === '新会话') {
                finalTitle = fallbackTitleFromPrompt(detail.userPrompt);
                isFallback = true;
            }

            const safeFilename = sanitizeFilename(finalTitle);
            if (!fs.existsSync(targetBucketDir)) {
                fs.mkdirSync(targetBucketDir, { recursive: true });
            }

            const mdFilePath = path.join(targetBucketDir, `${safeFilename}.md`);

            const markdownContent = [
                `# ${finalTitle}`,
                '',
                '> **元数据信息 (Metadata)**',
                `> - **会话标识 (Conversation ID)**: \`${convId}\``,
                `> - **所属开发项目 (Project)**: \`${projectInfo.projectIdentifier}\``,
                `> - **项目物理地址 (Project Path)**: \`${projectInfo.projectFullPath}\``,
                `> - **官方生成标题**: ${rawTitle || '无'} ${isFallback ? '*(触发 Prompt 智能自愈命名)*' : ''}`,
                `> - **创建时间 (Created At)**: ${formatDateTime(createDate)} (时区: 本地时间)`,
                `> - **更新时间 (Updated At)**: ${formatDateTime(updateDate)}`,
                `> - **所属时段桶 (Time Bucket)**: \`${dateDirName} / ${timeBucket}\``,
                `> - **在线会话链接 (URL)**: https://chatgpt.com/c/${convId}`,
                `> - **字数统计**: Prompt: ${detail.userPrompt.length} 字 | 回复: ${detail.assistantText.length} 字`,
                '',
                '---',
                '',
                '## 1. 原始提问 (User Prompt)',
                '',
                detail.userPrompt ? detail.userPrompt : '*[无用户输入内容]*',
                '',
                '---',
                '',
                '## 2. 联网检索轨迹 (Web Searches & Tools)',
                '',
                detail.searches && detail.searches.length > 0
                    ? detail.searches.map((s, idx) => `${idx + 1}. **[${s.tool || 'WebSearch'}]**: \`${s.content.replace(/\n/g, ' ')}\``).join('\n')
                    : '*[无工具或外部检索调用]*',
                '',
                '---',
                '',
                '## 3. 完整深度回复 (Assistant Markdown Content)',
                '',
                detail.assistantText ? detail.assistantText : '*[回复内容为空或生成被安全拦截]*',
                ''
            ].join('\n');

            writeArchive(mdFilePath, markdownContent);
            console.log(`   💾 已成功落盘: ${projectInfo.projectIdentifier}\\${dateDirName}\\${timeBucket}\\${safeFilename}.md (${detail.assistantText.length} 字)`);
            syncCount++;

            await new Promise(r => setTimeout(r, 600));
        } catch (err) {
            console.error(`   ❌ 同步会话 [${convId}] 异常:`, err.message);
            skipCount++;
        }
    }

    console.log('\n================================================================');
    console.log(`🎉 历史会话同步与项目分层归档已全部完成！`);
    console.log(`📊 统计: 成功归档 ${syncCount} 篇 | 跳过/失败 ${skipCount} 篇`);
    console.log(`📂 存储根路径: ${projectBaseDir}`);
    console.log('================================================================\n');

    // 自动刷新全局与项目级索引
    try {
        buildAllIndexes();
    } catch (e) {}
}

if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1; });
module.exports = { main };
