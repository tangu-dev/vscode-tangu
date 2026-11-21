export interface TextSpan {
    start: number;
    end: number;
}

export interface DelimNode extends TextSpan {
    open: "(" | "[" | "{";
    close: ")" | "]" | "}";
    children: SyntaxNode[];
}

export interface AtomNode extends TextSpan {
    kind: "atom";
}

export type SyntaxNode = (DelimNode & { kind: "list" }) | AtomNode;

export interface EditOutcome {
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

const MATCHING_CLOSE: Record<"(" | "[" | "{", ")" | "]" | "}"> = {
    "(": ")",
    "[": "]",
    "{": "}",
};

function isDelimiterChar(ch: string): boolean {
    return ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}";
}

function isWhitespaceChar(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

/** Skips a `;` line comment starting at `index` and returns the index at `\n` or EOF. */
function skipComment(text: string, index: number): number {
    let i = index;
    while (i < text.length && text[i] !== "\n") {
        i += 1;
    }
    return i;
}

/** Skips a triple-quoted string starting at `index` (where `text.slice(index, index + 3) === '"""'`). */
function skipTripleString(text: string, index: number): number {
    let i = index + 3;
    while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
            return i + 3;
        }
        i += 1;
    }
    return text.length;
}

/** Skips a double-quoted string (with `\"` escapes, recursive `${...}`, and trailing `"r`) starting at `index`. */
function skipDoubleString(text: string, index: number): number {
    let i = index + 1;
    type Mode = { type: "text" } | { type: "code"; balance: number } | { type: "codeString" };
    const stack: Mode[] = [{ type: "text" }];

    while (i < text.length && stack.length > 0) {
        const top = stack[stack.length - 1];
        const ch = text[i];

        if (top.type === "text") {
            if (ch === "\\") {
                i += 2;
                continue;
            }
            if (ch === '"') {
                i += 1;
                if (text[i] === "r") {
                    i += 1;
                }
                return i;
            }
            if (ch === "$" && text[i + 1] === "{") {
                i += 2;
                stack.push({ type: "code", balance: 0 });
                continue;
            }
            i += 1;
        } else if (top.type === "code") {
            if (ch === "{") {
                top.balance += 1;
                i += 1;
            } else if (ch === "}") {
                if (top.balance > 0) {
                    top.balance -= 1;
                } else {
                    stack.pop();
                }
                i += 1;
            } else if (ch === '"') {
                if (text[i + 1] === '"' && text[i + 2] === '"') {
                    i = skipTripleString(text, i);
                } else if (text[i + 1] === "r") {
                    return i + 2;
                } else {
                    stack.push({ type: "codeString" });
                    i += 1;
                }
            } else {
                i += 1;
            }
        } else {
            if (ch === "\\") {
                i += 2;
            } else if (ch === '"') {
                stack.pop();
                i += 1;
            } else {
                i += 1;
            }
        }
    }

    return text.length;
}

/** Parses `text` into a forest of balanced top-level S-expression and atom nodes. */
export function parseSexpForest(text: string): SyntaxNode[] {
    const roots: SyntaxNode[] = [];
    const stack: Array<{ open: "(" | "[" | "{"; start: number; children: SyntaxNode[] }> = [];

    const pushNode = (node: SyntaxNode) => {
        if (stack.length > 0) {
            stack[stack.length - 1].children.push(node);
        } else {
            roots.push(node);
        }
    };

    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        if (isWhitespaceChar(ch)) {
            i += 1;
            continue;
        }

        if (ch === ";") {
            i = skipComment(text, i);
            continue;
        }

        if (ch === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
            const end = skipTripleString(text, i);
            pushNode({ kind: "atom", start: i, end });
            i = end;
            continue;
        }

        if (ch === '"') {
            const end = skipDoubleString(text, i);
            pushNode({ kind: "atom", start: i, end });
            i = end;
            continue;
        }

        if (ch === "(" || ch === "[" || ch === "{") {
            stack.push({ open: ch, start: i, children: [] });
            i += 1;
            continue;
        }

        if (ch === ")" || ch === "]" || ch === "}") {
            const top = stack[stack.length - 1];
            if (top && MATCHING_CLOSE[top.open] === ch) {
                stack.pop();
                pushNode({
                    kind: "list",
                    open: top.open,
                    close: ch,
                    start: top.start,
                    end: i + 1,
                    children: top.children,
                });
            }
            i += 1;
            continue;
        }

        // Handle `#(...)` / `#{...}` annotations as single atoms if prefixed with `#` directly before delim,
        // or regular symbolic/numeric/keyword atom.
        const start = i;
        while (i < text.length) {
            const c = text[i];
            if (isWhitespaceChar(c) || isDelimiterChar(c) || c === ";" || c === '"') {
                break;
            }
            i += 1;
        }
        if (i > start) {
            pushNode({ kind: "atom", start, end: i });
        } else {
            i += 1;
        }
    }

    return roots;
}

/** Finds the top-level form or atom containing `offset`. */
export function findTopLevelForm(text: string, offset: number): TextSpan | undefined {
    const roots = parseSexpForest(text);
    for (const node of roots) {
        if (offset >= node.start && offset < node.end) {
            return { start: node.start, end: node.end };
        }
    }
    for (const node of roots) {
        if (offset === node.end) {
            return { start: node.start, end: node.end };
        }
    }
    return undefined;
}

/** Splits source text into individual top-level expression strings (ignoring comments). */
export function splitTopLevelForms(text: string): string[] {
    return parseSexpForest(text).map((node) => text.slice(node.start, node.end));
}

function escapeForSingleLineString(rawBody: string): string {
    let out = '"';
    for (let i = 0; i < rawBody.length; i++) {
        const ch = rawBody[i];
        if (ch === "\\") {
            out += "\\\\";
        } else if (ch === '"') {
            out += '\\"';
        } else if (ch === "\n") {
            out += "\\n";
        } else if (ch === "\r") {
            out += "\\r";
        } else if (ch === "\t") {
            out += "\\t";
        } else {
            out += ch;
        }
    }
    out += '"';
    return out;
}

function collapseFormToSingleLine(form: string): string {
    let out = "";
    let i = 0;
    let pendingSpace = false;

    while (i < form.length) {
        const ch = form[i];

        if (isWhitespaceChar(ch)) {
            if (out.length > 0) {
                pendingSpace = true;
            }
            i += 1;
            continue;
        }

        if (ch === ";") {
            i = skipComment(form, i);
            continue;
        }

        if (pendingSpace) {
            const last = out[out.length - 1];
            const noSpaceBefore = ch === ")" || ch === "]" || ch === "}";
            const noSpaceAfter = last === "(" || last === "[" || last === "{";
            if (!noSpaceBefore && !noSpaceAfter) {
                out += " ";
            }
            pendingSpace = false;
        }

        if (ch === '"' && form[i + 1] === '"' && form[i + 2] === '"') {
            const end = skipTripleString(form, i);
            const inner = end >= i + 6 ? form.slice(i + 3, end - 3) : form.slice(i + 3, end);
            out += escapeForSingleLineString(inner);
            i = end;
            continue;
        }

        if (ch === '"') {
            const end = skipDoubleString(form, i);
            const rawStr = form.slice(i, end);
            out += rawStr.replace(/\r?\n/g, "\\n");
            i = end;
            continue;
        }

        out += ch;
        i += 1;
    }

    return out.trim();
}

/**
 * Prepares source text for line-oriented `tangu repl` by splitting top-level forms,
 * stripping comments, converting `"""..."""` to single-line strings, and collapsing newlines.
 */
export function prepareForRepl(text: string): string[] {
    return splitTopLevelForms(text)
        .map(collapseFormToSingleLine)
        .filter((line) => line.length > 0);
}

interface NodeAncestry {
    node: SyntaxNode;
    parent?: DelimNode & { kind: "list" };
    indexInParent: number;
    siblings: SyntaxNode[];
}

function findDeepestDelimWithOffset(
    nodes: SyntaxNode[],
    offset: number,
    parent?: DelimNode & { kind: "list" },
): { node: DelimNode & { kind: "list" }; parent?: DelimNode & { kind: "list" }; siblings: SyntaxNode[]; indexInParent: number } | undefined {
    for (let idx = 0; idx < nodes.length; idx++) {
        const node = nodes[idx];
        if (node.kind === "list" && offset > node.start && offset < node.end) {
            const deeper = findDeepestDelimWithOffset(node.children, offset, node);
            return deeper ?? { node, parent, siblings: nodes, indexInParent: idx };
        }
    }
    return undefined;
}

function findTargetForWrapOrRaise(
    nodes: SyntaxNode[],
    offset: number,
    parent?: DelimNode & { kind: "list" },
): NodeAncestry | undefined {
    for (let idx = 0; idx < nodes.length; idx++) {
        const node = nodes[idx];
        if (node.kind === "list") {
            if (offset === node.start) {
                return { node, parent, indexInParent: idx, siblings: nodes };
            }
            if (offset > node.start && offset < node.end) {
                const deeper = findTargetForWrapOrRaise(node.children, offset, node);
                return deeper ?? { node, parent, indexInParent: idx, siblings: nodes };
            }
        } else if (offset >= node.start && offset <= node.end) {
            return { node, parent, indexInParent: idx, siblings: nodes };
        }
    }
    return undefined;
}

/** Wraps the active selection (or form/atom at cursor) in `open`..`close`. */
export function wrapRange(
    text: string,
    selStart: number,
    selEnd: number,
    open: "(" | "[" | "{",
): EditOutcome {
    const close = MATCHING_CLOSE[open];
    if (selStart !== selEnd) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        const inner = text.slice(start, end);
        const nextText = `${text.slice(0, start)}${open}${inner}${close}${text.slice(end)}`;
        const cursor = start + 1;
        return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
    }

    const roots = parseSexpForest(text);
    const target = findTargetForWrapOrRaise(roots, selStart);
    if (target) {
        const { start, end } = target.node;
        const inner = text.slice(start, end);
        const nextText = `${text.slice(0, start)}${open}${inner}${close}${text.slice(end)}`;
        const cursor = start + 1;
        return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
    }

    const nextText = `${text.slice(0, selStart)}${open}${close}${text.slice(selStart)}`;
    const cursor = selStart + 1;
    return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
}

/** Moves the closing delimiter of the enclosing form forward over the next sibling form. */
export function slurpForward(text: string, offset: number): EditOutcome | undefined {
    const roots = parseSexpForest(text);
    const enclosing = findDeepestDelimWithOffset(roots, offset);
    if (!enclosing) {
        return undefined;
    }

    const nextSibling = enclosing.siblings[enclosing.indexInParent + 1];
    if (!nextSibling) {
        return undefined;
    }

    const closeIdx = enclosing.node.end - 1;
    const closeChar = enclosing.node.close;
    const beforeClose = text.slice(0, closeIdx);
    const betweenAndSibling = text.slice(closeIdx + 1, nextSibling.end);
    const afterSibling = text.slice(nextSibling.end);

    const nextText = `${beforeClose}${betweenAndSibling}${closeChar}${afterSibling}`;
    const nextCursor = offset > closeIdx ? offset - 1 : offset;
    return { text: nextText, selectionStart: nextCursor, selectionEnd: nextCursor };
}

/** Moves the closing delimiter of the enclosing form backward before its last child form. */
export function barfForward(text: string, offset: number): EditOutcome | undefined {
    const roots = parseSexpForest(text);
    const enclosing = findDeepestDelimWithOffset(roots, offset);
    if (!enclosing || enclosing.node.children.length === 0) {
        return undefined;
    }

    const children = enclosing.node.children;
    const closeIdx = enclosing.node.end - 1;
    const closeChar = enclosing.node.close;

    let insertAt: number;
    let spacer = "";
    if (children.length >= 2) {
        insertAt = children[children.length - 2].end;
    } else {
        insertAt = enclosing.node.start + 1;
        if (children[0].start === insertAt) {
            spacer = " ";
        }
    }

    const nextText =
        text.slice(0, insertAt) +
        closeChar +
        spacer +
        text.slice(insertAt, closeIdx) +
        text.slice(closeIdx + 1);

    let nextCursor = offset;
    if (offset > closeIdx) {
        nextCursor = offset + spacer.length;
    } else if (offset > insertAt) {
        nextCursor = insertAt;
    }
    return { text: nextText, selectionStart: nextCursor, selectionEnd: nextCursor };
}

/** Unwraps the enclosing delimiters around the cursor. */
export function spliceForm(text: string, offset: number): EditOutcome | undefined {
    const roots = parseSexpForest(text);
    const enclosing = findDeepestDelimWithOffset(roots, offset);
    if (!enclosing) {
        return undefined;
    }

    const openIdx = enclosing.node.start;
    const closeIdx = enclosing.node.end - 1;
    const nextText =
        text.slice(0, openIdx) +
        text.slice(openIdx + 1, closeIdx) +
        text.slice(closeIdx + 1);

    let nextCursor = offset;
    if (offset > closeIdx) {
        nextCursor = offset - 2;
    } else if (offset > openIdx) {
        nextCursor = offset - 1;
    }
    return { text: nextText, selectionStart: nextCursor, selectionEnd: nextCursor };
}

/** Replaces the parent form with the subform/atom at the cursor. */
export function raiseForm(text: string, offset: number): EditOutcome | undefined {
    const roots = parseSexpForest(text);
    const target = findTargetForWrapOrRaise(roots, offset);
    if (!target || !target.parent) {
        return undefined;
    }

    const parent = target.parent;
    const inner = text.slice(target.node.start, target.node.end);
    const nextText = text.slice(0, parent.start) + inner + text.slice(parent.end);
    return {
        text: nextText,
        selectionStart: parent.start,
        selectionEnd: parent.start,
    };
}
