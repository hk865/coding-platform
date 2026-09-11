import base from '../../../src/ui/tests/playwright.config.js';

const server = base.webServer;
if (!server || Array.isArray(server)) throw Error('Expected the existing single fixture server');
// The existing default port is occupied. Preserve tests, browser and sandbox
// settings; isolate this run's host and data through the supported environment.
export default {
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:44391' },
  webServer: {
    ...server,
    command: server.command.replace('PORT=4399 ', 'PORT=44391 '),
    url: 'http://127.0.0.1:44391/api/meta',
  },
};
