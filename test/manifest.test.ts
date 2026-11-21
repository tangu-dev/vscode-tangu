import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("manifest and configuration invariants", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const langConfig = JSON.parse(
        fs.readFileSync(path.join(ROOT, "language-configuration.json"), "utf8"),
    );

    it("scopes all default semantic token color rules to Tangu languages", () => {
        const rules: Record<string, unknown> =
            pkg.contributes.configurationDefaults["editor.semanticTokenColorCustomizations"]["[*]"].rules;
        const keys = Object.keys(rules);
        assert.ok(keys.length > 0);
        for (const key of keys) {
            assert.match(
                key,
                /:tangu(?:-(?:data|test|schema))?$/,
                `Unscoped semantic token rule '${key}' would leak into non-Tangu languages`,
            );
        }
    });

    it("does not collide with server executeCommandProvider command IDs", () => {
        const serverCommands = new Set([
            "tangu.runFullWorkspaceDiagnostics",
            "tangu.expandMacroServer",
            "tangu.runTest",
            "tangu.evalExpression",
        ]);
        const clientCommands: string[] = pkg.contributes.commands.map(
            (c: { command: string }) => c.command,
        );
        for (const cmd of clientCommands) {
            assert.ok(
                !serverCommands.has(cmd),
                `Command '${cmd}' collides with tangu-language-server executeCommandProvider`,
            );
        }
    });

    it("$tangu problem matcher pattern parses real tangu check and lint diagnostic lines", () => {
        const matcher = pkg.contributes.problemMatchers[0];
        const re = new RegExp(matcher.pattern.regexp);

        const sampleError =
            "Error [syntax-error] /tmp/bad.tan:2:1: unterminated list: List not terminated";
        const m1 = re.exec(sampleError);
        assert.ok(m1, "Failed to match syntax error output");
        assert.strictEqual(m1[1], "Error");
        assert.strictEqual(m1[2], "syntax-error");
        assert.strictEqual(m1[3], "/tmp/bad.tan");
        assert.strictEqual(m1[4], "2");
        assert.strictEqual(m1[5], "1");

        const sampleWarning =
            "Warning [prefer-say] src/main.tan:12:4: Prefer `(say ...)` over `(echo ...)`.";
        const m2 = re.exec(sampleWarning);
        assert.ok(m2, "Failed to match lint warning output");
        assert.strictEqual(m2[1], "Warning");
        assert.strictEqual(m2[2], "prefer-say");
        assert.strictEqual(m2[3], "src/main.tan");
        assert.strictEqual(m2[4], "12");
        assert.strictEqual(m2[5], "4");
    });

    it("wordPattern matches whole Tangu identifiers and splits key-paths", () => {
        const re = new RegExp(langConfig.wordPattern, "g");
        const wordsOf = (s: string) => s.match(re) ?? [];

        assert.deepStrictEqual(wordsOf("(is-empty? xs)"), ["is-empty?", "xs"]);
        assert.deepStrictEqual(wordsOf("(assert-eq! a b)"), ["assert-eq!", "a", "b"]);
        assert.deepStrictEqual(wordsOf("(sort<- arr)"), ["sort<-", "arr"]);
        assert.deepStrictEqual(wordsOf("(for->seq [i 0..n] i)"), ["for->seq", "i", "0", "n", "i"]);
        assert.deepStrictEqual(wordsOf("(<import-map>)"), ["<import-map>"]);
        assert.deepStrictEqual(wordsOf("*test-failures*"), ["*test-failures*"]);
        assert.deepStrictEqual(wordsOf("10_000.99d"), ["10_000.99d"]);

        assert.deepStrictEqual(wordsOf("resp?body?user"), ["resp", "body", "user"]);
        assert.deepStrictEqual(wordsOf("m:key"), ["m", "key"]);
        assert.deepStrictEqual(wordsOf("iter/find"), ["iter", "find"]);
    });

    it("caps marketplace keywords at 5 entries", () => {
        assert.ok(Array.isArray(pkg.keywords));
        assert.ok(pkg.keywords.length <= 5, `Expected <= 5 keywords, got ${pkg.keywords.length}`);
    });

    it("declares limited untrustedWorkspaces capability", () => {
        assert.strictEqual(pkg.capabilities?.untrustedWorkspaces?.supported, "limited");
    });

    it("uses repo-relative links in AGENTS.md without local file:// URIs", () => {
        const agentsMd = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
        assert.ok(!/file:\/\/\//.test(agentsMd), "Found local file:/// URI in AGENTS.md");
    });
});
