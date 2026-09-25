interface RunCommand {
    readonly command: "run";
    readonly input: string;
    readonly cwd: string;
    readonly sessionId?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly configPath?: string;
    readonly nonInteractive: boolean;
}
interface ResumeCommand {
    readonly command: "resume";
    readonly sessionId: string;
    readonly cwd: string;
    readonly provider?: string;
    readonly model?: string;
    readonly configPath?: string;
    readonly nonInteractive: boolean;
}
type CliCommand = RunCommand | ResumeCommand;
export interface CliIo {
    readonly stdout: Pick<NodeJS.WriteStream, "write">;
    readonly stderr: Pick<NodeJS.WriteStream, "write">;
    readonly stdin: NodeJS.ReadStream;
}
export declare function parseCliCommand(argv: readonly string[], cwd?: string): CliCommand;
export declare function runCli(argv: readonly string[], io?: CliIo): Promise<number>;
export {};
//# sourceMappingURL=cli.d.ts.map