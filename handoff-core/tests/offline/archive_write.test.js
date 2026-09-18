'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeArchive } = require('../../lib/archive-write');

test('archive-write: atomic staging and idempotence', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
  try {
    const target = path.join(tmpDir, 'report.md');
    const contentA = '# Report Version A';
    const contentB = '# Report Version B (different)';

    // 1. 首次写入
    const r1 = writeArchive(target, contentA);
    assert.equal(r1.created, true);
    assert.equal(r1.path, target);
    assert.equal(fs.readFileSync(target, 'utf8'), contentA);

    // 验证没有残留临时文件
    const files1 = fs.readdirSync(tmpDir);
    assert.equal(files1.filter(f => f.startsWith('.')).length, 0);

    // 2. 相同内容重复写入 (幂等)
    const r2 = writeArchive(target, contentA);
    assert.equal(r2.created, false);
    assert.equal(r2.path, target);
    assert.equal(fs.readFileSync(target, 'utf8'), contentA);

    // 3. 不同内容冲突写入 (零覆盖，派生新分支)
    const r3 = writeArchive(target, contentB);
    assert.equal(r3.created, true);
    assert.notEqual(r3.path, target);
    assert.ok(r3.path.includes('--'));
    assert.equal(fs.readFileSync(target, 'utf8'), contentA, '原文件内容绝对不被覆盖');
    assert.equal(fs.readFileSync(r3.path, 'utf8'), contentB, '冲突文件内容完整保存');

    // 验证没有残留临时文件
    const files2 = fs.readdirSync(tmpDir);
    assert.equal(files2.filter(f => f.startsWith('.')).length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
