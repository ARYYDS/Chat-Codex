import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeUploadFiles, stageUploadFiles } from "../src/chatgpt-upload.mjs";

const dir = mkdtempSync(join(tmpdir(), "chatgpt-upload-"));

try {
  const filePath = join(dir, "upload-note.txt");
  writeFileSync(filePath, "upload metadata proof\n");

  const [record] = describeUploadFiles([filePath]);
  assert.equal(record.name, "upload-note.txt");
  assert.equal(record.bytes, 22);
  assert.equal(typeof record.sha256, "string");
  assert.equal(record.sha256.length, 64);

  const staged = stageUploadFiles([filePath], {
    stageDir: join(dir, "uploads"),
    stamp: "2026-06-17T07-41-00-000Z",
  });
  assert.equal(staged.length, 1);
  assert.equal(staged[0].name, "upload-note.2026-06-17T07-41-00-000Z.txt");
  assert.equal(staged[0].original.name, "upload-note.txt");
  assert.equal(staged[0].original.sha256, record.sha256);
  assert.notEqual(staged[0].sha256, record.sha256);
  assert.equal(existsSync(staged[0].path), true);
  const stagedText = readFileSync(staged[0].path, "utf8");
  assert.match(stagedText, /chatgpt-pro-codex staged upload metadata/);
  assert.match(stagedText, /original-sha256:/);
  assert.doesNotMatch(stagedText, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(stagedText, /original-path: \//);
  assert.match(stagedText, /upload metadata proof/);

  assert.throws(
    () => describeUploadFiles([join(dir, "missing.txt")]),
    /Upload file does not exist/,
  );

  const subdir = join(dir, "folder");
  mkdirSync(subdir);
  assert.throws(
    () => describeUploadFiles([subdir]),
    /Upload path is not a file/,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "upload-metadata" }, null, 2));
