export interface ShowReferencesFactories<U, P, R, L> {
    uriFromString(value: string): U;
    uriFromFilePath(filePath: string): U;
    position(line: number, character: number): P;
    range(
        startLine: number,
        startCharacter: number,
        endLine: number,
        endCharacter: number,
    ): R;
    location(uri: U, range: R): L;
    isUri?(value: unknown): value is U;
    isPosition?(value: unknown): value is P;
    isRange?(value: unknown): value is R;
    isLocation?(value: unknown): value is L;
}

const RUN_TEST_CODELENS_COMMANDS = new Set([
    "tangu.runTestInExplorer",
    "tangu.runTest",
    "workbench.action.terminal.sendSequence",
]);

/** Returns true if a CodeLens command is a test-runner lens command. */
export function isRunTestCodeLensCommand(commandId: string | undefined): boolean {
    return typeof commandId === "string" && RUN_TEST_CODELENS_COMMANDS.has(commandId);
}

/** Converts raw LSP or VS Code serialized URI values into a host URI instance. */
export function coerceUri<U, P, R, L>(
    raw: unknown,
    fallbackUri: U,
    factories: ShowReferencesFactories<U, P, R, L>,
): U {
    if (factories.isUri?.(raw)) {
        return raw;
    }
    if (typeof raw === "string") {
        return factories.uriFromString(raw);
    }
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.external === "string") {
            return factories.uriFromString(obj.external);
        }
        if (typeof obj.path === "string") {
            return factories.uriFromFilePath(obj.path);
        }
    }
    return fallbackUri;
}

/** Converts 1-based VS Code IPosition or 0-based LSP Position into a host Position. */
export function coercePosition<U, P, R, L>(
    raw: unknown,
    factories: ShowReferencesFactories<U, P, R, L>,
): P {
    if (factories.isPosition?.(raw)) {
        return raw;
    }
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.lineNumber === "number" && typeof obj.column === "number") {
            return factories.position(
                Math.max(0, obj.lineNumber - 1),
                Math.max(0, obj.column - 1),
            );
        }
        if (typeof obj.line === "number" && typeof obj.character === "number") {
            return factories.position(
                Math.max(0, obj.line),
                Math.max(0, obj.character),
            );
        }
    }
    return factories.position(0, 0);
}

function readEndpointCoords(raw: unknown): [number, number] {
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.lineNumber === "number" && typeof obj.column === "number") {
            return [Math.max(0, obj.lineNumber - 1), Math.max(0, obj.column - 1)];
        }
        if (typeof obj.line === "number" && typeof obj.character === "number") {
            return [Math.max(0, obj.line), Math.max(0, obj.character)];
        }
    }
    return [0, 0];
}

/** Converts 1-based VS Code IRange or 0-based LSP Range into a host Range. */
export function coerceRange<U, P, R, L>(
    raw: unknown,
    factories: ShowReferencesFactories<U, P, R, L>,
): R {
    if (factories.isRange?.(raw)) {
        return raw;
    }
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (
            typeof obj.startLineNumber === "number" &&
            typeof obj.startColumn === "number" &&
            typeof obj.endLineNumber === "number" &&
            typeof obj.endColumn === "number"
        ) {
            return factories.range(
                Math.max(0, obj.startLineNumber - 1),
                Math.max(0, obj.startColumn - 1),
                Math.max(0, obj.endLineNumber - 1),
                Math.max(0, obj.endColumn - 1),
            );
        }
        if (obj.start && obj.end) {
            const [sl, sc] = readEndpointCoords(obj.start);
            const [el, ec] = readEndpointCoords(obj.end);
            return factories.range(sl, sc, el, ec);
        }
    }
    return factories.range(0, 0, 0, 0);
}

/** Normalizes `[uri, position, locations]` arguments for `editor.action.showReferences`. */
export function normalizeShowReferencesArgs<U, P, R, L>(
    args: readonly unknown[],
    fallbackUri: U,
    factories: ShowReferencesFactories<U, P, R, L>,
): [U, P, L[]] {
    const uri = coerceUri(args[0], fallbackUri, factories);
    const pos = coercePosition(args[1], factories);
    const rawLocs = args[2];
    const locs: L[] = Array.isArray(rawLocs)
        ? rawLocs.map((loc: unknown) => {
            if (factories.isLocation?.(loc)) {
                return loc;
            }
            const obj = (loc && typeof loc === "object")
                ? (loc as Record<string, unknown>)
                : {};
            return factories.location(
                coerceUri(obj.uri, fallbackUri, factories),
                coerceRange(obj.range, factories),
            );
        })
        : [];
    return [uri, pos, locs];
}
