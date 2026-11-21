import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vsctm from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";

const ROOT = path.resolve(__dirname, "../..");

const STUB_GRAMMARS: Record<string, vsctm.IRawGrammar> = {
    "source.sql": vsctm.parseRawGrammar(
        JSON.stringify({
            scopeName: "source.sql",
            patterns: [
                { match: "\\b(SELECT|FROM|WHERE)\\b", name: "keyword.other.DML.sql" },
            ],
        }),
        "sql.json",
    ),
    "text.html.basic": vsctm.parseRawGrammar(
        JSON.stringify({
            scopeName: "text.html.basic",
            patterns: [
                { match: "</?[a-zA-Z0-9-]+", name: "entity.name.tag.html" },
            ],
        }),
        "html.json",
    ),
    "text.html.markdown": vsctm.parseRawGrammar(
        JSON.stringify({
            scopeName: "text.html.markdown",
            patterns: [
                {
                    begin: "\\*\\*",
                    end: "\\*\\*",
                    name: "markup.bold.markdown",
                },
            ],
        }),
        "markdown.json",
    ),
};

function tokenizeLines(grammar: vsctm.IGrammar, lines: string[]) {
    let ruleStack: vsctm.StateStack | null = vsctm.INITIAL;
    return lines.map((line) => {
        const res = grammar.tokenizeLine(line, ruleStack);
        ruleStack = res.ruleStack;
        return res.tokens.map((tok) => ({
            text: line.slice(tok.startIndex, tok.endIndex),
            scopes: tok.scopes,
        }));
    });
}

describe("TextMate grammar", () => {
    let registry: vsctm.Registry;
    let tanguGrammar: vsctm.IGrammar;
    let markdownGrammar: vsctm.IGrammar;

    before(async () => {
        const wasmPath = path.join(ROOT, "node_modules/vscode-oniguruma/release/onig.wasm");
        const wasmBin = fs.readFileSync(wasmPath).buffer;
        await oniguruma.loadWASM(wasmBin);

        const tanguRaw = vsctm.parseRawGrammar(
            fs.readFileSync(path.join(ROOT, "syntaxes/tangu.tmLanguage.json"), "utf8"),
            "tangu.tmLanguage.json",
        );
        const codeblockRaw = vsctm.parseRawGrammar(
            fs.readFileSync(path.join(ROOT, "syntaxes/tangu.codeblock.json"), "utf8"),
            "tangu.codeblock.json",
        );

        registry = new vsctm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
                createOnigString: (s) => new oniguruma.OnigString(s),
            }),
            loadGrammar: async (scopeName) => {
                if (scopeName === "source.tangu") {
                    return tanguRaw;
                }
                if (scopeName === "markdown.tangu.codeblock") {
                    return codeblockRaw;
                }
                return STUB_GRAMMARS[scopeName] ?? null;
            },
            getInjections: (scopeName) => {
                if (scopeName === "text.html.markdown") {
                    return ["markdown.tangu.codeblock"];
                }
                return undefined;
            },
        });

        const g1 = await registry.loadGrammar("source.tangu");
        const g2 = await registry.loadGrammar("text.html.markdown");
        assert.ok(g1 && g2);
        tanguGrammar = g1;
        markdownGrammar = g2;
    });

    it("highlights comments, ignoring semicolons inside strings", () => {
        const [tokens] = tokenizeLines(tanguGrammar, ['(let s "; not a comment") ; real comment']);
        const inStr = tokens.find((t) => t.text.includes("; not a comment"));
        assert.ok(inStr);
        assert.ok(inStr.scopes.some((s) => s.startsWith("string.quoted.double")));
        assert.ok(!inStr.scopes.some((s) => s.startsWith("comment.")));

        const comment = tokens.find((t) => t.text.includes("real comment"));
        assert.ok(comment);
        assert.ok(comment.scopes.some((s) => s.startsWith("comment.line.semicolon")));
    });

    it("highlights triple-quoted strings and recursive interpolation", () => {
        const lines = tokenizeLines(tanguGrammar, [
            '(let x """multi',
            'line ${(+ 1 2)} end""")',
        ]);
        const multiStart = lines[0].find((t) => t.text.includes("multi"));
        assert.ok(multiStart?.scopes.some((s) => s.includes("string.quoted.triple.tangu")));

        const interpNum = lines[1].find((t) => t.text === "1");
        assert.ok(interpNum?.scopes.some((s) => s.includes("constant.numeric.integer.tangu")));
        assert.ok(interpNum?.scopes.some((s) => s.includes("meta.interpolation.tangu")));
    });

    it("embeds SQL in #sql strings and HTML only in #html strings (not #html [...])", () => {
        const [sqlTokens] = tokenizeLines(tanguGrammar, ['#sql "SELECT id FROM users WHERE id = ${id}"']);
        const selectTok = sqlTokens.find((t) => t.text === "SELECT");
        assert.ok(selectTok?.scopes.includes("meta.embedded.inline.sql"));
        assert.ok(selectTok?.scopes.includes("keyword.other.DML.sql"));

        const interpVar = sqlTokens.find((t) => t.text === "id" && t.scopes.some((s) => s.includes("meta.interpolation")));
        assert.ok(interpVar, "Expected ${id} inside #sql to tokenize as interpolation");

        const [htmlStrTokens] = tokenizeLines(tanguGrammar, ['#html "<div>${name}</div>"']);
        const divTok = htmlStrTokens.find((t) => t.text === "<div");
        assert.ok(divTok?.scopes.includes("meta.embedded.inline.html"));
        assert.ok(divTok?.scopes.includes("entity.name.tag.html"));

        const [htmlSexprTokens] = tokenizeLines(tanguGrammar, ['#html [:div "plain"]']);
        const plainTok = htmlSexprTokens.find((t) => t.text === "plain");
        assert.ok(plainTok?.scopes.some((s) => s.includes("string.quoted.double.tangu")));
        assert.ok(!plainTok?.scopes.includes("meta.embedded.inline.html"));
    });

    it("highlights ;; doc comments as embedded markdown and annotations cleanly", () => {
        const [docTokens] = tokenizeLines(tanguGrammar, [";; **bold** doc"]);
        const bold = docTokens.find((t) => t.text === "bold");
        assert.ok(bold?.scopes.includes("comment.line.documentation.tangu"));
        assert.ok(bold?.scopes.includes("markup.bold.markdown"));

        const [annTokens] = tokenizeLines(tanguGrammar, ["(#pub) #test (when x _ 1)"]);
        const pubTok = annTokens.find((t) => t.text === "#pub");
        assert.ok(pubTok?.scopes.includes("entity.name.tag.tangu"));
        const whenTok = annTokens.find((t) => t.text === "when");
        assert.ok(whenTok?.scopes.includes("keyword.control.tangu"));
    });

    it("injects Tangu highlighting into both ```tan and ```tangu markdown fences", () => {
        const lines = tokenizeLines(markdownGrammar, [
            "```tan",
            "(def x 1)",
            "```",
            "```tangu",
            "(let y 2)",
            "```",
        ]);
        const defTok = lines[1].find((t) => t.text === "def");
        assert.ok(defTok?.scopes.includes("meta.embedded.block.tangu"));
        assert.ok(defTok?.scopes.includes("keyword.control.tangu"));

        const letTok = lines[4].find((t) => t.text === "let");
        assert.ok(letTok?.scopes.includes("meta.embedded.block.tangu"));
        assert.ok(letTok?.scopes.includes("keyword.control.tangu"));
    });
});
