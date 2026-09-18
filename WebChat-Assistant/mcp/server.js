const readline = require('readline');
const { TOOLS, handleToolCall } = require('./tools');
const { RESOURCES, handleResourceRead } = require('./resources');

class McpServer {
    constructor() {
        this.rl = null;
    }

    start() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        this.rl.on('line', async (line) => {
            if (!line.trim()) return;
            try {
                const request = JSON.parse(line);
                const response = await this.handleMessage(request);
                if (response) {
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
            } catch (err) {
                const errorResp = {
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: `Parse error: ${err.message}`
                    }
                };
                process.stdout.write(JSON.stringify(errorResp) + '\n');
            }
        });

        process.stderr.write('[MCP Server] WebChat-Assistant MCP running via stdio JSON-RPC 2.0\n');
    }

    async handleMessage(req) {
        const { id, method, params } = req;

        // Notifications without id do not require a response
        if (id === undefined || id === null) {
            return null;
        }

        try {
            switch (method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: '2024-11-05',
                            capabilities: {
                                tools: {},
                                resources: {}
                            },
                            serverInfo: {
                                name: 'webchat-assistant',
                                version: '1.0.0'
                            }
                        }
                    };

                case 'ping':
                    return { jsonrpc: '2.0', id, result: {} };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { tools: TOOLS }
                    };

                case 'tools/call': {
                    const { name, arguments: args } = params;
                    const result = await handleToolCall(name, args || {});
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                                }
                            ]
                        }
                    };
                }

                case 'resources/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { resources: RESOURCES }
                    };

                case 'resources/read': {
                    const { uri } = params;
                    const resource = await handleResourceRead(uri);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            contents: [
                                {
                                    uri: resource.uri,
                                    mimeType: resource.mimeType,
                                    text: resource.text
                                }
                            ]
                        }
                    };
                }

                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${method}`
                        }
                    };
            }
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32000,
                    message: err.message
                }
            };
        }
    }
}

function startServer() {
    const server = new McpServer();
    server.start();
}

module.exports = { McpServer, startServer };
