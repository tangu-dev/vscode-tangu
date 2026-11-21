import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { runTanguCli } from "./cli-runner";
import { ExpandMacroResult } from "./lsp-custom-protocol";

export const TANGU_PREVIEW_SCHEME = "tangu-preview";

export type PreviewKind =
    | "macro-full"
    | "macro-step"
    | "ast"
    | "delimiters"
    | "js"
    | "tir"
    | "clif";

interface CursorPosition {
    line: number;
    character: number;
}

export interface PreviewProviderDeps {
    getClient: () => LanguageClient | undefined;
    resolveCliPath: () => string | undefined;
}

const DEBOUNCE_MS = 350;

/** Builds a stable `tangu-preview://` URI for `(kind, sourceUri)`. */
export function buildPreviewUri(kind: PreviewKind, sourceUri: vscode.Uri): vscode.Uri {
    const base = path.posix.basename(sourceUri.path || "untitled") || "untitled";
    const ext = kind === "macro-full" || kind === "macro-step"
        ? ".tan"
        : kind === "js"
            ? ".js"
            : ".txt";
    const query = new URLSearchParams({ source: sourceUri.toString() }).toString();
    return vscode.Uri.from({
        scheme: TANGU_PREVIEW_SCHEME,
        authority: kind,
        path: `/${base}${ext}`,
        query,
    });
}

function parsePreviewUri(uri: vscode.Uri): { kind: PreviewKind; sourceUri: vscode.Uri } | undefined {
    const source = new URLSearchParams(uri.query).get("source");
    if (!source) {
        return undefined;
    }
    return {
        kind: uri.authority as PreviewKind,
        sourceUri: vscode.Uri.parse(source),
    };
}

/** Read-only `TextDocumentContentProvider` backing macro expansion, AST, delimiter, JS, TIR, and CLIF previews. */
export class TanguPreviewProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    private readonly openPreviews = new Map<string, vscode.Uri>();
    private readonly macroPositions = new Map<string, CursorPosition>();
    private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
    private readonly inFlightAborts = new Map<string, AbortController>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly deps: PreviewProviderDeps) {
        this.disposables.push(
            this.onDidChangeEmitter,
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (doc.uri.scheme === TANGU_PREVIEW_SCHEME) {
                    const key = doc.uri.toString();
                    this.openPreviews.delete(key);
                    this.macroPositions.delete(key);
                    this.cancelPreviewWork(key);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                const sourceStr = event.document.uri.toString();
                for (const [key, previewUri] of this.openPreviews.entries()) {
                    const parsed = parsePreviewUri(previewUri);
                    if (!parsed || parsed.sourceUri.toString() !== sourceStr) {
                        continue;
                    }
                    if (!this.isPreviewCurrentlyOpen(key)) {
                        this.openPreviews.delete(key);
                        continue;
                    }
                    const existingTimer = this.debounceTimers.get(key);
                    if (existingTimer) {
                        clearTimeout(existingTimer);
                    }
                    this.debounceTimers.set(
                        key,
                        setTimeout(() => {
                            this.debounceTimers.delete(key);
                            this.onDidChangeEmitter.fire(previewUri);
                        }, DEBOUNCE_MS),
                    );
                }
            }),
            vscode.workspace.onDidSaveTextDocument((doc) => {
                const sourceStr = doc.uri.toString();
                for (const [key, previewUri] of this.openPreviews.entries()) {
                    const parsed = parsePreviewUri(previewUri);
                    if (!parsed || parsed.sourceUri.toString() !== sourceStr) {
                        continue;
                    }
                    const timer = this.debounceTimers.get(key);
                    if (timer) {
                        clearTimeout(timer);
                        this.debounceTimers.delete(key);
                    }
                    this.onDidChangeEmitter.fire(previewUri);
                }
            }),
        );
    }

    public register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            this,
            vscode.workspace.registerTextDocumentContentProvider(
                TANGU_PREVIEW_SCHEME,
                this,
            ),
            vscode.commands.registerCommand("tangu.expandMacro", () =>
                this.openPreview("macro-full"),
            ),
            vscode.commands.registerCommand("tangu.expandMacroStep", () =>
                this.openPreview("macro-step"),
            ),
            vscode.commands.registerCommand("tangu.syntaxTree", () =>
                this.openPreview("ast"),
            ),
            vscode.commands.registerCommand("tangu.showDelimiters", () =>
                this.openPreview("delimiters"),
            ),
            vscode.commands.registerCommand("tangu.showCompiledJs", () =>
                this.openPreview("js"),
            ),
            vscode.commands.registerCommand("tangu.showTir", () =>
                this.openPreview("tir"),
            ),
            vscode.commands.registerCommand("tangu.showClif", () =>
                this.openPreview("clif"),
            ),
        );
    }

    private isPreviewCurrentlyOpen(previewKey: string): boolean {
        return vscode.workspace.textDocuments.some(
            (doc) => doc.uri.toString() === previewKey,
        );
    }

    private cancelPreviewWork(key: string): void {
        const timer = this.debounceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(key);
        }
        const abort = this.inFlightAborts.get(key);
        if (abort) {
            abort.abort();
            this.inFlightAborts.delete(key);
        }
    }

    private async openPreview(kind: PreviewKind): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage("No active editor.");
            return;
        }

        const requiresTrust = kind === "macro-full" || kind === "macro-step" || kind === "js" || kind === "tir" || kind === "clif";
        if (requiresTrust && !vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage(
                "Tangu macro expansion and compiler IR previews are disabled in Restricted Mode.",
            );
            return;
        }

        const previewUri = buildPreviewUri(kind, editor.document.uri);
        const key = previewUri.toString();
        this.openPreviews.set(key, previewUri);

        if (kind === "macro-full" || kind === "macro-step") {
            const pos = editor.selection.active;
            this.macroPositions.set(key, { line: pos.line, character: pos.character });
        }

        if (this.isPreviewCurrentlyOpen(key)) {
            this.onDidChangeEmitter.fire(previewUri);
        }

        const doc = await vscode.workspace.openTextDocument(previewUri);
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: true,
        });
    }

    public async provideTextDocumentContent(
        uri: vscode.Uri,
        token: vscode.CancellationToken,
    ): Promise<string> {
        const key = uri.toString();
        this.openPreviews.set(key, uri);

        const priorAbort = this.inFlightAborts.get(key);
        if (priorAbort) {
            priorAbort.abort();
        }
        const abortController = new AbortController();
        this.inFlightAborts.set(key, abortController);
        const tokenSub = token.onCancellationRequested(() => abortController.abort());

        try {
            const parsed = parsePreviewUri(uri);
            if (!parsed) {
                return "// Invalid Tangu preview URI.\n";
            }
            const { kind, sourceUri } = parsed;
            const sourceDoc = vscode.workspace.textDocuments.find(
                (d) => d.uri.toString() === sourceUri.toString(),
            ) ?? (await vscode.workspace.openTextDocument(sourceUri));

            if (kind === "macro-full" || kind === "macro-step") {
                return await this.renderMacroExpansion(
                    key,
                    sourceDoc,
                    kind === "macro-step" ? "step" : "full",
                );
            }

            return await this.renderCliDump(kind, sourceDoc, abortController.signal);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return `// Preview error: ${msg}\n`;
        } finally {
            tokenSub.dispose();
            if (this.inFlightAborts.get(key) === abortController) {
                this.inFlightAborts.delete(key);
            }
        }
    }

    private async renderMacroExpansion(
        previewKey: string,
        sourceDoc: vscode.TextDocument,
        mode: "full" | "step",
    ): Promise<string> {
        const client = this.deps.getClient();
        if (!client) {
            return "; Tangu language server is not ready yet.\n";
        }
        const pos = this.macroPositions.get(previewKey) ?? { line: 0, character: 0 };
        const response = await client.sendRequest<ExpandMacroResult>(
            "workspace/executeCommand",
            {
                command: "tangu.expandMacroServer",
                arguments: [
                    {
                        uri: sourceDoc.uri.toString(),
                        position: pos,
                        mode,
                    },
                ],
            },
        );

        const commentLines = (text: string) =>
            text
                .split(/\r?\n/)
                .map((l) => `; ${l}`)
                .join("\n");

        if (response && response.success) {
            const header = `; Macro Expansion (${mode}) of:\n${commentLines(response.original)}\n\n`;
            if (!response.expanded.trim()) {
                return `${header}; ${response.message ?? "Expression was elided during macro expansion"}\n`;
            }
            return `${header}${response.expanded}\n`;
        }

        const err = response?.message ?? "Could not expand macro at cursor.";
        return `; Macro expansion (${mode}) failed:\n${commentLines(err)}\n`;
    }

    private async renderCliDump(
        kind: Exclude<PreviewKind, "macro-full" | "macro-step">,
        sourceDoc: vscode.TextDocument,
        signal: AbortSignal,
    ): Promise<string> {
        const cliPath = this.deps.resolveCliPath();
        if (!cliPath) {
            return "Tangu CLI (`tangu`) not found. Configure `tangu.cli.path` or add it to PATH.\n";
        }

        const flagMap: Record<Exclude<PreviewKind, "macro-full" | "macro-step">, string[]> = {
            ast: ["--ast", "--ranges"],
            delimiters: ["--delimiters"],
            js: ["--js"],
            tir: ["--tir"],
            clif: ["--clif"],
        };

        const stdinPath = sourceDoc.uri.scheme === "file"
            ? sourceDoc.uri.fsPath
            : "untitled.tan";
        const cwd = sourceDoc.uri.scheme === "file"
            ? path.dirname(sourceDoc.uri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        const args = [
            "dump",
            ...flagMap[kind],
            "--no-color",
            "--stdin-filepath",
            stdinPath,
        ];

        const result = await runTanguCli({
            cliPath,
            args,
            cwd,
            stdin: sourceDoc.getText(),
            signal,
        });

        if (result.aborted) {
            return "";
        }
        if (result.timedOut) {
            return `// Command timed out: tangu ${args.join(" ")}\n`;
        }

        const stdout = result.stdout.trimEnd();
        const stderr = result.stderr.trimEnd();
        if (result.exitCode !== 0) {
            const combined = [stderr, stdout].filter(Boolean).join("\n\n");
            return combined ? `${combined}\n` : `// tangu dump exited with code ${result.exitCode}\n`;
        }

        return stdout ? `${stdout}\n` : "(empty output)\n";
    }

    public dispose(): void {
        for (const key of Array.from(this.inFlightAborts.keys())) {
            this.cancelPreviewWork(key);
        }
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
