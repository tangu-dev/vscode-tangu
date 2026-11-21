# VS Code Tangu Language Extension

Visual Studio Code extension for the [Tangu](https://tangu.dev) programming language, integrating `tangu-language-server` and the `tangu` CLI.

## Features

- **Full Language Server Integration:** Pull diagnostics, semantic token highlighting (`#var` underlines, effectful italics, trait coloring, deprecations), completion, hover, go-to-definition/implementation/type-hierarchy, rename, formatting, inlay hints, and CodeLens.
- **Native Test Explorer:** Discovers `*.test.tan` suites in the Testing sidebar, adds gutter play/pass/fail markers, renders `assert-eq!` diffs inline, routes test CodeLenses into Test Explorer, and supports **Tangu: Run Changed Tests** (`tangu test --changed`).
- **Inline Evaluation & REPL:** Evaluate the expression at cursor (`ctrl+alt+t e`) with inline ghost-text results and full output in **Tangu Eval**, launch `tangu repl`, and send selections, forms, or files to the REPL (`ctrl+alt+t r`).
- **Live Virtual Previews:** Inspect **Macro Expansion** (`full` via `ctrl+alt+t m`, or single-step), **Syntax Tree** (`ctrl+alt+t a`), **Delimiter Balance & Depth** (`ctrl+alt+t d`), **Transpiled JavaScript**, **TIR**, and **CLIF** in read-only side-by-side tabs that refresh automatically as you edit.
- **Tasks & Problem Matcher:** Auto-contributes `tangu` tasks (`check`, `test`, `test (changed)`, `fix`, `run`, `compile`, `bench`) with the `$tangu` problem matcher.
- **Rich TextMate Grammar & S-Expression Editing:** Highlights `"""..."""` strings, recursive `${...}` interpolations, `;;` Markdown doc comments, `#sql`/`#html` embedded string blocks, ```` ```tan ```` / ```` ```tangu ```` Markdown code fences, and provides structural wrap/slurp/barf/splice/raise commands.

## Installation

### From GitHub Releases (`.vsix`)

1. Download the latest `vscode-tangu-*.vsix` from [GitHub Releases](https://github.com/tangu-dev/vscode-tangu/releases).
2. Install via CLI:
   ```sh
   code --install-extension vscode-tangu-0.40.0.vsix
   ```
   Or in VS Code, open **Extensions** (`Ctrl+Shift+X`), open the `...` menu, and select **Install from VSIX...**.

### From Source

```sh
git clone https://github.com/tangu-dev/vscode-tangu.git
cd vscode-tangu
npm install
npm run package
code --install-extension vscode-tangu-0.40.0.vsix
```

## Prerequisites

Install the Tangu toolchain (`tangu` CLI and `tangu-language-server`) from [tangu.dev](https://tangu.dev).

If VS Code doesn't inherit your shell `PATH`, the extension also searches `~/.cargo/bin` and `$TANGU_ROOT/bin`, or you can set `tangu.server.path` and `tangu.cli.path` explicitly in Settings.

**Workspace Trust:** In Restricted Mode (untrusted workspaces), syntax highlighting, snippets, structural editing, and user-configured LSP features remain active. Running Tangu files, tests, REPL/eval, macro/IR previews, CLI `fix`/`doctor`, and workspace-level binary/env/config overrides requires a trusted workspace.

## Supported File Types

| Pattern / Fence | Language ID | Description |
|---|---|---|
| `*.tan` | `tangu` | Tangu source modules (also matched via `#!/usr/bin/env tangu` shebang) |
| `*.data.tan` | `tangu-data` | Structured data & configuration files |
| `*.test.tan` | `tangu-test` | Test suites (discovered in Test Explorer) |
| `*.schema.tan` | `tangu-schema` | Schema definitions |
| ```` ```tan ```` / ```` ```tangu ```` | Markdown injection | Syntax-highlighted Tangu blocks inside Markdown files |

## Commands & Keybindings

All Tangu chords require an active Tangu editor and start with `ctrl+alt+t` (same chord on macOS):

| Shortcut | Command | Description |
|---|---|---|
| `ctrl+alt+t e` | `tangu.evalSelectionOrForm` | Evaluate selection or enclosing top-level form inline |
| `ctrl+alt+t r` | `tangu.sendFormToREPL` | Send selection or enclosing top-level form to REPL |
| `ctrl+alt+t m` | `tangu.expandMacro` | Show full macro expansion beside active editor |
| `ctrl+alt+t a` | `tangu.syntaxTree` | Show AST with source ranges |
| `ctrl+alt+t d` | `tangu.showDelimiters` | Show delimiter nesting depth & balance |
| `ctrl+alt+t f` | `tangu.runFix` | Run `tangu fix --auto-import` on current file |
| `ctrl+alt+t (` / `[` / `{` | `tangu.wrapParens` / `wrapBrackets` / `wrapBraces` | Wrap selection or form at cursor |
| `ctrl+alt+t right` | `tangu.slurpForward` | Pull next sibling form into enclosing delimiters |
| `ctrl+alt+t left` | `tangu.barfForward` | Push last child form out of enclosing delimiters |
| `ctrl+alt+t s` | `tangu.spliceForm` | Remove enclosing delimiters |
| `ctrl+alt+t u` | `tangu.raiseForm` | Replace parent form with form at cursor |

Click the `👅` indicator in the status bar at any time to open the quick actions menu (Restart Server, Full Workspace Diagnostics, Open REPL, Run Changed Tests, Fix File, Doctor, Logs, Settings).

Additional commands available from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Previews:** `Tangu: Expand Macro at Cursor (Single Step)`, `Tangu: Show Transpiled JavaScript`, `Tangu: Show Typed IR (TIR)`, `Tangu: Show Cranelift IR (CLIF)`
- **Eval & REPL:** `Tangu: Evaluate Expression...`, `Tangu: Clear Inline Evaluation Results`, `Tangu: Open REPL Terminal`, `Tangu: Send Selection to REPL`, `Tangu: Send Current File to REPL`
- **Execution & Tests:** `Tangu: Run Current File`, `Tangu: Run Changed Tests`
- **Server & Diagnostics:** `Tangu: Restart Language Server`, `Tangu: Run Full Workspace Diagnostics`, `Tangu: Open Language Server Logs`, `Tangu: Run Environment Doctor`

## Configuration

VS Code lint, format, and workspace-diagnostics settings are layered over `.tangu/config.data.tan`: **only settings you explicitly change in VS Code are sent to the server**, leaving project config untouched by defaults.

| Setting | Default | Description |
|---|---|---|
| `tangu.server.path` | `""` | Path to `tangu-language-server` (auto-discovered when empty) |
| `tangu.server.extraEnv` | `{}` | Extra environment variables for `tangu-language-server` (Trusted Workspaces only) |
| `tangu.server.logLevel` | `""` | Optional `RUST_LOG` directive (`error`, `warn`, `info`, `debug`, `trace`) |
| `tangu.cli.path` | `""` | Path to `tangu` CLI (auto-discovered when empty) |
| `tangu.trace.server` | `"off"` | JSON-RPC trace level (`"off"`, `"messages"`, `"verbose"`) |
| `tangu.diagnostics.workspace` | `true` | Enable workspace-wide diagnostics in `tangu-language-server` |
| `tangu.lint.enable` | `[]` | Lint rules or categories to enable |
| `tangu.lint.disable` | `[]` | Lint rules or categories to disable |
| `tangu.lint.exclude` | `[]` | File or directory globs excluded from linting |
| `tangu.lint.severity` | `{}` | Per-rule severity overrides (`error`, `warning`, `info`, `hint`, `off`) |
| `tangu.format.indentSize` | `4` | Formatter indentation width in spaces |
| `tangu.format.softLineLimit` | `80` | Formatter soft line wrap limit |
| `tangu.format.hardLineLimit` | `120` | Formatter hard line wrap limit |
| `tangu.format.organizeImports` | `true` | Sort and organize `use` imports when formatting |
| `tangu.eval.timeoutMs` | `5000` | Inline evaluation timeout in milliseconds (`50`–`30000`) |
| `tangu.codeLens.runTest` | `true` | Show `Run test` / `Run all tests in file` CodeLenses in `.test.tan` files |

## Logging

Output channels available in the VS Code **Output** panel:
- **Tangu Language:** Language server process logs (`tracing` / `stderr`).
- **Tangu Language Server Trace:** JSON-RPC message trace (controlled by `tangu.trace.server`).
- **Tangu Language Client:** Extension lifecycle, CLI fix/doctor logs, and diagnostics requests.
- **Tangu Eval:** Full output from inline expression evaluations.

## Customizing Semantic Highlighting

All built-in semantic token rules (`interface`, `type`, `class`, `struct`, `enum`, `*.modification`, `*.effectful`, `*.deprecated`) are scoped to Tangu language IDs. Override them per language or globally in `settings.json`:

```json
{
    "editor.semanticTokenColorCustomizations": {
        "rules": {
            "*.modification:tangu": {
                "fontStyle": "underline",
                "foreground": "#ff6600"
            }
        }
    }
}
```

## Development & Contributing

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run compile
npm run package
```

See [AGENTS.md](AGENTS.md) for architecture details and source layout, and report bugs or feature requests on [GitHub Issues](https://github.com/tangu-dev/vscode-tangu/issues).

## License

This work is licensed under the [Mozilla Public License 2.0](LICENSE.txt).

Copyright © 2022–2026 [George Moschovitis](https://gmosx.com).
