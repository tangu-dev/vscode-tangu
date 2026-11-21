import * as assert from "assert";
import * as path from "path";
import {
    buildTestArgs,
    exactTestPattern,
    parseTestListJson,
    parseTestRunJson,
    toZeroBasedPosition,
} from "../src/test-protocol";

describe("test-protocol", () => {
    it("escapes regex characters in exactTestPattern", () => {
        assert.strictEqual(
            exactTestPattern("handles [foo.bar]+? (v1)"),
            "^handles \\[foo\\.bar\\]\\+\\? \\(v1\\)$",
        );
    });

    it("passes parentDir + --file for file and single test modes", () => {
        const filePath = path.join("/workspace", "pkg", "math.test.tan");
        assert.deepStrictEqual(
            buildTestArgs({ mode: "file", targetDir: "/workspace", filePath }),
            ["test", "--json", "--no-color", "--file", filePath, path.dirname(filePath)],
        );

        assert.deepStrictEqual(
            buildTestArgs({
                mode: "single",
                targetDir: "/workspace",
                filePath,
                testName: "adds-ints?",
            }),
            [
                "test",
                "--json",
                "--no-color",
                "--file",
                filePath,
                "--only",
                "^adds-ints\\?$",
                path.dirname(filePath),
            ],
        );

        assert.deepStrictEqual(
            buildTestArgs({ mode: "changed", targetDir: "/workspace" }),
            ["test", "--json", "--no-color", "--changed", "/workspace"],
        );
    });

    it("parses test list and test run JSON payloads cleanly", () => {
        const list = parseTestListJson(
            JSON.stringify({
                total: 1,
                tests: [{ name: "adds", file: "math.test.tan", line: 3, col: 5 }],
            }),
        );
        assert.strictEqual(list.total, 1);
        assert.strictEqual(list.tests[0].name, "adds");
        assert.deepStrictEqual(toZeroBasedPosition(list.tests[0].line, list.tests[0].col), {
            line: 2,
            character: 4,
        });

        const run = parseTestRunJson(
            JSON.stringify({
                summary: { total: 1, passed: 0, failed: 1, failed_modules: 0, failed_assertions: 1 },
                profile: "test",
                optimization_level: "none",
                failures: [
                    {
                        module: "math",
                        test_name: "adds",
                        file: "/workspace/math.test.tan",
                        line: 4,
                        col: 2,
                        expected: "4",
                        actual: "5",
                        message: "Assertion failed",
                    },
                ],
            }),
        );
        assert.strictEqual(run.summary.failed, 1);
        assert.strictEqual(run.failures[0].expected, "4");
        assert.strictEqual(run.failures[0].actual, "5");
    });
});
