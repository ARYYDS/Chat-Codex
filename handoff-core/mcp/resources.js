'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../lib/runtime-config');

const resourcesDefinition = [
  {
    uri: 'chatgpt://runtime/status',
    name: 'Runtime Status and Lock State',
    mimeType: 'application/json',
    description: 'Current Chrome CDP ports, runtime profile locations, and active browser locks.',
  },
  {
    uri: 'chatgpt://sessions/rooms',
    name: 'ChatGPT Session Rooms',
    mimeType: 'application/json',
    description: 'List of repository-scoped room mappings (main, debug, critic, scratch).',
  },
  {
    uri: 'chatgpt://history/recent',
    name: 'Recent Research Runs',
    mimeType: 'application/json',
    description: 'Summaries of recent research tasks from runs/ and PassSearchHistory/.',
  },
];

async function readResource(uri, config = loadConfig()) {
  if (uri === 'chatgpt://runtime/status') {
    const lockPath = path.join(config.runtimeRoot, '.runtime', 'locks', 'browser.lock');
    const hasLock = fs.existsSync(lockPath);
    return {
      runtimeRoot: config.runtimeRoot,
      codeRoot: config.codeRoot,
      cdpPorts: config.cdpPorts,
      browserLock: hasLock ? { active: true, path: lockPath } : { active: false },
      masterProfile: config.masterProfile,
    };
  }

  if (uri === 'chatgpt://sessions/rooms') {
    return {
      archiveProjectId: config.archiveProjectId,
      supportedRooms: ['main', 'debug', 'critic', 'scratch'],
    };
  }

  if (uri === 'chatgpt://history/recent') {
    const runsDir = config.runsRoot;
    const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).slice(0, 10) : [];
    return { runsRoot: runsDir, recentFiles: files };
  }

  throw new Error(`Resource not found: ${uri}`);
}

module.exports = { resourcesDefinition, readResource };
