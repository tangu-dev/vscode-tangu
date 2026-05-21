# Developer & Agent Guide for `vscode-tangu`

This document is designed to help AI agents and human developers quickly orient themselves in the `vscode-tangu` repository, understand the extension's structure, run common tasks, and package new versions.

---

## 🏗️ Repository Architecture

The extension acts as a Visual Studio Code client for the `tangu-language-server` (LSP backend).

### Core Files
*   **[package.json](package.json)**: Extends VS Code with language contributions (`tangu`, `tangu-data`, `tangu-test`, `tangu-schema`), custom commands, configurations, and build scripts.
*   **[language-configuration.json](language-configuration.json)**: Defines editor behavior such as bracket matching, auto-closing pairs, folding markers, and indentation rules.
*   **[snippets.json](snippets.json)**: Defines templates/snippets for Tangu structures.
*   **[syntaxes/tangu.tmLanguage.json](syntaxes/tangu.tmLanguage.json)**: Basic TextMate grammar for fallback token highlighting.

### Source Files
*   **[src/extension.ts](src/extension.ts)**: Extension activator. Handles executable existence checks, configures/launches the `vscode-languageclient`, and registers client commands like opening the REPL terminal.
*   **[src/server-status.ts](src/server-status.ts)**: Subscribes to LSP notifications to display server status in the VS Code status bar (using the `👅` emoji indicator).
*   **[src/lsp-custom-protocol.ts](src/lsp-custom-protocol.ts)**: Declares custom LSP methods used for server-to-client communication.

---

## 🛠️ Build and Development Workflow

### Prerequisites
Install all dependencies first:
```bash
npm install
```

### Compiling and Bundling
The extension uses `esbuild` to compile TypeScript to a bundled CommonJS bundle (`dist/main.js`).

*   **One-time compilation**:
    ```bash
    npm run compile
    ```
*   **Watch mode (auto-recompiling TypeScript changes)**:
    ```bash
    npm run esbuild-watch
    ```

---

## 📦 Packaging and Releasing

To package a new version of the extension into a `.vsix` file that can be distributed or side-loaded:

### 1. Version Bump
Update the `"version"` field in the `package.json` to the target version (e.g. `0.37.0`).

### 2. Run Packaging
Use the packaging script which calls `@vscode/vsce` internally:
```bash
npm run package
```
*Alternatively*, if you have `vsce` installed globally:
```bash
vsce package
```
This produces a file named `vscode-tangu-<version>.vsix` in the root directory.

### 3. Publishing (Marketplace)
To publish the extension directly to the VS Code Marketplace:
```bash
npm run publish
```
*Note: This command requires you to be logged into your publisher account or have a Personal Access Token (PAT) configured.*

### 4. Side-loading (.vsix Installation)
To install the compiled `.vsix` in VS Code manually:
1. Open the Extensions sidebar (`Ctrl+Shift+X`).
2. Click the `...` menu (Views and More Actions) in the top-right corner of the sidebar.
3. Select **Install from VSIX...** and select the generated file.

---

## 💡 Key Development Tips for Agents

1.  **Indentation rules are bracket-based**: Tangu is an s-expression language. Indentation rules are configured in `language-configuration.json` to indent automatically on unclosed opening brackets `(`, `[`, `{` and outdent on closing brackets `)`, `]`, `}`. Semicolon comments (`;`) are ignored by the parser regex.
2.  **Windows executable compatibility**: If you modify path verification logic, remember that Windows executables end with `.exe`. Ensure checks in `src/extension.ts` check for both the raw executable names (`tangu`, `tangu-language-server`) and their `.exe` suffix on `win32` platforms.
3.  **LSP Logging Sinks**: Look in the VS Code Output panel under:
    *   `Tangu Language Client` for client log messages.
    *   `Tangu Language Server Trace` for JSON-RPC message logs.
