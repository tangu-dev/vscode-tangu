import * as vscode from "vscode";
import { Middleware } from "vscode-languageclient/node";
import {
    isRunTestCodeLensCommand,
    normalizeShowReferencesArgs,
    ShowReferencesFactories,
} from "./codelens-normalize";

const VS_CODE_FACTORIES: ShowReferencesFactories<
    vscode.Uri,
    vscode.Position,
    vscode.Range,
    vscode.Location
> = {
    uriFromString: (value) => vscode.Uri.parse(value),
    uriFromFilePath: (filePath) => vscode.Uri.file(filePath),
    position: (line, character) => new vscode.Position(line, character),
    range: (sl, sc, el, ec) => new vscode.Range(sl, sc, el, ec),
    location: (uri, range) => new vscode.Location(uri, range),
    isUri: (value): value is vscode.Uri => value instanceof vscode.Uri,
    isPosition: (value): value is vscode.Position => value instanceof vscode.Position,
    isRange: (value): value is vscode.Range => value instanceof vscode.Range,
    isLocation: (value): value is vscode.Location => value instanceof vscode.Location,
};

function normalizeLens(lens: vscode.CodeLens, fallbackUri: vscode.Uri): vscode.CodeLens {
    const cmd = lens.command;
    if (
        cmd &&
        cmd.command === "editor.action.showReferences" &&
        Array.isArray(cmd.arguments) &&
        cmd.arguments.length >= 3
    ) {
        cmd.arguments = normalizeShowReferencesArgs(
            cmd.arguments,
            fallbackUri,
            VS_CODE_FACTORIES,
        );
    }
    return lens;
}

/** Builds CodeLens middleware that filters optional test lenses and coerces reference args. */
export function createCodeLensMiddleware(): Middleware {
    return {
        provideCodeLenses: async (document, token, next) => {
            const lenses = await next(document, token);
            if (!lenses) {
                return lenses;
            }
            const showRunTestLenses = vscode.workspace
                .getConfiguration("tangu", document.uri)
                .get<boolean>("codeLens.runTest", true);

            const filtered = showRunTestLenses
                ? lenses
                : lenses.filter((lens) => !isRunTestCodeLensCommand(lens.command?.command));

            return filtered.map((lens) => normalizeLens(lens, document.uri));
        },
        resolveCodeLens: async (codeLens, token, next) => {
            const resolved = await next(codeLens, token);
            if (!resolved) {
                return resolved;
            }
            const fallbackUri = vscode.window.activeTextEditor?.document.uri
                ?? vscode.Uri.file("/");
            return normalizeLens(resolved, fallbackUri);
        },
    };
}
