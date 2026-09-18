'use strict';

const { startServer, printHelp, handleRequest } = require('./server');
const { toolsDefinition, executeTool } = require('./tools');
const { resourcesDefinition, readResource } = require('./resources');

module.exports = {
  startServer,
  printHelp,
  handleRequest,
  toolsDefinition,
  executeTool,
  resourcesDefinition,
  readResource,
};

if (require.main === module) {
  startServer();
}
