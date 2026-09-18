'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const artifactsDir = path.join(repoRoot, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

test('Test 03.1: Verify Git Worktree creates an isolated shadow sandbox without dirtying main workspace', () => {
  const shadowDir = path.join(artifactsDir, `shadow-test-${Date.now()}`);
  const branchName = `shadow-branch-${Date.now()}`;

  try {
    // 1. Check main workspace status before
    const statusBefore = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();

    // 2. Add git worktree
    const addResult = spawnSync('git', ['worktree', 'add', '-b', branchName, shadowDir, 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(addResult.status, 0, `git worktree add failed: ${addResult.stderr}`);
    assert.ok(fs.existsSync(shadowDir), 'Shadow worktree directory must exist');

    // 3. Intentionally introduce a corrupted file and a modified file in the shadow directory
    fs.writeFileSync(path.join(shadowDir, 'corrupted_file.txt'), 'Simulated hallucinated broken patch');
    fs.appendFileSync(path.join(shadowDir, 'package.json'), '\n// corrupted syntax');

    // 4. Assert: Main workspace must NOT see any of these modifications!
    const statusAfterInMain = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
    assert.equal(statusAfterInMain, statusBefore, 'Main workspace must remain 100% untouched and clean!');
    console.log('[CONFIRMED]: Git Worktree shadow sandbox completely isolates malformed patches from active working tree.');

  } finally {
    // Clean up worktree
    spawnSync('git', ['worktree', 'remove', '--force', shadowDir], { cwd: repoRoot, windowsHide: true });
    spawnSync('git', ['branch', '-D', branchName], { cwd: repoRoot, windowsHide: true });
    if (fs.existsSync(shadowDir)) {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    }
  }
});

test('Test 03.2: Verify Windows taskkill /T /F terminates runaway test processes and child process trees', async () => {
  // Spawn a child process running an infinite loop (simulating broken AI code: while(true){})
  const runaway = spawn(process.execPath, ['-e', 'while(true){}'], {
    windowsHide: true,
    detached: false,
  });

  const pid = runaway.pid;
  assert.ok(pid > 0, 'Child process must be running');
  console.log(`[Spawned runaway loop process PID]: ${pid}`);

  // Let it spin for 500ms
  await new Promise(r => setTimeout(r, 500));

  // Perform Windows taskkill /T (process tree) /F (force)
  const killResult = spawnSync('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  console.log(`[Taskkill Output]:`, killResult.stdout.trim());

  assert.equal(killResult.status, 0, 'taskkill must successfully terminate the process tree');

  // Verify process is truly dead
  await new Promise(r => setTimeout(r, 300));
  const checkProc = spawnSync('tasklist', ['/FI', `PID eq ${pid}`], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.ok(!checkProc.stdout.includes(pid.toString()), 'Process must no longer exist in Windows tasklist');
  console.log('[CONFIRMED]: taskkill /T /F successfully hard-kills runaway process trees and prevents zombie worker file locking.');
});
