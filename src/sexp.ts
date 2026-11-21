import * as vscode from "vscode";
import {
    barfForward,
    EditOutcome,
    raiseForm,
    slurpForward,
    spliceForm,
    wrapRange,
} from "./sexp-core";

async function applyStructuralEdit(
    editor: vscode.TextEditor,
    compute: (text: string, startOffset: number, endOffset: number) => EditOutcome | undefined,
): Promise<void> {
    const doc = editor.document;
    const text = doc.getText();
    const startOffset = doc.offsetAt(editor.selection.start);
    const endOffset = doc.offsetAt(editor.selection.end);

    const outcome = compute(text, startOffset, endOffset);
    if (!outcome) {
        return;
    }

    const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(text.length),
    );
    const applied = await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, outcome.text);
    });
    if (applied) {
        const nextAnchor = editor.document.positionAt(outcome.selectionStart);
        const nextActive = editor.document.positionAt(outcome.selectionEnd);
        editor.selection = new vscode.Selection(nextAnchor, nextActive);
    }
}

/** Registers lightweight Paredit-style structural S-expression editing commands. */
export function registerSexpCommands(context: vscode.ExtensionContext): void {
    const registerEditorEdit = (
        command: string,
        fn: (text: string, start: number, end: number) => EditOutcome | undefined,
    ) => {
        context.subscriptions.push(
            vscode.commands.registerTextEditorCommand(command, (editor) => {
                void applyStructuralEdit(editor, fn);
            }),
        );
    };

    registerEditorEdit("tangu.wrapParens", (text, s, e) => wrapRange(text, s, e, "("));
    registerEditorEdit("tangu.wrapBrackets", (text, s, e) => wrapRange(text, s, e, "["));
    registerEditorEdit("tangu.wrapBraces", (text, s, e) => wrapRange(text, s, e, "{"));
    registerEditorEdit("tangu.slurpForward", (text, s) => slurpForward(text, s));
    registerEditorEdit("tangu.barfForward", (text, s) => barfForward(text, s));
    registerEditorEdit("tangu.spliceForm", (text, s) => spliceForm(text, s));
    registerEditorEdit("tangu.raiseForm", (text, s) => raiseForm(text, s));
}
