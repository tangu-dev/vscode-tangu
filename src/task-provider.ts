import * as vscode from "vscode";

interface TanguTaskDefinition extends vscode.TaskDefinition {
    command: "check" | "test" | "fix" | "run" | "compile" | "bench";
    args?: string[];
}

interface BuiltinTaskSpec {
    label: string;
    command: TanguTaskDefinition["command"];
    args: string[];
    group?: vscode.TaskGroup;
}

const BUILTIN_TASKS: BuiltinTaskSpec[] = [
    {
        label: "check",
        command: "check",
        args: ["check", "."],
        group: vscode.TaskGroup.Build,
    },
    {
        label: "test",
        command: "test",
        args: ["test"],
        group: vscode.TaskGroup.Test,
    },
    {
        label: "test (changed)",
        command: "test",
        args: ["test", "--changed"],
        group: vscode.TaskGroup.Test,
    },
    {
        label: "fix (auto-import)",
        command: "fix",
        args: ["fix", "--auto-import", "."],
    },
    {
        label: "run",
        command: "run",
        args: ["run", "."],
    },
    {
        label: "compile",
        command: "compile",
        args: ["compile", "."],
        group: vscode.TaskGroup.Build,
    },
    {
        label: "bench",
        command: "bench",
        args: ["bench"],
    },
];

/** Registers a `vscode.TaskProvider` for `tangu` tasks backed by `$tangu` problem matchers. */
export class TanguTaskProvider implements vscode.TaskProvider {
    constructor(private readonly resolveCliPath: () => string | undefined) {}

    public provideTasks(): vscode.Task[] {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return [];
        }

        const cliPath = this.resolveCliPath() ?? "tangu";
        const tasks: vscode.Task[] = [];

        for (const folder of folders) {
            for (const spec of BUILTIN_TASKS) {
                const def: TanguTaskDefinition = {
                    type: "tangu",
                    command: spec.command,
                    args: spec.args.slice(1),
                };
                const task = new vscode.Task(
                    def,
                    folder,
                    spec.label,
                    "tangu",
                    new vscode.ProcessExecution(cliPath, spec.args, {
                        cwd: folder.uri.fsPath,
                    }),
                    "$tangu",
                );
                if (spec.group) {
                    task.group = spec.group;
                }
                tasks.push(task);
            }
        }
        return tasks;
    }

    public resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as Partial<TanguTaskDefinition>;
        if (!def.command) {
            return undefined;
        }
        const cliPath = this.resolveCliPath() ?? "tangu";
        const extra = Array.isArray(def.args) ? def.args : [];
        const fullArgs = [def.command, ...extra];
        const scope = task.scope ?? vscode.TaskScope.Workspace;
        const cwd =
            typeof scope === "object" && "uri" in scope
                ? scope.uri.fsPath
                : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        return new vscode.Task(
            task.definition,
            scope,
            task.name || def.command,
            "tangu",
            new vscode.ProcessExecution(cliPath, fullArgs, cwd ? { cwd } : undefined),
            "$tangu",
        );
    }
}
