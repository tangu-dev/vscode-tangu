import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ExtensionContext, workspace } from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { ServerStatusSubscription } from "./server-status";

// #todo different path for windows/unix?

/// The Tangu CLI executable name.
const TANGU_CLI = "tangu";

// #tip Install the server with `cargo install tangu-language-server`.

/// The Tangu Language Server executable name.
const TANGU_LANGUAGE_SERVER = "tangu-language-server";

/// The name of the Tangu REPL terminal.
const TANGU_REPL_TERMINAL_NAME = "Tangu REPL";

/// The LSP executeCommand ID for full workspace diagnostics.
const RUN_FULL_WORKSPACE_DIAGNOSTICS_SERVER_COMMAND =
    "tangu.runFullWorkspaceDiagnostics";

/// The VS Code command ID for requesting full workspace diagnostics.
const RUN_FULL_WORKSPACE_DIAGNOSTICS_VSCODE_COMMAND =
    "tangu.requestFullWorkspaceDiagnostics";

let client: LanguageClient;

function executableExists(name: string): boolean {
    const envPath = process.env["PATH"];

    if (!envPath) {
        return false;
    }

    return envPath.split(path.delimiter)
        .some((x) => fs.existsSync(path.resolve(x, name)));
}

// focusTextEditor:
// vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");

/**
 * Creates a new REPL process.
 */
function createREPLTerminal(): Thenable<vscode.Terminal> {
    const terminal = vscode.window.createTerminal(TANGU_REPL_TERMINAL_NAME);
    terminal.sendText(TANGU_CLI, true);

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Opening Tangu REPL...",
        cancellable: false,
    }, () => {
        return new Promise<vscode.Terminal>((resolve) => {
            terminal.show();
            resolve(terminal);
        });
    });
}

/**
 * Opens a terminal with a Tangu REPL. If a REPL process is already spawned, it
 * is reused.
 */
function openREPLTerminal(): Thenable<vscode.Terminal> {
    let terminal =
        vscode.window.terminals.find((t) =>
            t.name === TANGU_REPL_TERMINAL_NAME
        ) ??
            createREPLTerminal();

    return Promise.resolve(terminal).then((t) => {
        t.show();
        return t;
    });
}

/** Requests full workspace diagnostics from the language server. */
async function requestFullWorkspaceDiagnostics(
    outputChannel: vscode.OutputChannel,
): Promise<void> {
    if (!client) {
        void vscode.window.showErrorMessage(
            "Tangu language server is not ready yet.",
        );
        return;
    }

    outputChannel.appendLine("Request full workspace diagnostics");

    try {
        await client.sendRequest("workspace/executeCommand", {
            command: RUN_FULL_WORKSPACE_DIAGNOSTICS_SERVER_COMMAND,
            arguments: [],
        });

        void vscode.window.showInformationMessage(
            "Tangu: Requested full workspace diagnostics.",
        );
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Unknown error";

        outputChannel.appendLine(
            `Failed to request full workspace diagnostics: ${message}`,
        );

        void vscode.window.showErrorMessage(
            "Tangu: Failed to request full workspace diagnostics.",
        );
    }
}

/** Activates the extension. */
export function activate(context: ExtensionContext) {
    // Logs client messages to Output > Tangu Language Client
    const clientOutputChannel = vscode.window.createOutputChannel(
        "Tangu Language Client",
    );
    clientOutputChannel.show(true);

    // Logs server messages to Output > Tab Language Server Trace
    const serverTraceOutputChannel = vscode.window.createOutputChannel(
        "Tangu Language Server Trace",
    );

    // #Insight
    // Server output (eprintln!) is logged to Output > Tangu Language

    // #todo consider other TransportKinds?

    // #todo make logging level a client option?

    // #todo RA_LOG trace does _not_ work, investigate.
    // Control server logging level.
    const env = Object.assign({}, process.env);
    Object.assign(env, { RUST_LOG: "trace" });

    if (!executableExists(TANGU_LANGUAGE_SERVER)) {
        clientOutputChannel.appendLine(
            "Cannot find the Tangu Language Server, please install with `cargo install tangu-language-server`!",
        );
    }

    const serverOptions: ServerOptions = {
        run: {
            command: TANGU_LANGUAGE_SERVER,
            transport: TransportKind.stdio,
            options: { env },
        },
        debug: {
            command: TANGU_LANGUAGE_SERVER,
            transport: TransportKind.stdio,
            options: { env },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "tangu" },
            { scheme: "file", language: "tangu-data" },
            { scheme: "file", language: "tangu-test" },
        ],
        traceOutputChannel: serverTraceOutputChannel,
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher("**/*.tan"),
        },
    };

    context.subscriptions.push(vscode.commands.registerCommand(
        "tangu.openREPL",
        () => {
            clientOutputChannel.appendLine("Open REPL");
            openREPLTerminal();
        },
    ));

    context.subscriptions.push(vscode.commands.registerCommand(
        RUN_FULL_WORKSPACE_DIAGNOSTICS_VSCODE_COMMAND,
        () => requestFullWorkspaceDiagnostics(clientOutputChannel),
    ));

    context.subscriptions.push(
        vscode.commands.registerCommand("tangu.syntaxTree", (args) => {
            // #todo
        }),
    );

    client = new LanguageClient(
        "tangu",
        "Tangu Language",
        serverOptions,
        clientOptions,
    );

    client.start();

    context.subscriptions.push(
        new ServerStatusSubscription(client, clientOutputChannel),
    );

    //   // debugging.
    //   for (const tg of vscode.window.tabGroups.all) {
    //     for (const t of tg.tabs) {
    //       clientOutputChannel.appendLine(t.label);
    //     }
    //   }

    // #insight no need for js outline provider, the LSP handles this!
    //   const outlineProvider = new OutlineProvider();
    //   vscode.window.registerTreeDataProvider("outline", outlineProvider);

    clientOutputChannel.appendLine(
        "Tangu LSP Client initialized.",
    );
}

/** Deactivates the extension. */
export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }

    return client.stop();
}
