import * as path from "path";
import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { runTanguCli } from "./cli-runner";
import { createCodeLensMiddleware } from "./codelens-middleware";
import {
    getServerConfigOverrides,
    getServerEnv,
    resolveCliBinary,
    resolveServerBinary,
} from "./config";
import { TanguEvalReplManager } from "./eval-repl";
import { TanguPreviewProvider } from "./preview-provider";
import { ServerStatusSubscription } from "./server-status";
import { registerSexpCommands } from "./sexp";
import { TanguTaskProvider } from "./task-provider";
import { TanguTestController } from "./test-controller";

const RUN_FULL_WORKSPACE_DIAGNOSTICS_SERVER_COMMAND =
    "tangu.runFullWorkspaceDiagnostics";
const TANGU_LANGUAGE_IDS = ["tangu", "tangu-data", "tangu-test", "tangu-schema"];

let client: LanguageClient | undefined;
let isRestarting = false;

function buildDocumentSelector() {
    const selector = [];
    for (const language of TANGU_LANGUAGE_IDS) {
        selector.push({ scheme: "file", language });
        selector.push({ scheme: "untitled", language });
    }
    return selector;
}

async function requestFullWorkspaceDiagnostics(
    outputChannel: vscode.OutputChannel,
): Promise<void> {
    if (!client) {
        void vscode.window.showErrorMessage(
            "Tangu language server is not ready yet.",
        );
        return;
    }

    outputChannel.appendLine("Requesting full workspace diagnostics...");
    try {
        await client.sendRequest("workspace/executeCommand", {
            command: RUN_FULL_WORKSPACE_DIAGNOSTICS_SERVER_COMMAND,
            arguments: [],
        });
        void vscode.window.showInformationMessage(
            "Tangu: Requested full workspace diagnostics.",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(
            `Failed to request full workspace diagnostics: ${message}`,
        );
        void vscode.window.showErrorMessage(
            "Tangu: Failed to request full workspace diagnostics.",
        );
    }
}

async function pushServerConfiguration(
    outputChannel: vscode.OutputChannel,
): Promise<void> {
    if (!client) {
        return;
    }
    const overrides = getServerConfigOverrides();
    try {
        await client.sendNotification("workspace/didChangeConfiguration", {
            settings: { tangu: overrides },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Failed to sync configuration: ${message}`);
    }
}

/** Activates the Tangu VS Code extension. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const clientOutputChannel = vscode.window.createOutputChannel(
        "Tangu Language Client",
    );
    const serverTraceOutputChannel = vscode.window.createOutputChannel(
        "Tangu Language Server Trace",
    );
    const evalOutputChannel = vscode.window.createOutputChannel("Tangu Eval");

    const tanWatcher = vscode.workspace.createFileSystemWatcher("**/*.tan");
    const configWatcher = vscode.workspace.createFileSystemWatcher(
        "**/.tangu/config.data.tan",
    );

    const statusSubscription = new ServerStatusSubscription();

    context.subscriptions.push(
        clientOutputChannel,
        serverTraceOutputChannel,
        evalOutputChannel,
        tanWatcher,
        configWatcher,
        statusSubscription,
    );

    const startLanguageClient = async (): Promise<void> => {
        const serverPath = resolveServerBinary();
        if (!serverPath) {
            statusSubscription.setStatus("👅 Missing Server");
            clientOutputChannel.appendLine(
                "Cannot find `tangu-language-server`. Install the Tangu toolchain from https://tangu.dev or set `tangu.server.path`.",
            );
            const action = await vscode.window.showErrorMessage(
                "Tangu Language Server (`tangu-language-server`) was not found. Install the Tangu toolchain from https://tangu.dev or configure `tangu.server.path`.",
                "Configure Path",
                "Install Instructions",
            );
            if (action === "Configure Path") {
                void vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "@id:tangu.server.path",
                );
            } else if (action === "Install Instructions") {
                clientOutputChannel.appendLine(
                    "\nInstall instructions:\n  1. Install the Tangu toolchain from https://tangu.dev\n  2. Ensure `tangu` and `tangu-language-server` are in PATH (or set `tangu.server.path` / `tangu.cli.path`)\n  3. Run 'Tangu: Restart Language Server'.\n",
                );
                clientOutputChannel.show(true);
            }
            return;
        }

        const env = getServerEnv();
        const serverOptions: ServerOptions = {
            run: {
                command: serverPath,
                transport: TransportKind.stdio,
                options: { env },
            },
            debug: {
                command: serverPath,
                transport: TransportKind.stdio,
                options: { env },
            },
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: buildDocumentSelector(),
            traceOutputChannel: serverTraceOutputChannel,
            synchronize: {
                fileEvents: [tanWatcher, configWatcher],
            },
            middleware: createCodeLensMiddleware(),
        };

        const nextClient = new LanguageClient(
            "tangu",
            "Tangu Language",
            serverOptions,
            clientOptions,
        );
        client = nextClient;
        statusSubscription.attach(nextClient);

        try {
            await nextClient.start();
            await pushServerConfiguration(clientOutputChannel);
            clientOutputChannel.appendLine(
                `Tangu LSP Client started using: ${serverPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            statusSubscription.setStatus("👅 Error");
            clientOutputChannel.appendLine(
                `Failed to start Tangu Language Server: ${message}`,
            );
            void vscode.window.showErrorMessage(
                `Tangu Language Server failed to start: ${message}`,
            );
        }
    };

    const restartServer = async (): Promise<void> => {
        if (isRestarting) {
            return;
        }
        isRestarting = true;
        statusSubscription.setStatus("👅 Restarting...");
        try {
            if (client) {
                const oldClient = client;
                client = undefined;
                try {
                    await oldClient.stop();
                } catch {
                    // Ignore stop error when restarting a failed server
                }
                oldClient.dispose();
            }
            await startLanguageClient();
        } finally {
            isRestarting = false;
        }
    };

    const ensureCliOrNotify = (): string | undefined => {
        const cliPath = resolveCliBinary();
        if (!cliPath) {
            void vscode.window.showErrorMessage(
                "Tangu CLI (`tangu`) not found. Configure `tangu.cli.path` or add it to PATH.",
                "Configure Path",
            ).then((choice) => {
                if (choice === "Configure Path") {
                    void vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "@id:tangu.cli.path",
                    );
                }
            });
        }
        return cliPath;
    };

    const evalReplManager = new TanguEvalReplManager({
        getClient: () => client,
        resolveCliPath: resolveCliBinary,
        evalOutputChannel,
    });
    evalReplManager.registerCommands(context);

    const previewProvider = new TanguPreviewProvider({
        getClient: () => client,
        resolveCliPath: resolveCliBinary,
    });
    previewProvider.register(context);

    const testController = new TanguTestController({
        resolveCliPath: resolveCliBinary,
        outputChannel: clientOutputChannel,
    });
    testController.register(context);

    const taskProvider = new TanguTaskProvider(resolveCliBinary);
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider("tangu", taskProvider),
    );

    registerSexpCommands(context);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "tangu.requestFullWorkspaceDiagnostics",
            () => requestFullWorkspaceDiagnostics(clientOutputChannel),
        ),
        vscode.commands.registerCommand("tangu.restartServer", () =>
            restartServer(),
        ),
        vscode.commands.registerCommand("tangu.openServerLogs", () => {
            if (client?.outputChannel) {
                client.outputChannel.show(true);
            } else {
                clientOutputChannel.show(true);
            }
        }),
        vscode.commands.registerCommand("tangu.showStatusMenu", async () => {
            const pick = await vscode.window.showQuickPick(
                [
                    { label: "$(refresh) Restart Language Server", command: "tangu.restartServer" },
                    {
                        label: "$(checklist) Run Full Workspace Diagnostics",
                        command: "tangu.requestFullWorkspaceDiagnostics",
                    },
                    { label: "$(terminal) Open REPL Terminal", command: "tangu.openREPL" },
                    { label: "$(beaker) Run Changed Tests", command: "tangu.runChangedTests" },
                    {
                        label: "$(sparkle) Fix & Format Current File",
                        command: "tangu.runFix",
                    },
                    { label: "$(pulse) Run Environment Doctor", command: "tangu.runDoctor" },
                    { label: "$(output) Open Server Logs", command: "tangu.openServerLogs" },
                    { label: "$(gear) Open Tangu Settings", command: "__settings__" },
                ],
                { placeHolder: "Tangu Language Actions" },
            );
            if (!pick) {
                return;
            }
            if (pick.command === "__settings__") {
                void vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "@ext:tangu-dev.vscode-tangu",
                );
            } else {
                void vscode.commands.executeCommand(pick.command);
            }
        }),
        vscode.commands.registerCommand("tangu.runFix", async () => {
            if (!vscode.workspace.isTrusted) {
                void vscode.window.showWarningMessage(
                    "Tangu fix is disabled in Restricted Mode.",
                );
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== "file") {
                void vscode.window.showWarningMessage(
                    "Tangu: Save the file to disk before running `tangu fix`.",
                );
                return;
            }
            const cliPath = ensureCliOrNotify();
            if (!cliPath) {
                return;
            }
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            const filePath = editor.document.uri.fsPath;
            const res = await runTanguCli({
                cliPath,
                args: ["fix", "--auto-import", "--no-color", filePath],
                cwd: path.dirname(filePath),
                timeoutMs: 20_000,
            });
            if (res.exitCode === 0) {
                void vscode.window.setStatusBarMessage("Tangu: File fixed & formatted.", 3000);
            } else {
                const details = (res.stderr || res.stdout).trim();
                if (details) {
                    clientOutputChannel.appendLine(`[tangu fix]\n${details}`);
                    clientOutputChannel.show(true);
                }
                void vscode.window.showWarningMessage(
                    "Tangu: `tangu fix` reported issues. See Tangu Language Client output.",
                );
            }
        }),
        vscode.commands.registerCommand("tangu.runDoctor", async () => {
            if (!vscode.workspace.isTrusted) {
                void vscode.window.showWarningMessage(
                    "Tangu doctor is disabled in Restricted Mode.",
                );
                return;
            }
            const cliPath = ensureCliOrNotify();
            if (!cliPath) {
                return;
            }
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const res = await runTanguCli({
                cliPath,
                args: ["doctor", "--no-color"],
                cwd,
                timeoutMs: 15_000,
            });
            clientOutputChannel.appendLine("=== tangu doctor ===");
            clientOutputChannel.appendLine((res.stdout || res.stderr).trimEnd());
            clientOutputChannel.appendLine("");
            clientOutputChannel.show(true);
        }),
        vscode.commands.registerCommand("tangu.runFile", async () => {
            if (!vscode.workspace.isTrusted) {
                void vscode.window.showWarningMessage(
                    "Running Tangu files is disabled in Restricted Mode.",
                );
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== "file") {
                void vscode.window.showWarningMessage(
                    "Tangu: Open and save a `.tan` file on disk to run it.",
                );
                return;
            }
            const cliPath = ensureCliOrNotify();
            if (!cliPath) {
                return;
            }
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            const filePath = editor.document.uri.fsPath;
            const cwd = path.dirname(filePath);
            const task = new vscode.Task(
                { type: "tangu", command: "run", args: [filePath] },
                vscode.workspace.getWorkspaceFolder(editor.document.uri) ??
                    vscode.TaskScope.Workspace,
                `run ${path.basename(filePath)}`,
                "tangu",
                new vscode.ProcessExecution(cliPath, ["run", filePath], { cwd }),
                "$tangu",
            );
            task.presentationOptions = {
                reveal: vscode.TaskRevealKind.Always,
                panel: vscode.TaskPanelKind.Shared,
                clear: true,
            };
            await vscode.tasks.executeTask(task);
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (
                event.affectsConfiguration("tangu.server.path") ||
                event.affectsConfiguration("tangu.server.extraEnv") ||
                event.affectsConfiguration("tangu.server.logLevel")
            ) {
                const choice = await vscode.window.showInformationMessage(
                    "Tangu Language Server settings changed. Restart the server to apply?",
                    "Restart Server",
                );
                if (choice === "Restart Server") {
                    await restartServer();
                }
            } else if (
                event.affectsConfiguration("tangu.lint") ||
                event.affectsConfiguration("tangu.format") ||
                event.affectsConfiguration("tangu.diagnostics")
            ) {
                await pushServerConfiguration(clientOutputChannel);
            }
        }),
    );

    await startLanguageClient();
}

/** Deactivates the extension. */
export async function deactivate(): Promise<void> {
    if (client) {
        const running = client;
        client = undefined;
        await running.stop();
    }
}
