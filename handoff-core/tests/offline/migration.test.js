'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = path.resolve(__dirname, '../..');
const artifacts = path.join(core, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const fixture = fs.mkdtempSync(path.join(artifacts, 'migration-test-'));
const config = {
  codeRoot: core, runtimeRoot: fixture, historyRoot: path.join(fixture, 'history'),
  runsRoot: path.join(fixture, 'runs'), workersRoot: path.join(fixture, 'workers'),
  masterProfile: path.join(fixture, 'master'), projectPath: core,
  archiveProjectId: 'GPT-Chat-codex-handoff', projectAliases: [path.dirname(core)],
  cdpPorts: [19225], chromePath: process.execPath,
};
const configPath = path.join(fixture, 'runtime.json');
fs.writeFileSync(configPath, JSON.stringify(config));
const env = { ...process.env, HANDOFF_CONFIG: configPath };
delete env.HANDOFF_PROJECT_ID;
delete env.HANDOFF_PROJECT_PATH;
function run(args, cwd = fixture) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('project identity and archive root survive cwd changes and workspace aliases', () => {
  const cli = path.join(core, 'bin/handoff.js');
  for (const cwd of [fixture, core, path.dirname(core)]) {
    const actual = JSON.parse(run([cli, 'config'], cwd));
    assert.equal(actual.resolvedProject.projectIdentifier, config.archiveProjectId);
    assert.equal(actual.historyRoot, config.historyRoot);
  }
  const explicit = JSON.parse(run([cli, 'config', '--project', path.join(fixture, 'turnel'), '--project-id', 'turnel-stable']));
  assert.equal(explicit.resolvedProject.projectIdentifier, 'turnel-stable');
  const invalid = spawnSync(process.execPath, [cli, 'config', '--project-id', '..'], { env, encoding: 'utf8', windowsHide: true });
  assert.notEqual(invalid.status, 0);
});

test('archive conflicts preserve original bytes; repeat imports are idempotent; index links use fixture', () => {
  const input = path.join(fixture, 'source.json');
  const record = { id: 'fixture-1', title: 'Migration collision', dispatchedAt: new Date(2026, 8, 5, 1, 0).getTime(), text: 'first synthetic answer' };
  fs.writeFileSync(input, JSON.stringify([record]));
  const args = [path.join(core, 'pipeline/archive_local_results.js'), '--input', input];
  run(args);
  const bucket = path.join(config.historyRoot, config.archiveProjectId, '2026-09-05', '00h-04h');
  const original = path.join(bucket, 'Migration collision.md');
  const initialBytes = fs.readFileSync(original);
  run(args);
  assert.equal(fs.readdirSync(bucket).length, 1);
  fs.writeFileSync(input, JSON.stringify([{ ...record, text: 'second synthetic answer' }]));
  run(args);
  run(args);
  assert.deepEqual(fs.readFileSync(original), initialBytes);
  assert.equal(fs.readdirSync(bucket).length, 2);
  run([path.join(core, 'pipeline/index_builder.js')]);
  const index = fs.readFileSync(path.join(config.historyRoot, config.archiveProjectId, 'README.md'), 'utf8');
  assert.match(index, /Migration collision/);
  assert.ok(fs.existsSync(path.join(config.historyRoot, config.archiveProjectId, 'codegraph.json')));
  assert.equal(fs.existsSync(path.join(config.historyRoot, '2026-09-05')), false);
});

test('help paths do not contact browsers or run implicit tasks', () => {
  for (const entry of ['pipeline/auto_chat_pipeline.js', 'pipeline/sync_search_history.js', 'pipeline/archive_local_results.js', 'tests/manual/profile_repro_cdp.mjs']) {
    assert.match(run([path.join(core, entry), '--help']), /prompt|sync|archive|run-dir/);
  }
});

test('cloner dry run selects configured runtime data without launching; rejects source tree target', () => {
  const script = path.join(core, 'tools/session-cloner/reproduce_profile_capsule.ps1');
  const args = ['-NoProfile', '-File', script, '-ConfigPath', configPath, '-DryRun'];
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.dryRun, true);
  assert.ok(data.target.startsWith(config.workersRoot + path.sep));
  assert.ok(data.runDir.startsWith(config.runsRoot + path.sep));
  assert.equal(fs.existsSync(data.target), false);
  const invalid = spawnSync('powershell.exe', [...args, '-TargetDir', core], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(invalid.status, 0);
});

test('synthetic SQLite WAL recovery remains valid after moving test source', () => {
  const result = spawnSync('python', [path.join(core, 'tests/offline/verify_sqlite_wal.py'), '--output-dir', path.join(fixture, 'sqlite')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.status, 'PASS');
  assert.equal(data.main_only.row_count, 1);
  assert.equal(data.main_and_wal.row_count, 2);
});

test.after(() => {
  const resolved = fs.realpathSync(fixture);
  if (!resolved.startsWith(fs.realpathSync(artifacts) + path.sep)) throw new Error('Unsafe test cleanup path');
  fs.rmSync(resolved, { recursive: true });
});
