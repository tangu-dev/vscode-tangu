import * as assert from "assert";
import {
    buildServerConfigOverrides,
    buildServerEnv,
    ConfigInspectResult,
    resolveExecutablePath,
} from "../src/config-logic";

describe("config-logic", () => {
    it("omits schema defaults and emits only explicitly overridden ServerConfig values", () => {
        const table: Record<string, ConfigInspectResult> = {
            "lint.enable": { defaultValue: [] },
            "lint.disable": { defaultValue: [], workspaceValue: ["missing-doc"] },
            "lint.exclude": { defaultValue: [] },
            "lint.severity": { defaultValue: {} },
            "format.indentSize": { defaultValue: 4 },
            "format.softLineLimit": { defaultValue: 80, globalValue: 100 },
            "format.hardLineLimit": { defaultValue: 120 },
            "format.organizeImports": { defaultValue: true, workspaceFolderValue: false },
            "diagnostics.workspace": { defaultValue: true },
        };

        const overrides = buildServerConfigOverrides((k) => table[k], true);
        assert.deepStrictEqual(overrides, {
            lint: { disable: ["missing-doc"] },
            format: { softLineLimit: 100, organizeImports: false },
        });
    });

    it("returns empty object when nothing is overridden", () => {
        const overrides = buildServerConfigOverrides(
            () => ({ defaultValue: true }),
            true,
        );
        assert.deepStrictEqual(overrides, {});
    });

    it("ignores workspace overrides when allowWorkspace is false", () => {
        const table: Record<string, ConfigInspectResult> = {
            "lint.disable": { globalValue: ["foo"], workspaceValue: ["bar"] },
            "diagnostics.workspace": { workspaceFolderValue: false },
        };
        const overrides = buildServerConfigOverrides((k) => table[k], false);
        assert.deepStrictEqual(overrides, {
            lint: { disable: ["foo"] },
        });
    });

    it("resolves executables on POSIX via PATH, ~/.cargo/bin, and $TANGU_ROOT/bin", () => {
        const existing = new Set([
            "/home/alice/.cargo/bin/tangu-language-server",
            "/opt/tangu/bin/tangu",
        ]);

        assert.strictEqual(
            resolveExecutablePath({
                binaryName: "tangu-language-server",
                env: { PATH: "/usr/bin:/bin" },
                platform: "linux",
                homeDir: "/home/alice",
                existsSync: (p) => existing.has(p),
            }),
            "/home/alice/.cargo/bin/tangu-language-server",
        );

        assert.strictEqual(
            resolveExecutablePath({
                binaryName: "tangu",
                env: { PATH: "/usr/bin", TANGU_ROOT: "/opt/tangu" },
                platform: "linux",
                homeDir: "/home/bob",
                existsSync: (p) => existing.has(p),
            }),
            "/opt/tangu/bin/tangu",
        );

        assert.strictEqual(
            resolveExecutablePath({
                configuredPath: "~/.cargo/bin/tangu-language-server",
                binaryName: "tangu-language-server",
                env: {},
                platform: "linux",
                homeDir: "/home/alice",
                existsSync: (p) => existing.has(p),
            }),
            "/home/alice/.cargo/bin/tangu-language-server",
        );
    });

    it("resolves Windows executables with .exe PATHEXT suffix", () => {
        const existing = new Set([
            "C:\\Users\\alice\\.cargo\\bin\\tangu-language-server.exe",
            "C:\\tools\\tangu.exe",
        ]);

        assert.strictEqual(
            resolveExecutablePath({
                binaryName: "tangu-language-server",
                env: { PATH: "C:\\Windows\\System32", PATHEXT: ".COM;.EXE;.BAT" },
                platform: "win32",
                homeDir: "C:\\Users\\alice",
                existsSync: (p) => existing.has(p),
            }),
            "C:\\Users\\alice\\.cargo\\bin\\tangu-language-server.exe",
        );

        assert.strictEqual(
            resolveExecutablePath({
                configuredPath: "C:\\tools\\tangu",
                binaryName: "tangu",
                env: { PATHEXT: ".EXE" },
                platform: "win32",
                homeDir: "C:\\Users\\alice",
                existsSync: (p) => existing.has(p),
            }),
            "C:\\tools\\tangu.exe",
        );
    });

    it("never forces RUST_LOG=trace unless configured via logLevel", () => {
        const cleanEnv = buildServerEnv({ PATH: "/usr/bin" }, { FOO: "bar" }, "");
        assert.strictEqual(cleanEnv.RUST_LOG, undefined);
        assert.strictEqual(cleanEnv.FOO, "bar");

        const debugEnv = buildServerEnv({ PATH: "/usr/bin" }, undefined, "debug");
        assert.strictEqual(debugEnv.RUST_LOG, "debug");
    });
});
