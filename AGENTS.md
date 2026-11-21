# Developer & Agent Guide for `vscode-tangu`

This document helps AI agents and human developers navigate `vscode-tangu`, run checks, and package releases.

---

## Architecture

`vscode-tangu` acts as the VS Code client for `tangu-language-server` (LSP) and integrates directly with the `tangu` CLI for test discovery/execution, AST/IR dumps, formatting fixes, and diagnostics.

### Manifest & Syntax Files
- [package.json](package.json): Language IDs (`tangu`, `tangu-data`, `tangu-test`, `tangu-schema`), commands, menus, keybindings, settings, task definitions, `$tangu` problem matcher, and language-scoped semantic token defaults.
- [language-configuration.json](language-configuration.json): Brackets, auto-closing pairs, folding markers, indentation rules, and Tangu `wordPattern`.
- [snippets.json](snippets.json) & [snippets-test.json](snippets-test.json): Core idiomatic snippets and `tangu-test`-scoped test snippets.
- [syntaxes/tangu.tmLanguage.json](syntaxes/tangu.tmLanguage.json) & [syntaxes/tangu.codeblock.json](syntaxes/tangu.codeblock.json): TextMate grammar (strings, interpolations, `#sql`/`#html`/Markdown embeddings) and Markdown ```` ```tan ```` / ```` ```tangu ```` fence injection.

### Source Layout (`src/`)
Pure logic modules have **zero `vscode` imports** so Mocha tests run natively in Node without VS Code mocks:
- [src/extension.ts](src/extension.ts): Extension activation, lifecycle, restart handling, config sync, and CLI utility commands (`runFix`, `runDoctor`, `runFile`).
- [src/config-logic.ts](src/config-logic.ts) & [src/config.ts](src/config.ts): Explicit-only `config.inspect()` override builder, cross-platform binary resolution, and server env builder.
- [src/codelens-normalize.ts](src/codelens-normalize.ts) & [src/codelens-middleware.ts](src/codelens-middleware.ts): Argument coercion for both `provideCodeLenses` and `resolveCodeLens`, plus optional filtering of test CodeLenses.
- [src/lsp-custom-protocol.ts](src/lsp-custom-protocol.ts) & [src/server-status.ts](src/server-status.ts): Status bar item (`👅`) subscribing to `tangu/publishServerStatus` (and legacy `tan/publishServerStatus`).
- [src/cli-runner.ts](src/cli-runner.ts): `child_process.spawn(..., { shell: false })` runner with timeout, output cap, stdin piping, and `AbortSignal`.
- [src/eval-repl.ts](src/eval-repl.ts): Inline LSP expression evaluation decorations (`Tangu Eval`) and REPL terminal commands.
- [src/preview-provider.ts](src/preview-provider.ts): Read-only `tangu-preview://` tabs with debounced/cancellable live refresh for macro expansion, AST, delimiters, JS, TIR, and CLIF.
- [src/test-protocol.ts](src/test-protocol.ts) & [src/test-controller.ts](src/test-controller.ts): Native VS Code `TestController` backed by `tangu test --list --json` and `tangu test --json`.
- [src/task-provider.ts](src/task-provider.ts): Workspace task provider for `tangu`.
- [src/sexp-core.ts](src/sexp-core.ts) & [src/sexp.ts](src/sexp.ts): S-expression scanner, REPL normalization, and structural editing commands.

---

## Development & Verification

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run compile
```

Bundling runs through `esbuild.js` to produce `dist/main.js`.

---

## Packaging & Releasing

1. Update `"version"` in `package.json` and document changes in `CHANGELOG.md`.
2. Verify packaged files:
   ```bash
   npx vsce ls
   ```
3. Package `.vsix` and attach it to a GitHub Release:
   ```bash
   npm run package
   ```
4. (Optional) Publish to the VS Code Marketplace when publisher credentials are configured:
   ```bash
   npm run publish
   ```
