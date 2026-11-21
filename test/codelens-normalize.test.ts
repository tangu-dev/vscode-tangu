import * as assert from "assert";
import {
    isRunTestCodeLensCommand,
    normalizeShowReferencesArgs,
    ShowReferencesFactories,
} from "../src/codelens-normalize";

interface FakeUri {
    kind: "uri";
    value: string;
}

interface FakePos {
    kind: "pos";
    line: number;
    character: number;
}

interface FakeRange {
    kind: "range";
    start: FakePos;
    end: FakePos;
}

interface FakeLocation {
    kind: "loc";
    uri: FakeUri;
    range: FakeRange;
}

const FACTORIES: ShowReferencesFactories<FakeUri, FakePos, FakeRange, FakeLocation> = {
    uriFromString: (value) => ({ kind: "uri", value }),
    uriFromFilePath: (filePath) => ({ kind: "uri", value: `file://${filePath}` }),
    position: (line, character) => ({ kind: "pos", line, character }),
    range: (sl, sc, el, ec) => ({
        kind: "range",
        start: { kind: "pos", line: sl, character: sc },
        end: { kind: "pos", line: el, character: ec },
    }),
    location: (uri, range) => ({ kind: "loc", uri, range }),
    isUri: (v): v is FakeUri => Boolean(v && typeof v === "object" && (v as FakeUri).kind === "uri"),
    isPosition: (v): v is FakePos => Boolean(v && typeof v === "object" && (v as FakePos).kind === "pos"),
    isRange: (v): v is FakeRange => Boolean(v && typeof v === "object" && (v as FakeRange).kind === "range"),
    isLocation: (v): v is FakeLocation => Boolean(v && typeof v === "object" && (v as FakeLocation).kind === "loc"),
};

describe("codelens-normalize", () => {
    const fallbackUri: FakeUri = { kind: "uri", value: "file:///fallback.tan" };

    it("normalizes 1-based VS Code marshalled arguments from codeLens/resolve", () => {
        const rawArgs = [
            { $mid: 1, scheme: "file", external: "file:///src/html.tan", path: "/src/html.tan" },
            { lineNumber: 2, column: 6 },
            [
                {
                    uri: { $mid: 1, scheme: "file", path: "/src/caller.tan" },
                    range: {
                        startLineNumber: 10,
                        startColumn: 3,
                        endLineNumber: 10,
                        endColumn: 15,
                    },
                },
            ],
        ];

        const [uri, pos, locs] = normalizeShowReferencesArgs(rawArgs, fallbackUri, FACTORIES);
        assert.deepStrictEqual(uri, { kind: "uri", value: "file:///src/html.tan" });
        assert.deepStrictEqual(pos, { kind: "pos", line: 1, character: 5 });
        assert.strictEqual(locs.length, 1);
        assert.deepStrictEqual(locs[0], {
            kind: "loc",
            uri: { kind: "uri", value: "file:///src/caller.tan" },
            range: {
                kind: "range",
                start: { kind: "pos", line: 9, character: 2 },
                end: { kind: "pos", line: 9, character: 14 },
            },
        });
    });

    it("normalizes 0-based generic LSP positions and string URIs", () => {
        const rawArgs = [
            "file:///src/app.tan",
            { line: 4, character: 2 },
            [
                {
                    uri: "file:///src/use.tan",
                    range: {
                        start: { line: 7, character: 1 },
                        end: { line: 7, character: 9 },
                    },
                },
            ],
        ];

        const [uri, pos, locs] = normalizeShowReferencesArgs(rawArgs, fallbackUri, FACTORIES);
        assert.deepStrictEqual(uri, { kind: "uri", value: "file:///src/app.tan" });
        assert.deepStrictEqual(pos, { kind: "pos", line: 4, character: 2 });
        assert.strictEqual(locs[0].range.start.line, 7);
        assert.strictEqual(locs[0].range.start.character, 1);
        assert.strictEqual(locs[0].range.end.character, 9);
    });

    it("falls back safely on missing/malformed values", () => {
        const [uri, pos, locs] = normalizeShowReferencesArgs([null, null, null], fallbackUri, FACTORIES);
        assert.deepStrictEqual(uri, fallbackUri);
        assert.deepStrictEqual(pos, { kind: "pos", line: 0, character: 0 });
        assert.deepStrictEqual(locs, []);
    });

    it("detects run-test CodeLens commands across flavors", () => {
        assert.strictEqual(isRunTestCodeLensCommand("tangu.runTestInExplorer"), true);
        assert.strictEqual(isRunTestCodeLensCommand("tangu.runTest"), true);
        assert.strictEqual(isRunTestCodeLensCommand("workbench.action.terminal.sendSequence"), true);
        assert.strictEqual(isRunTestCodeLensCommand("editor.action.showReferences"), false);
        assert.strictEqual(isRunTestCodeLensCommand(undefined), false);
    });
});
