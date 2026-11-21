import * as path from "path";

export interface ListedTestEntry {
    name: string;
    file: string;
    line: number;
    col: number;
}

export interface TestListReport {
    total: number;
    tests: ListedTestEntry[];
}

export interface TestFailureDetail {
    module: string;
    test_name: string;
    file: string;
    line?: number;
    col?: number;
    expr?: string;
    expected?: string;
    actual?: string;
    snippet?: string;
    message: string;
}

export interface TestRunSummary {
    total: number;
    passed: number;
    failed: number;
    failed_modules: number;
    failed_assertions: number;
}

export interface TestRunReport {
    summary: TestRunSummary;
    profile: string;
    optimization_level: string;
    failures: TestFailureDetail[];
}

export interface BuildTestArgsOptions {
    mode: "all" | "file" | "single" | "changed";
    targetDir: string;
    filePath?: string;
    testName?: string;
    pattern?: string;
}

/** Escapes special regex metacharacters in a test name. */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns an anchored regex matching an exact test name. */
export function exactTestPattern(name: string): string {
    return `^${escapeRegex(name)}$`;
}

/** Converts 1-based CLI coordinates into clamped 0-based editor coordinates. */
export function toZeroBasedPosition(line1 = 1, col1 = 1): { line: number; character: number } {
    return {
        line: Math.max(0, line1 - 1),
        character: Math.max(0, col1 - 1),
    };
}

/** Extracts JSON object/report from CLI stdout (tolerating surrounding non-JSON lines if any). */
function extractJsonObject(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Empty CLI output");
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        }
        throw new Error(`Invalid JSON output from tangu test: ${trimmed.slice(0, 200)}`);
    }
}

/** Parses `tangu test --list --json` output. */
export function parseTestListJson(stdout: string): TestListReport {
    const parsed = extractJsonObject(stdout) as Partial<TestListReport>;
    if (!parsed || !Array.isArray(parsed.tests)) {
        throw new Error("Malformed TestListReport JSON");
    }
    return {
        total: typeof parsed.total === "number" ? parsed.total : parsed.tests.length,
        tests: parsed.tests,
    };
}

/** Parses `tangu test --json` output. */
export function parseTestRunJson(stdout: string): TestRunReport {
    const parsed = extractJsonObject(stdout) as Partial<TestRunReport>;
    if (!parsed || !parsed.summary || !Array.isArray(parsed.failures)) {
        throw new Error("Malformed TestRunReport JSON");
    }
    return {
        summary: parsed.summary,
        profile: parsed.profile ?? "test",
        optimization_level: parsed.optimization_level ?? "none",
        failures: parsed.failures,
    };
}

/**
 * Builds `tangu test` CLI arguments.
 * For `"file"` and `"single"` runs, passes `parentDir` as `[PATH]` with `--file <filePath>`
 * so directory-as-module sibling `.tan` files load properly.
 */
export function buildTestArgs(options: BuildTestArgsOptions): string[] {
    const args = ["test", "--json", "--no-color"];

    switch (options.mode) {
        case "all":
            args.push(options.targetDir);
            break;
        case "changed":
            args.push("--changed", options.targetDir);
            break;
        case "file": {
            if (!options.filePath) {
                throw new Error("filePath is required for file test mode");
            }
            const parentDir = path.dirname(options.filePath);
            args.push("--file", options.filePath);
            if (options.pattern) {
                args.push("--only", options.pattern);
            }
            args.push(parentDir);
            break;
        }
        case "single": {
            if (!options.filePath || !options.testName) {
                throw new Error("filePath and testName are required for single test mode");
            }
            const parentDir = path.dirname(options.filePath);
            args.push(
                "--file",
                options.filePath,
                "--only",
                exactTestPattern(options.testName),
                parentDir,
            );
            break;
        }
    }

    return args;
}
