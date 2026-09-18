'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  scanProjectDirectory,
  renderAsciiTray,
  generateCodeGraphJson
} = require('../../pipeline/index_builder');

test('index_builder: scanProjectDirectory detects companion .outputs directories and manifests', () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-project-'));
  const dateDir = path.join(tmpProject, '2026-09-14', '20h-24h');
  fs.mkdirSync(dateDir, { recursive: true });

  const mdFile = path.join(dateDir, 'Deep-Architecture-Review.md');
  const mdContent = [
    '# Deep Architecture Review',
    '',
    '> **元数据信息 (Metadata)**',
    '> - **会话标识 (Conversation ID)**: `conv-test-999`',
    '> - **创建时间 (Created At)**: 2026-09-14 21:00:00 (时区: 本地时间)',
    '> - **在线会话链接 (URL)**: https://chatgpt.com/c/conv-test-999',
    '> - **字数统计**: Prompt: 100 字 | 回复: 15000 字',
    '',
    '## 1. 原始提问',
    '请深度分析架构',
    '---',
    '## 3. 完整回复',
    '系统架构分析正文...'
  ].join('\n');
  fs.writeFileSync(mdFile, mdContent, 'utf-8');

  // Create companion .outputs/ folder with manifest
  const outputsDir = path.join(dateDir, 'Deep-Architecture-Review.outputs');
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.writeFileSync(path.join(outputsDir, 'architecture-spec.md'), '# Architecture Spec', 'utf-8');
  fs.writeFileSync(path.join(outputsDir, 'manifest.json'), JSON.stringify({
    downloadedAt: new Date().toISOString(),
    filename: 'architecture-spec.md',
    bytes: 19,
    sha256: 'abc123def456'
  }), 'utf-8');

  const { dates, totalDocs, totalWords } = scanProjectDirectory(tmpProject);
  assert.equal(totalDocs, 1);
  assert.equal(totalWords, 15000);
  assert.equal(dates.length, 1);

  const doc = dates[0].buckets[0].docs[0];
  assert.equal(doc.title, 'Deep Architecture Review');
  assert.ok(doc.outputs, 'Must have outputs object');
  assert.equal(doc.outputs.count, 1);
  assert.equal(doc.outputs.manifest.filename, 'architecture-spec.md');
  assert.equal(doc.outputs.manifest.sha256, 'abc123def456');

  // Verify ASCII Tray Rendering includes output badge
  const tray = renderAsciiTray('TestProject', dates);
  assert.ok(tray.includes('📦 [Outputs: 1 个实体]'), 'ASCII tray must contain output badge');

  // Verify CodeGraph contains Document, Artifact node and HAS_ARTIFACT edge
  const graph = generateCodeGraphJson('TestProject', tmpProject, dates, totalDocs, totalWords);
  const docNode = graph.nodes.find(n => n.type === 'Document');
  assert.ok(docNode);
  assert.equal(docNode.hasOutputs, true);
  assert.equal(docNode.outputsCount, 1);

  const artifactNode = graph.nodes.find(n => n.type === 'Artifact');
  assert.ok(artifactNode, 'Must contain Artifact node in graph');
  assert.equal(artifactNode.label, 'architecture-spec.md');
  assert.equal(artifactNode.count, 1);
  assert.equal(artifactNode.sha256, 'abc123def456');

  const artifactEdge = graph.edges.find(e => e.relation === 'HAS_ARTIFACT');
  assert.ok(artifactEdge, 'Must contain HAS_ARTIFACT edge in graph');
  assert.equal(artifactEdge.source, docNode.id);
  assert.equal(artifactEdge.target, artifactNode.id);

  fs.rmSync(tmpProject, { recursive: true, force: true });
});
