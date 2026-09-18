'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 工业级零覆盖原子发布引擎 (Staging-and-Atomic-Publish Engine)
// 依据 GPT-6 Astra 架构审查裁定重构：消除半文件可见与写入中断残留
function writeArchive(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const bytes = Buffer.from(content, 'utf8');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  let candidate = file;
  for (let attempt = 0; attempt < 100; attempt++) {
    // 幂等快速检查
    if (fs.existsSync(candidate)) {
      try {
        const existingBytes = fs.readFileSync(candidate);
        if (existingBytes.equals(bytes)) {
          return { path: candidate, created: false, sha256: hash, bytes: bytes.length };
        }
      } catch (_) {
        // 读取并发异常时继续按冲突派生流程处理
      }
      // 目标存在且内容不同：生成带完整 SHA-256 前缀的新候选文件名
      const ext = path.extname(file);
      candidate = file.slice(0, file.length - ext.length) + '--' + hash.slice(0, 16) + (attempt ? '-' + attempt : '') + ext;
      continue;
    }

    // 步骤 1: 写入隐藏临时暂存文件
    const nonce = crypto.randomBytes(4).toString('hex');
    const tempName = `.${path.basename(candidate)}.tmp.${process.pid}.${Date.now()}.${nonce}`;
    const tempPath = path.join(dir, tempName);

    let fd;
    try {
      fd = fs.openSync(tempPath, 'wx');
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } catch (err) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(tempPath); } catch (_) {}
      throw err;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    }

    // 步骤 2: 安全原子提升至正式目标路径
    try {
      if (fs.existsSync(candidate)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
        const existingBytes = fs.readFileSync(candidate);
        if (existingBytes.equals(bytes)) {
          return { path: candidate, created: false, sha256: hash, bytes: bytes.length };
        }
        const ext = path.extname(file);
        candidate = file.slice(0, file.length - ext.length) + '--' + hash.slice(0, 16) + (attempt ? '-' + attempt : '') + ext;
        continue;
      }

      fs.renameSync(tempPath, candidate);
      return { path: candidate, created: true, sha256: hash, bytes: bytes.length };
    } catch (renameErr) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
      const ext = path.extname(file);
      candidate = file.slice(0, file.length - ext.length) + '--' + hash.slice(0, 16) + (attempt ? '-' + attempt : '') + ext;
    }
  }

  throw new Error('Too many archive filename collisions');
}
module.exports = { writeArchive };
