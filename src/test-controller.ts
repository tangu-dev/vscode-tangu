import * as path from "path";
import * as vscode from "vscode";
import { runTanguCli } from "./cli-runner";
import {
    buildTestArgs,
    ListedTestEntry,
    parseTestListJson,
    parseTestRunJson,
    TestFailureDetail,
    toZeroBasedPosition,
} from "./test-protocol";

export interface TestControllerDeps {
    resolveCliPath: () => string | undefined;
    outputChannel: vscode.OutputChannel;
}

interface CodeLensTestArg {
    uri?: string;
    directory?: string;
    name?: string;
    pattern?: string;
}

/** Native VS Code TestController backed by `tangu test --list --json` and `tangu test --json`. */
export class TanguTestController implements vscode.Disposable {
    private readonly controller: vscode.TestController;
    private readonly disposables: vscode.Disposable[] = [];
    private discoveryTimer: NodeJS.Timeout | undefined;
    private discoveryQueue: Promise<void> = Promise.resolve();

    constructor(private readonly deps: TestControllerDeps) {
        this.controller = vscode.tests.createTestController(
            "tanguTestController",
            "Tangu Tests",
        );
        this.controller.resolveHandler = async (item) => {
            if (!item) {
                await this.discoverAllTests();
            } else if (item.uri && item.id.startsWith("file:")) {
                await this.discoverSingleFile(item.uri);
            }
        };

        this.controller.createRunProfile(
            "Run Tangu Tests",
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runTests(request, token),
            true,
        );

        const watcher = vscode.workspace.createFileSystemWatcher("**/*.test.tan");
        const scheduleRefresh = () => this.scheduleDiscovery();

        this.disposables.push(
            this.controller,
            watcher,
            watcher.onDidCreate(scheduleRefresh),
            watcher.onDidChange(scheduleRefresh),
            watcher.onDidDelete(scheduleRefresh),
            vscode.workspace.onDidGrantWorkspaceTrust(() => {
                void this.discoverAllTests();
            }),
        );
    }

    public register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            this,
            vscode.commands.registerCommand("tangu.runTestInExplorer", (arg?: CodeLensTestArg) =>
                this.runFromCodeLens(arg),
            ),
            vscode.commands.registerCommand("tangu.runChangedTests", () =>
                this.runChangedTests(),
            ),
        );
        void this.discoverAllTests();
    }

    private scheduleDiscovery(): void {
        if (this.discoveryTimer) {
            clearTimeout(this.discoveryTimer);
        }
        this.discoveryTimer = setTimeout(() => {
            this.discoveryTimer = undefined;
            void this.discoverAllTests();
        }, 300);
    }

    private enqueueDiscovery(task: () => Promise<void>): Promise<void> {
        this.discoveryQueue = this.discoveryQueue.then(task, task);
        return this.discoveryQueue;
    }

    public discoverAllTests(): Promise<void> {
        return this.enqueueDiscovery(async () => {
            if (!vscode.workspace.isTrusted) {
                return;
            }
            const cliPath = this.deps.resolveCliPath();
            const folders = vscode.workspace.workspaceFolders;
            if (!cliPath || !folders || folders.length === 0) {
                return;
            }

            const seenFileIds = new Set<string>();

            for (const folder of folders) {
                const rootPath = folder.uri.fsPath;
                const listed = await this.listFolderWithFallback(cliPath, folder);
                const byFile = new Map<string, ListedTestEntry[]>();

                for (const entry of listed) {
                    const absFile = path.isAbsolute(entry.file)
                        ? entry.file
                        : path.resolve(rootPath, entry.file);
                    const arr = byFile.get(absFile) ?? [];
                    arr.push({ ...entry, file: absFile });
                    byFile.set(absFile, arr);
                }

                for (const [absFile, entries] of byFile.entries()) {
                    const fileId = `file:${absFile}`;
                    seenFileIds.add(fileId);
                    this.upsertFileItem(absFile, entries);
                }
            }

            for (const [id] of this.controller.items) {
                if (!seenFileIds.has(id)) {
                    this.controller.items.delete(id);
                }
            }
        });
    }

    private async listFolderWithFallback(
        cliPath: string,
        folder: vscode.WorkspaceFolder,
    ): Promise<ListedTestEntry[]> {
        const rootPath = folder.uri.fsPath;
        try {
            const res = await runTanguCli({
                cliPath,
                args: ["test", "--list", "--json", "--no-color", rootPath],
                cwd: rootPath,
                timeoutMs: 15_000,
            });
            if (res.exitCode === 0 && res.stdout.trim()) {
                return parseTestListJson(res.stdout).tests;
            }
        } catch {
            // Fall through to per-file discovery below so one broken file doesn't hide healthy suites.
        }

        const testUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*.test.tan"),
            "**/{node_modules,.git,target}/**",
        );
        const collected: ListedTestEntry[] = [];
        for (const uri of testUris) {
            try {
                const res = await runTanguCli({
                    cliPath,
                    args: ["test", "--list", "--json", "--no-color", uri.fsPath],
                    cwd: rootPath,
                    timeoutMs: 10_000,
                });
                if (res.exitCode === 0 && res.stdout.trim()) {
                    const report = parseTestListJson(res.stdout);
                    for (const entry of report.tests) {
                        collected.push({
                            ...entry,
                            file: path.isAbsolute(entry.file) ? entry.file : uri.fsPath,
                        });
                    }
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.deps.outputChannel.appendLine(
                    `Failed listing tests in ${uri.fsPath}: ${msg}`,
                );
            }
        }
        return collected;
    }

    private discoverSingleFile(fileUri: vscode.Uri): Promise<void> {
        return this.enqueueDiscovery(async () => {
            if (!vscode.workspace.isTrusted || fileUri.scheme !== "file") {
                return;
            }
            const cliPath = this.deps.resolveCliPath();
            if (!cliPath) {
                return;
            }
            const absFile = fileUri.fsPath;
            try {
                const res = await runTanguCli({
                    cliPath,
                    args: ["test", "--list", "--json", "--no-color", absFile],
                    cwd: path.dirname(absFile),
                    timeoutMs: 10_000,
                });
                if (res.exitCode === 0 && res.stdout.trim()) {
                    const entries = parseTestListJson(res.stdout).tests.map((e) => ({
                        ...e,
                        file: absFile,
                    }));
                    this.upsertFileItem(absFile, entries);
                }
            } catch {
                // Keep existing entries if file currently fails to parse
            }
        });
    }

    private upsertFileItem(absFile: string, entries: ListedTestEntry[]): vscode.TestItem {
        const fileId = `file:${absFile}`;
        const fileUri = vscode.Uri.file(absFile);
        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        const label = folder
            ? path.relative(folder.uri.fsPath, absFile)
            : path.basename(absFile);

        let fileItem = this.controller.items.get(fileId);
        if (!fileItem) {
            fileItem = this.controller.createTestItem(fileId, label, fileUri);
            this.controller.items.add(fileItem);
        } else {
            fileItem.label = label;
        }

        const seenChildren = new Set<string>();
        for (const entry of entries) {
            const testId = `test:${absFile}::${entry.name}`;
            seenChildren.add(testId);
            let testItem = fileItem.children.get(testId);
            if (!testItem) {
                testItem = this.controller.createTestItem(testId, entry.name, fileUri);
                fileItem.children.add(testItem);
            } else {
                testItem.label = entry.name;
            }
            const pos = toZeroBasedPosition(entry.line, entry.col);
            const p = new vscode.Position(pos.line, pos.character);
            testItem.range = new vscode.Range(p, p);
        }

        for (const [childId] of fileItem.children) {
            if (!seenChildren.has(childId)) {
                fileItem.children.delete(childId);
            }
        }
        return fileItem;
    }

    private collectLeafTests(root?: vscode.TestItem): vscode.TestItem[] {
        const leaves: vscode.TestItem[] = [];
        const visit = (item: vscode.TestItem) => {
            if (item.id.startsWith("test:")) {
                leaves.push(item);
            } else {
                item.children.forEach((child) => visit(child));
            }
        };
        if (root) {
            visit(root);
        } else {
            this.controller.items.forEach((item) => visit(item));
        }
        return leaves;
    }

    private async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        if (!vscode.workspace.isTrusted) {
            run.appendOutput("Tangu tests are disabled in Restricted Mode.\r\n");
            run.end();
            return;
        }

        const cliPath = this.deps.resolveCliPath();
        if (!cliPath) {
            run.appendOutput("Tangu CLI (`tangu`) not found.\r\n");
            run.end();
            return;
        }

        const abortController = new AbortController();
        const cancelSub = token.onCancellationRequested(() => abortController.abort());

        try {
            if (this.controller.items.size === 0) {
                await this.discoverAllTests();
            }

            const targets: vscode.TestItem[] = request.include
                ? [...request.include]
                : Array.from(this.controller.items, ([, item]) => item);

            const excludedIds = new Set((request.exclude ?? []).map((i) => i.id));

            for (const target of targets) {
                if (token.isCancellationRequested) {
                    break;
                }
                const leaves = this.collectLeafTests(target).filter(
                    (leaf) => !excludedIds.has(leaf.id),
                );
                if (leaves.length === 0 && target.id.startsWith("file:")) {
                    continue;
                }
                const effectiveLeaves = leaves.length > 0 ? leaves : [target];
                for (const leaf of effectiveLeaves) {
                    run.started(leaf);
                }

                await this.executeTarget(cliPath, target, effectiveLeaves, run, abortController.signal);
            }
        } finally {
            cancelSub.dispose();
            run.end();
        }
    }

    private async executeTarget(
        cliPath: string,
        target: vscode.TestItem,
        leaves: vscode.TestItem[],
        run: vscode.TestRun,
        signal: AbortSignal,
    ): Promise<void> {
        const filePath = target.uri?.fsPath;
        const folder = target.uri ? vscode.workspace.getWorkspaceFolder(target.uri) : undefined;
        const cwd = folder?.uri.fsPath ?? (filePath ? path.dirname(filePath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
        if (!cwd) {
            for (const leaf of leaves) {
                run.errored(leaf, new vscode.TestMessage("Cannot determine workspace directory."));
            }
            return;
        }

        const args = target.id.startsWith("test:") && filePath
            ? buildTestArgs({ mode: "single", targetDir: cwd, filePath, testName: target.label })
            : target.id.startsWith("file:") && filePath
                ? buildTestArgs({ mode: "file", targetDir: cwd, filePath })
                : buildTestArgs({ mode: "all", targetDir: cwd });

        const startedAt = Date.now();
        try {
            const res = await runTanguCli({
                cliPath,
                args,
                cwd,
                timeoutMs: 60_000,
                signal,
            });
            const duration = Date.now() - startedAt;

            if (res.aborted) {
                for (const leaf of leaves) {
                    run.skipped(leaf);
                }
                return;
            }
            if (res.timedOut) {
                for (const leaf of leaves) {
                    run.errored(leaf, new vscode.TestMessage("Test execution timed out."), duration);
                }
                return;
            }

            if (res.stderr.trim()) {
                run.appendOutput(`${res.stderr.replace(/\n/g, "\r\n")}\r\n`);
            }

            let report;
            try {
                report = parseTestRunJson(res.stdout);
            } catch (parseErr) {
                const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                run.appendOutput(`${res.stdout.replace(/\n/g, "\r\n")}\r\n`);
                for (const leaf of leaves) {
                    run.errored(
                        leaf,
                        new vscode.TestMessage(
                            res.stderr.trim() || `Failed to parse test report: ${msg}`,
                        ),
                        duration,
                    );
                }
                return;
            }

            const failureByLeaf = this.mapFailuresToLeaves(report.failures, leaves, cwd);
            const moduleLoadFailed = report.summary.failed_modules > 0;

            for (const leaf of leaves) {
                const failure = failureByLeaf.get(leaf.id);
                if (failure) {
                    const testMsg = this.buildTestMessage(failure, cwd, leaf);
                    if (failure.expected === undefined && failure.actual === undefined && moduleLoadFailed) {
                        run.errored(leaf, testMsg, duration);
                    } else {
                        run.failed(leaf, testMsg, duration);
                    }
                } else if (moduleLoadFailed) {
                    const fallbackFailure = report.failures[0];
                    run.errored(
                        leaf,
                        new vscode.TestMessage(
                            fallbackFailure?.message ?? "Test module failed to load.",
                        ),
                        duration,
                    );
                } else if (res.exitCode !== 0 && report.summary.failed === 0) {
                    run.errored(
                        leaf,
                        new vscode.TestMessage(res.stderr.trim() || `tangu test exited with ${res.exitCode}`),
                        duration,
                    );
                } else {
                    run.passed(leaf, duration);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            for (const leaf of leaves) {
                run.errored(leaf, new vscode.TestMessage(msg));
            }
        }
    }

    private mapFailuresToLeaves(
        failures: TestFailureDetail[],
        leaves: vscode.TestItem[],
        cwd: string,
    ): Map<string, TestFailureDetail> {
        const result = new Map<string, TestFailureDetail>();
        for (const failure of failures) {
            const absFailFile = path.isAbsolute(failure.file)
                ? failure.file
                : path.resolve(cwd, failure.file);
            const exact = leaves.find(
                (l) => l.uri?.fsPath === absFailFile && l.label === failure.test_name,
            );
            if (exact) {
                result.set(exact.id, failure);
                continue;
            }
            const byName = leaves.find((l) => l.label === failure.test_name);
            if (byName) {
                result.set(byName.id, failure);
            }
        }
        return result;
    }

    private buildTestMessage(
        failure: TestFailureDetail,
        cwd: string,
        leaf: vscode.TestItem,
    ): vscode.TestMessage {
        const msg = failure.expected !== undefined && failure.actual !== undefined
            ? vscode.TestMessage.diff(failure.message, failure.expected, failure.actual)
            : new vscode.TestMessage(failure.message);

        const absFailFile = failure.file
            ? (path.isAbsolute(failure.file) ? failure.file : path.resolve(cwd, failure.file))
            : leaf.uri?.fsPath;

        if (absFailFile) {
            const failUri = vscode.Uri.file(absFailFile);
            const pos = toZeroBasedPosition(failure.line ?? 1, failure.col ?? 1);
            const loc = new vscode.Position(pos.line, pos.character);
            msg.location = new vscode.Location(failUri, loc);
        }
        return msg;
    }

    private async runFromCodeLens(arg?: CodeLensTestArg): Promise<void> {
        const targetUri = arg?.uri
            ? vscode.Uri.parse(arg.uri)
            : vscode.window.activeTextEditor?.document.uri;

        if (!targetUri || targetUri.scheme !== "file") {
            const request = new vscode.TestRunRequest();
            await this.runTests(request, new vscode.CancellationTokenSource().token);
            return;
        }

        if (targetUri.fsPath.endsWith(".test.tan")) {
            await this.discoverSingleFile(targetUri);
        }
        const fileItem = this.controller.items.get(`file:${targetUri.fsPath}`);
        if (!fileItem) {
            void vscode.window.showWarningMessage(
                `Tangu: No tests discovered in ${path.basename(targetUri.fsPath)}.`,
            );
            return;
        }

        let include: vscode.TestItem[] = [fileItem];
        if (arg?.name) {
            const single = fileItem.children.get(`test:${targetUri.fsPath}::${arg.name}`);
            if (single) {
                include = [single];
            }
        }
        const request = new vscode.TestRunRequest(include);
        const cts = new vscode.CancellationTokenSource();
        await this.runTests(request, cts.token);
        cts.dispose();
    }

    private async runChangedTests(): Promise<void> {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage(
                "Tangu tests are disabled in Restricted Mode.",
            );
            return;
        }
        const cliPath = this.deps.resolveCliPath();
        const folders = vscode.workspace.workspaceFolders;
        if (!cliPath || !folders || folders.length === 0) {
            void vscode.window.showErrorMessage("Tangu CLI (`tangu`) or workspace folder missing.");
            return;
        }

        const run = this.controller.createTestRun(new vscode.TestRunRequest(), "Changed Tangu Tests");
        try {
            await this.discoverAllTests();
            for (const folder of folders) {
                const cwd = folder.uri.fsPath;
                const args = buildTestArgs({ mode: "changed", targetDir: cwd });
                const res = await runTanguCli({ cliPath, args, cwd, timeoutMs: 60_000 });
                run.appendOutput(`=== ${folder.name} (tangu test --changed) ===\r\n`);
                if (res.stderr.trim()) {
                    run.appendOutput(`${res.stderr.replace(/\n/g, "\r\n")}\r\n`);
                }
                try {
                    const report = parseTestRunJson(res.stdout);
                    run.appendOutput(
                        `Total: ${report.summary.total}, Passed: ${report.summary.passed}, Failed: ${report.summary.failed}\r\n`,
                    );
                    const leaves = this.collectLeafTests().filter(
                        (leaf) => leaf.uri?.fsPath.startsWith(cwd),
                    );
                    const failures = this.mapFailuresToLeaves(report.failures, leaves, cwd);
                    for (const [leafId, failure] of failures.entries()) {
                        const leaf = leaves.find((l) => l.id === leafId);
                        if (leaf) {
                            run.failed(leaf, this.buildTestMessage(failure, cwd, leaf));
                        }
                    }
                } catch {
                    run.appendOutput(`${res.stdout.replace(/\n/g, "\r\n")}\r\n`);
                }
            }
        } finally {
            run.end();
        }
    }

    public dispose(): void {
        if (this.discoveryTimer) {
            clearTimeout(this.discoveryTimer);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
