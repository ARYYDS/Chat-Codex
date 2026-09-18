import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { normalizeSessionRegistry } from "../src/chatgpt-sessions.mjs";
import { ensureProjectState, projectStatePath } from "../src/project-state.mjs";

const project = ensureProjectState();
assert.equal(typeof project.projectId, "string");
assert.match(project.projectId, /^(cgpt_|dir_)/);
assert.equal(project.schemaVersion, 1);
assert.equal(existsSync(projectStatePath), true);
assert.equal(typeof project.identitySource, "string");
assert.equal(typeof project.canonicalSessionRegistryPath, "string");

const legacy = normalizeSessionRegistry({
  sessions: {
    main: {
      targetId: "target-1",
      url: "https://chatgpt.com/c/legacy",
      title: "Legacy Room",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
}, project);

assert.equal(legacy.schemaVersion, 2);
assert.equal(legacy.rooms.main.projectId, project.projectId);
assert.equal(legacy.rooms.main.repoRoot, project.repoRoot);
assert.equal(legacy.rooms.main.conversationUrl, "https://chatgpt.com/c/legacy");
assert.equal(legacy.rooms.main.activeConversationUrl, "https://chatgpt.com/c/legacy");
assert.equal(legacy.rooms.main.responseMode, "blocking");
assert.equal(legacy.rooms.main.lineage[0].threadId, "chatgpt:legacy");

const foreign = normalizeSessionRegistry({
  aliases: {
    main: {
      projectId: "other-project",
      repoRoot: "/tmp/other",
      conversationUrl: "https://chatgpt.com/c/other",
    },
  },
}, project);

assert.equal(foreign.rooms.main.projectId, "other-project");
assert.equal(foreign.rooms.main.repoRoot, "/tmp/other");

console.log(JSON.stringify({ ok: true, tested: "project-state", projectId: project.projectId }, null, 2));
