# Changelog

All notable changes to the `vscode-tangu` extension are documented in this file.

## [0.40.0] - 2026-11-21

### Added
- **Full Settings UI:** Added `tangu.lint.*`, `tangu.format.*`, `tangu.diagnostics.workspace`, `tangu.server.{path, extraEnv, logLevel}`, `tangu.cli.path`, `tangu.eval.timeoutMs`, and `tangu.codeLens.runTest`. Only explicitly overridden settings are forwarded to the server so `.tangu/config.data.tan` defaults are never overwritten.
- **Native Test Explorer & Tasks:** Added `TestController` (`tangu test --list --json` / `tangu test --json`, gutter icons, `TestMessage.diff` assertion diffs, `Run Changed Tests`), routed CodeLens test runs into Test Explorer (`tangu.runTestInExplorer`), and added a `tangu` `TaskProvider` with a `$tangu` problem matcher.
- **Inline Evaluation & Improved REPL:** Added inline ghost-text expression evaluation (`tangu.evalSelectionOrForm`, `tangu.evalExpressionPrompt`, `tangu.clearEvalResults`) backed by the `"Tangu Eval"` Output channel, fixed `tangu repl` launch/reuse, and added `Send Selection / Top-Level Form / Current File to REPL`.
- **Live Virtual Inspector Previews:** Added a read-only `tangu-preview://` provider with live refresh on edit/save for macro expansion (`full` and `step`), syntax tree (`--ast --ranges`), delimiter depth (`--delimiters`), transpiled JS (`--js`), TIR (`--tir`), and CLIF (`--clif`).
- **Server Lifecycle & CLI Commands:** Added `tangu.restartServer`, `tangu.openServerLogs`, clickable status bar QuickPick menu, `tangu.runFix`, `tangu.runDoctor`, and `tangu.runFile`, plus `untitled:` buffer support.
- **Upgraded Grammar, Snippets & Structural Editing:** Rewrote `syntaxes/tangu.tmLanguage.json` (strings, triple-quotes, `${...}` interpolation, `;`/`;;` comments, `#sql`/`#html` embeddings, modern forms) and `syntaxes/tangu.codeblock.json` (both ```` ```tan ```` and ```` ```tangu ```` fences), fixed `wordPattern`, enabled bracket pair colorization/guides, updated snippets to idiomatic Tangu (`snippets.json` + `snippets-test.json`), and added Paredit-lite structural commands (`ctrl+alt+t` chords).
- **Automated Test Suite:** Added headless Mocha unit and `vscode-textmate` grammar tests (`npm test`).

### Fixed
- **CodeLens `codeLens/resolve` arguments:** Fixed `middleware.resolveCodeLens` so deferred reference and trait implementation CodeLenses properly coerce VS Code `Uri`, `Position`, and `Location` instances instead of passing raw JSON to `editor.action.showReferences`.
- **Server status indicator:** Aligned custom server status notifications (`tangu/publishServerStatus`, keeping `tan/publishServerStatus` fallback), fixed status bar disposal ordering, and moved status bar/watchers/channels under `context.subscriptions`.
- **Non-intrusive diagnostics & tracing:** Stopped forcing `RUST_LOG=trace`, stopped focusing the Output channel on every startup, and defaulted `tangu.trace.server` to `"off"` so dynamic `$/setTrace` log filtering works cleanly.
- **Language-scoped semantic colors:** Scoped default `editor.semanticTokenColorCustomizations` rules (`interface`, `type`, `class`, `struct`, `enum`, `*.modification`, `*.effectful`, `*.deprecated`) to `:tangu`, `:tangu-data`, `:tangu-test`, and `:tangu-schema` so non-Tangu languages are never altered.
- **Unified build & packaging:** Unified `esbuild.js` to output `dist/main.js`, fixed `tsconfig.json` `lib` conflicts, removed unused webpack/glob dependencies, updated `.vscodeignore` / `.gitignore`, and aligned `LICENSE.txt` and documentation to `MPL-2.0`.
- **Cross-platform binary lookup:** Added Windows `.exe`/`PATHEXT` resolution, `~/.cargo/bin` and `$TANGU_ROOT/bin` fallbacks, and actionable missing-server prompts.

## [0.39.0] - 2026-09-01
- Added `tangu.expandMacro` command and `CodeLens` `showReferences` argument coercion.

## [0.38.0] - 2026-05-21
- Configured ESLint, updated dependencies, fixed indentation rules/folding markers, and added `.schema.tan` icon support.
