import { spawn } from "child_process";

export interface CliRunOptions {
    cliPath: string;
    args: string[];
    cwd?: string;
    stdin?: string;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    env?: Record<string, string | undefined>;
}

export interface CliRunResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    truncated: boolean;
    aborted: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 512 * 1024;

/** Runs the `tangu` CLI without shell interpolation, supporting stdin, timeout, output cap, and AbortSignal. */
export function runTanguCli(options: CliRunOptions): Promise<CliRunResult> {
    const {
        cliPath,
        args,
        cwd,
        stdin,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxBytes = DEFAULT_MAX_BYTES,
        signal,
        env,
    } = options;

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            resolve({
                stdout: "",
                stderr: "",
                exitCode: null,
                timedOut: false,
                truncated: false,
                aborted: true,
            });
            return;
        }

        const child = spawn(cliPath, args, {
            cwd,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
            env: env ?? process.env,
        });

        const outChunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let truncated = false;
        let timedOut = false;
        let aborted = false;
        let settled = false;

        const finish = (result: CliRunResult) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
        };

        const killChild = () => {
            try {
                child.kill("SIGKILL");
            } catch {
                // ignore already exited child
            }
        };

        const onAbort = () => {
            aborted = true;
            killChild();
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const timer = timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                killChild();
            }, timeoutMs)
            : undefined;

        child.stdout.on("data", (chunk: Buffer) => {
            if (outBytes >= maxBytes) {
                truncated = true;
                return;
            }
            const remaining = maxBytes - outBytes;
            if (chunk.length > remaining) {
                outChunks.push(chunk.subarray(0, remaining));
                outBytes += remaining;
                truncated = true;
            } else {
                outChunks.push(chunk);
                outBytes += chunk.length;
            }
        });

        child.stderr.on("data", (chunk: Buffer) => {
            if (errBytes >= maxBytes) {
                truncated = true;
                return;
            }
            const remaining = maxBytes - errBytes;
            if (chunk.length > remaining) {
                errChunks.push(chunk.subarray(0, remaining));
                errBytes += remaining;
                truncated = true;
            } else {
                errChunks.push(chunk);
                errBytes += chunk.length;
            }
        });

        child.on("error", (err) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            signal?.removeEventListener("abort", onAbort);
            reject(err);
        });

        child.on("close", (code) => {
            finish({
                stdout: Buffer.concat(outChunks).toString("utf8"),
                stderr: Buffer.concat(errChunks).toString("utf8"),
                exitCode: code,
                timedOut,
                truncated,
                aborted,
            });
        });

        if (stdin !== undefined) {
            child.stdin.write(stdin);
        }
        child.stdin.end();
    });
}
