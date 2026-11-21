import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { getEvalTimeoutMs } from "./config";
import { EvalExpressionResult } from "./lsp-custom-protocol";
import { findTopLevelForm, prepareForRepl } from "./sexp-core";

const TANGU_REPL_TERMINAL_NAME = "Tangu REPL";
const EVAL_EXPRESSION_SERVER_COMMAND = "tangu.evalExpression";

export interface EvalReplDeps {
    getClient: () => LanguageClient | undefined;
    resolveCliPath: () => string | undefined;
    evalOutputChannel: vscode.OutputChannel;
}

function summarizeInlineResult(res: EvalExpressionResult): { text: string; isError: boolean } {
    if (res.timed_out) {
        return { text: " => [timed out]", isError: true };
    }
    if (!res.success) {
        const errLine = (res.stderr || res.stdout || `exit ${res.exit_code ?? "error"}`)
            .trim()
            .split(/\r?\n/)[0]
            .trim();
        const clipped = errLine.length > 90 ? `${errLine.slice(0, 87)}...` : errLine;
        return { text: ` => [error] ${clipped}`, isError: true };
    }
    const compact = res.stdout.trim().replace(/\s+/g, " ");
    const display = compact.length > 0 ? compact : "()";
    const clipped = display.length > 90 ? `${display.slice(0, 87)}...` : display;
    return { text: ` => ${clipped}`, isError: false };
}

/** Manages inline LSP expression evaluation decorations and Tangu REPL terminal commands. */
export class TanguEvalReplManager implements vscode.Disposable {
    private readonly okDecorationType: vscode.TextEditorDecorationType;
    private readonly errDecorationType: vscode.TextEditorDecorationType;
    private readonly docOkDecorations = new Map<string, vscode.DecorationOptions[]>();
    private readonly docErrDecorations = new Map<string, vscode.DecorationOptions[]>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly deps: EvalReplDeps) {
        this.okDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: "0 0 0 1.5em",
                fontStyle: "italic",
                color: new vscode.ThemeColor("editorCodeLens.foreground"),
            },
        });
        this.errDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: "0 0 0 1.5em",
                fontStyle: "italic",
                color: new vscode.ThemeColor("editorError.foreground"),
            },
        });

        this.disposables.push(
            this.okDecorationType,
            this.errDecorationType,
            vscode.workspace.onDidChangeTextDocument((event) => {
                this.clearDocumentDecorations(event.document.uri);
            }),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.applyDecorationsToEditor(editor);
                }
            }),
            vscode.workspace.onDidCloseTextDocument((doc) => {
                const key = doc.uri.toString();
                this.docOkDecorations.delete(key);
                this.docErrDecorations.delete(key);
            }),
        );
    }

    public registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            this,
            vscode.commands.registerCommand("tangu.evalSelectionOrForm", () =>
                this.evalSelectionOrForm(),
            ),
            vscode.commands.registerCommand("tangu.evalExpressionPrompt", () =>
                this.evalExpressionPrompt(),
            ),
            vscode.commands.registerCommand("tangu.clearEvalResults", () =>
                this.clearAllDecorations(),
            ),
            vscode.commands.registerCommand("tangu.openREPL", () => {
                void this.openReplTerminal();
            }),
            vscode.commands.registerCommand("tangu.sendSelectionToREPL", () =>
                this.sendToRepl("selection"),
            ),
            vscode.commands.registerCommand("tangu.sendFormToREPL", () =>
                this.sendToRepl("form"),
            ),
            vscode.commands.registerCommand("tangu.sendFileToREPL", () =>
                this.sendToRepl("file"),
            ),
        );
    }

    private ensureTrusted(): boolean {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage(
                "Tangu code evaluation and REPL execution are disabled in Restricted Mode.",
            );
            return false;
        }
        return true;
    }

    private extractTargetRangeAndText(
        editor: vscode.TextEditor,
        mode: "selection" | "form" | "file",
    ): { range: vscode.Range; text: string } | undefined {
        const doc = editor.document;
        if (mode === "file") {
            const text = doc.getText();
            const lastLine = Math.max(0, doc.lineCount - 1);
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                doc.lineAt(lastLine).range.end,
            );
            return text.trim() ? { range, text } : undefined;
        }

        if (!editor.selection.isEmpty) {
            const text = doc.getText(editor.selection);
            return text.trim() ? { range: editor.selection, text } : undefined;
        }

        if (mode === "selection") {
            return undefined;
        }

        const fullText = doc.getText();
        const offset = doc.offsetAt(editor.selection.active);
        const span = findTopLevelForm(fullText, offset);
        if (!span) {
            return undefined;
        }
        const range = new vscode.Range(doc.positionAt(span.start), doc.positionAt(span.end));
        const text = fullText.slice(span.start, span.end);
        return text.trim() ? { range, text } : undefined;
    }

    private buildEvalCommandArg(
        expression: string,
        doc?: vscode.TextDocument,
    ): Record<string, unknown> {
        const arg: Record<string, unknown> = {
            expression,
            timeoutMs: getEvalTimeoutMs(),
        };
        if (doc && doc.uri.scheme === "file") {
            const folders = vscode.workspace.workspaceFolders;
            const inWorkspace =
                !folders ||
                folders.length === 0 ||
                vscode.workspace.getWorkspaceFolder(doc.uri) !== undefined;
            if (inWorkspace) {
                arg.uri = doc.uri.toString();
            }
        }
        return arg;
    }

    private async executeEval(
        expression: string,
        doc?: vscode.TextDocument,
    ): Promise<EvalExpressionResult | undefined> {
        const client = this.deps.getClient();
        if (!client) {
            void vscode.window.showErrorMessage("Tangu language server is not ready yet.");
            return undefined;
        }

        const result = await client.sendRequest<EvalExpressionResult>(
            "workspace/executeCommand",
            {
                command: EVAL_EXPRESSION_SERVER_COMMAND,
                arguments: [this.buildEvalCommandArg(expression, doc)],
            },
        );

        this.logEvalResult(expression, result);
        return result;
    }

    private logEvalResult(expression: string, res: EvalExpressionResult): void {
        const out = this.deps.evalOutputChannel;
        out.appendLine(`> ${expression.trim()}`);
        if (res.stdout.trim()) {
            out.appendLine(res.stdout.trimEnd());
        }
        if (res.stderr.trim()) {
            out.appendLine(`[stderr] ${res.stderr.trimEnd()}`);
        }
        if (res.timed_out) {
            out.appendLine("[timed out]");
        }
        if (res.truncated) {
            out.appendLine("[output truncated]");
        }
        out.appendLine("");
    }

    private async evalSelectionOrForm(): Promise<void> {
        if (!this.ensureTrusted()) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage("No active editor.");
            return;
        }

        const target = this.extractTargetRangeAndText(editor, "form");
        if (!target) {
            void vscode.window.showWarningMessage("Tangu: No expression found to evaluate.");
            return;
        }

        try {
            const res = await this.executeEval(target.text, editor.document);
            if (!res) {
                return;
            }
            const summary = summarizeInlineResult(res);
            const endLine = target.range.end.line;
            const lineEnd = editor.document.lineAt(endLine).range.end;
            const decRange = new vscode.Range(lineEnd, lineEnd);
            const decoration: vscode.DecorationOptions = {
                range: decRange,
                renderOptions: {
                    after: {
                        contentText: summary.text,
                    },
                },
                hoverMessage: new vscode.MarkdownString(
                    `\`\`\`text\n${(res.stdout || res.stderr || "()").trim()}\n\`\`\``,
                ),
            };

            const key = editor.document.uri.toString();
            const okList = (this.docOkDecorations.get(key) ?? []).filter(
                (d) => d.range.start.line !== endLine,
            );
            const errList = (this.docErrDecorations.get(key) ?? []).filter(
                (d) => d.range.start.line !== endLine,
            );
            if (summary.isError) {
                errList.push(decoration);
            } else {
                okList.push(decoration);
            }
            this.docOkDecorations.set(key, okList);
            this.docErrDecorations.set(key, errList);
            this.applyDecorationsForUri(editor.document.uri);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Tangu eval failed: ${message}`);
        }
    }

    private async evalExpressionPrompt(): Promise<void> {
        if (!this.ensureTrusted()) {
            return;
        }
        const expr = await vscode.window.showInputBox({
            prompt: "Enter a Tangu expression to evaluate",
            placeHolder: "(+ 1 2)",
        });
        if (!expr?.trim()) {
            return;
        }

        try {
            const res = await this.executeEval(expr, vscode.window.activeTextEditor?.document);
            if (!res) {
                return;
            }
            this.deps.evalOutputChannel.show(true);
            if (res.success) {
                const out = res.stdout.trim() || "()";
                void vscode.window.showInformationMessage(`Tangu: ${out}`);
            } else {
                const err = res.stderr.trim() || res.stdout.trim() || "Evaluation failed";
                void vscode.window.showErrorMessage(`Tangu eval error: ${err}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Tangu eval failed: ${message}`);
        }
    }

    private applyDecorationsToEditor(editor: vscode.TextEditor): void {
        const key = editor.document.uri.toString();
        editor.setDecorations(this.okDecorationType, this.docOkDecorations.get(key) ?? []);
        editor.setDecorations(this.errDecorationType, this.docErrDecorations.get(key) ?? []);
    }

    private applyDecorationsForUri(uri: vscode.Uri): void {
        const key = uri.toString();
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === key) {
                this.applyDecorationsToEditor(editor);
            }
        }
    }

    private clearDocumentDecorations(uri: vscode.Uri): void {
        const key = uri.toString();
        if (!this.docOkDecorations.has(key) && !this.docErrDecorations.has(key)) {
            return;
        }
        this.docOkDecorations.delete(key);
        this.docErrDecorations.delete(key);
        this.applyDecorationsForUri(uri);
    }

    private clearAllDecorations(): void {
        this.docOkDecorations.clear();
        this.docErrDecorations.clear();
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.okDecorationType, []);
            editor.setDecorations(this.errDecorationType, []);
        }
    }

    private async openReplTerminal(preserveFocus = false): Promise<vscode.Terminal | undefined> {
        if (!this.ensureTrusted()) {
            return undefined;
        }

        const existing = vscode.window.terminals.find(
            (t) => t.name === TANGU_REPL_TERMINAL_NAME && t.exitStatus === undefined,
        );
        if (existing) {
            existing.show(preserveFocus);
            return existing;
        }

        const cliPath = this.deps.resolveCliPath();
        if (!cliPath) {
            void vscode.window.showErrorMessage(
                "Tangu CLI (`tangu`) not found. Configure `tangu.cli.path` or add it to PATH.",
            );
            return undefined;
        }

        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const cwd = activeUri?.scheme === "file"
            ? path.dirname(activeUri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        const terminal = vscode.window.createTerminal({
            name: TANGU_REPL_TERMINAL_NAME,
            shellPath: cliPath,
            shellArgs: ["repl"],
            cwd,
        });
        terminal.show(preserveFocus);
        return terminal;
    }

    private async sendToRepl(mode: "selection" | "form" | "file"): Promise<void> {
        if (!this.ensureTrusted()) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage("No active editor.");
            return;
        }

        const target = this.extractTargetRangeAndText(editor, mode);
        if (!target) {
            void vscode.window.showWarningMessage("Tangu: Nothing selected or at cursor to send to REPL.");
            return;
        }

        const lines = prepareForRepl(target.text);
        if (lines.length === 0) {
            void vscode.window.showWarningMessage("Tangu: No expressions found to send to REPL.");
            return;
        }

        const hadTerminal = vscode.window.terminals.some(
            (t) => t.name === TANGU_REPL_TERMINAL_NAME && t.exitStatus === undefined,
        );
        const terminal = await this.openReplTerminal(true);
        if (!terminal) {
            return;
        }

        // Wait briefly on initial launch so rustyline initializes before receiving stdin.
        if (!hadTerminal) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        for (const line of lines) {
            terminal.sendText(line, true);
        }
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
