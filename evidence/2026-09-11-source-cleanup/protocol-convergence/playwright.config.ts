import base from '../../../src/ui/tests/playwright.config.js';
const server=base.webServer;
if(!server||Array.isArray(server))throw Error('Expected existing single fixture host');
export default {...base,use:{...base.use,baseURL:'http://127.0.0.1:44394'},webServer:{...server,command:server.command.replace('PORT=4399 ','PORT=44394 '),url:'http://127.0.0.1:44394/api/meta'}};
