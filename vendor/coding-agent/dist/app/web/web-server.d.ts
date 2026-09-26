/** 本机 Web HTTP/SSE 入口：只提供同源页面、任务、审批和取消 API。 */
import { type Server } from "node:http";
import { WebRunManager } from "./web-run-manager.js";
export interface WebServerOptions {
    readonly host?: string;
    readonly port?: number;
}
export declare function createCodingAgentWebServer(manager?: WebRunManager): Server;
export declare function listenWebServer(server: Server, options?: WebServerOptions): Promise<{
    readonly host: string;
    readonly port: number;
    readonly url: string;
}>;
//# sourceMappingURL=web-server.d.ts.map