'use strict';

const readline = require('node:readline');
const util = require('node:util');
const { toolsDefinition, executeTool } = require('./tools');
const { resourcesDefinition, readResource } = require('./resources');
const { loadConfig } = require('../lib/runtime-config');

const SERVER_NAME = 'chat-codex-mcp';
const SERVER_VERSION = '1.0.0';

function printHelp() {
  console.log(`Chat-Codex MCP Server v${SERVER_VERSION}`);
  console.log('Standard Model Context Protocol (MCP) server over Stdio JSON-RPC.\n');
  console.log('Registered Tools:');
  for (const t of toolsDefinition) {
    console.log(`  * ${t.name}: ${t.description}`);
  }
  console.log('\nRegistered Resources:');
  for (const r of resourcesDefinition) {
    console.log(`  * ${r.uri}: ${r.description}`);
  }
  console.log('\nUsage:');
  console.log('  node bin/handoff.js mcp           # Run MCP server on stdio');
  console.log('  node bin/handoff.js mcp --help    # Print this help guide');
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    };
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: toolsDefinition },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: toolArgs = {} } = params || {};
    try {
      const output = await executeTool(name, toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Tool Error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources: resourcesDefinition },
    };
  }

  if (method === 'resources/read') {
    const { uri } = params || {};
    try {
      const data = await readResource(uri);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: err.message },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function startServer() {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }

  // Redirect console.* to stderr so stdout is strictly preserved for JSON-RPC 2.0 messages
  const logToStderr = (...args) => {
    process.stderr.write(util.format(...args) + '\n');
  };
  console.log = logToStderr;
  console.info = logToStderr;
  console.warn = logToStderr;
  console.debug = logToStderr;

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const res = await handleRequest(msg);
      if (res) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
      }
    } catch (e) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } })}\n`);
    }
  });
}

module.exports = { startServer, printHelp, handleRequest };

if (require.main === module) {
  startServer();
}
