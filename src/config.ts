import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";
import {
    buildServerConfigOverrides,
    buildServerEnv,
    ConfigInspectResult,
    getExplicitValue,
    resolveExecutablePath,
} from "./config-logic";

const SERVER_BINARY_NAME = "tangu-language-server";
const CLI_BINARY_NAME = "tangu";

function inspectTangu<T>(key: string, scope?: vscode.ConfigurationScope): ConfigInspectResult<T> | undefined {
    return vscode.workspace.getConfiguration("tangu", scope).inspect<T>(key);
}

/** Collects explicitly configured Tangu analysis/lint/format settings without emitting schema defaults. */
export function getServerConfigOverrides(scope?: vscode.ConfigurationScope): Record<string, unknown> {
    return buildServerConfigOverrides(
        (key) => inspectTangu(key, scope),
        vscode.workspace.isTrusted,
    );
}

/** Resolves the configured or discovered `tangu-language-server` executable path. */
export function resolveServerBinary(): string | undefined {
    const trusted = vscode.workspace.isTrusted;
    const configuredPath = getExplicitValue(inspectTangu<string>("server.path"), trusted);
    return resolveExecutablePath({
        configuredPath,
        binaryName: SERVER_BINARY_NAME,
        env: process.env,
        platform: process.platform,
        homeDir: os.homedir(),
        existsSync: fs.existsSync,
    });
}

/** Resolves the configured or discovered `tangu` CLI executable path. */
export function resolveCliBinary(): string | undefined {
    const trusted = vscode.workspace.isTrusted;
    const configuredPath = getExplicitValue(inspectTangu<string>("cli.path"), trusted);
    return resolveExecutablePath({
        configuredPath,
        binaryName: CLI_BINARY_NAME,
        env: process.env,
        platform: process.platform,
        homeDir: os.homedir(),
        existsSync: fs.existsSync,
    });
}

/** Builds environment variables for spawning `tangu-language-server`. */
export function getServerEnv(): Record<string, string> {
    const trusted = vscode.workspace.isTrusted;
    const extraEnv = getExplicitValue(
        inspectTangu<Record<string, string>>("server.extraEnv"),
        trusted,
    );
    const logLevel = vscode.workspace.getConfiguration("tangu").get<string>("server.logLevel", "");
    return buildServerEnv(process.env, extraEnv, logLevel);
}

/** Returns the configured inline expression evaluation timeout in milliseconds. */
export function getEvalTimeoutMs(): number {
    const raw = vscode.workspace.getConfiguration("tangu").get<number>("eval.timeoutMs", 5000);
    return Math.min(30_000, Math.max(50, raw));
}
