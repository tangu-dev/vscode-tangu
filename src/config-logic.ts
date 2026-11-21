import * as path from "path";

export interface ConfigInspectResult<T = unknown> {
    defaultValue?: T;
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
}

export type InspectLookup = (key: string) => ConfigInspectResult<unknown> | undefined;

export interface ExecutableLookupOptions {
    configuredPath?: string;
    binaryName: string;
    env: Record<string, string | undefined>;
    platform: NodeJS.Platform;
    homeDir: string;
    existsSync: (candidate: string) => boolean;
}

/** Returns only explicitly configured values (ignoring schema defaults). */
export function getExplicitValue<T>(
    inspect: ConfigInspectResult<T> | undefined,
    allowWorkspace = true,
): T | undefined {
    if (!inspect) {
        return undefined;
    }
    if (allowWorkspace) {
        if (inspect.workspaceFolderValue !== undefined) {
            return inspect.workspaceFolderValue;
        }
        if (inspect.workspaceValue !== undefined) {
            return inspect.workspaceValue;
        }
    }
    return inspect.globalValue;
}

function assignNested(
    target: Record<string, Record<string, unknown>>,
    section: string,
    field: string,
    value: unknown,
): void {
    if (value === undefined) {
        return;
    }
    if (!target[section]) {
        target[section] = {};
    }
    target[section][field] = value;
}

/**
 * Builds the `tangu` configuration object for `workspace/didChangeConfiguration`,
 * emitting ONLY keys explicitly set by the user or workspace so `.tangu/config.data.tan`
 * defaults are never overwritten.
 */
export function buildServerConfigOverrides(
    inspect: InspectLookup,
    allowWorkspace = true,
): Record<string, unknown> {
    const sections: Record<string, Record<string, unknown>> = {};

    const pairs: Array<[string, string, string]> = [
        ["lint.enable", "lint", "enable"],
        ["lint.disable", "lint", "disable"],
        ["lint.exclude", "lint", "exclude"],
        ["lint.severity", "lint", "severity"],
        ["format.indentSize", "format", "indentSize"],
        ["format.softLineLimit", "format", "softLineLimit"],
        ["format.hardLineLimit", "format", "hardLineLimit"],
        ["format.organizeImports", "format", "organizeImports"],
        ["diagnostics.workspace", "diagnostics", "workspace"],
    ];

    for (const [key, section, field] of pairs) {
        const value = getExplicitValue(inspect(key), allowWorkspace);
        assignNested(sections, section, field, value);
    }

    const out: Record<string, unknown> = {};
    for (const [section, fields] of Object.entries(sections)) {
        if (Object.keys(fields).length > 0) {
            out[section] = fields;
        }
    }
    return out;
}

/** Expands a leading `~` segment using `homeDir`. */
export function expandHomeDir(
    filePath: string,
    homeDir: string,
    pathMod: path.PlatformPath = path,
): string {
    if (!homeDir) {
        return filePath;
    }
    if (filePath === "~") {
        return homeDir;
    }
    if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
        return pathMod.join(homeDir, filePath.slice(2));
    }
    return filePath;
}

function candidateFilenames(
    binaryName: string,
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>,
    pathMod: path.PlatformPath,
): string[] {
    if (platform !== "win32") {
        return [binaryName];
    }
    const ext = pathMod.extname(binaryName);
    if (ext) {
        return [binaryName];
    }
    const rawPathext = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
    const exts = rawPathext
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of [binaryName, ...exts.map((e) => `${binaryName}${e.toLowerCase()}`), ...exts.map((e) => `${binaryName}${e}`)]) {
        if (!seen.has(candidate)) {
            seen.add(candidate);
            out.push(candidate);
        }
    }
    return out;
}

function findInDirs(
    dirs: string[],
    binaryName: string,
    platform: NodeJS.Platform,
    env: Record<string, string | undefined>,
    pathMod: path.PlatformPath,
    existsSync: (candidate: string) => boolean,
): string | undefined {
    const names = candidateFilenames(binaryName, platform, env, pathMod);
    for (const dir of dirs) {
        if (!dir) {
            continue;
        }
        for (const name of names) {
            const candidate = pathMod.resolve(dir, name);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/**
 * Resolves a Tangu executable path from explicit setting, `PATH`, `~/.cargo/bin`,
 * or `$TANGU_ROOT/bin`, accounting for Windows `.exe` / `PATHEXT` conventions.
 */
export function resolveExecutablePath(options: ExecutableLookupOptions): string | undefined {
    const { configuredPath, binaryName, env, platform, homeDir, existsSync } = options;
    const pathMod = platform === "win32" ? path.win32 : path.posix;
    const rawPathEnv = env.PATH ?? (platform === "win32" ? env.Path : undefined) ?? "";
    const pathDirs = rawPathEnv.split(pathMod.delimiter).filter(Boolean);

    const configured = configuredPath?.trim();
    if (configured) {
        const expanded = expandHomeDir(configured, homeDir, pathMod);
        const hasSeparator = expanded.includes("/") || expanded.includes("\\");
        if (hasSeparator || pathMod.isAbsolute(expanded)) {
            for (const candidate of candidateFilenames(expanded, platform, env, pathMod)) {
                if (existsSync(candidate)) {
                    return candidate;
                }
            }
            return undefined;
        }
        return findInDirs(pathDirs, expanded, platform, env, pathMod, existsSync);
    }

    const searchDirs: string[] = [...pathDirs];
    const cargoHome = env.CARGO_HOME?.trim() || (homeDir ? pathMod.join(homeDir, ".cargo") : "");
    if (cargoHome) {
        searchDirs.push(pathMod.join(cargoHome, "bin"));
    }
    const tanguRoot = env.TANGU_ROOT?.trim();
    if (tanguRoot) {
        searchDirs.push(pathMod.join(tanguRoot, "bin"));
    }

    return findInDirs(searchDirs, binaryName, platform, env, pathMod, existsSync);
}

/**
 * Builds the environment for spawning `tangu-language-server`.
 * Only injects `RUST_LOG` when `logLevel` is explicitly set so LSP `$/setTrace`
 * filtering works dynamically by default.
 */
export function buildServerEnv(
    baseEnv: Record<string, string | undefined>,
    extraEnv: Record<string, string> | undefined,
    logLevel: string | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseEnv)) {
        if (typeof v === "string") {
            out[k] = v;
        }
    }
    if (extraEnv) {
        for (const [k, v] of Object.entries(extraEnv)) {
            if (typeof v === "string") {
                out[k] = v;
            }
        }
    }
    const trimmedLogLevel = logLevel?.trim();
    if (trimmedLogLevel) {
        out.RUST_LOG = trimmedLogLevel;
    }
    return out;
}
