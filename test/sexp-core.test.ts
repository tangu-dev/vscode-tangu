import * as assert from "assert";
import {
    barfForward,
    findTopLevelForm,
    prepareForRepl,
    raiseForm,
    slurpForward,
    spliceForm,
    wrapRange,
} from "../src/sexp-core";

describe("sexp-core", () => {
    it("finds top-level form while ignoring comments and braces inside strings", () => {
        const src = [
            "; leading (comment)",
            "(def msg \"hello ) world ${(+ 1 2)}\")",
            "(def multi \"\"\"",
            "  line with ) paren",
            "\"\"\")",
        ].join("\n");

        const firstEnd = src.indexOf("\n(def multi");
        const firstStart = src.indexOf("(def msg");
        const span1 = findTopLevelForm(src, firstStart + 10);
        assert.deepStrictEqual(span1, { start: firstStart, end: firstEnd });

        const multiStart = src.indexOf("(def multi");
        const span2 = findTopLevelForm(src, src.length - 5);
        assert.deepStrictEqual(span2, { start: multiStart, end: src.length });
    });

    it("normalizes multi-line forms, comments, and triple-quoted strings for line-oriented REPL", () => {
        const input = [
            "; skip me",
            "(def add (Func [a b]",
            "  ; inline comment",
            "  (+ a b)",
            "))",
            "(let s \"\"\"hello",
            "world\"\"\")",
        ].join("\n");

        const lines = prepareForRepl(input);
        assert.deepStrictEqual(lines, [
            "(def add (Func [a b] (+ a b)))",
            '(let s "hello\\nworld")',
        ]);
    });

    it("wraps selection or atom/form at cursor", () => {
        const res1 = wrapRange("(+ a b)", 3, 4, "(");
        assert.strictEqual(res1.text, "(+ (a) b)");
        assert.strictEqual(res1.selectionStart, 4);

        const res2 = wrapRange("(foo bar)", 6, 6, "[");
        assert.strictEqual(res2.text, "(foo [bar])");
        assert.strictEqual(res2.selectionStart, 6);
    });

    it("slurps and barfs forward across sibling expressions", () => {
        const slurped = slurpForward("(foo bar) baz", 4);
        assert.ok(slurped);
        assert.strictEqual(slurped.text, "(foo bar baz)");

        const barfed = barfForward("(foo bar baz)", 4);
        assert.ok(barfed);
        assert.strictEqual(barfed.text, "(foo bar) baz");

        const barfSingle = barfForward("(foo)", 2);
        assert.ok(barfSingle);
        assert.strictEqual(barfSingle.text, "() foo");
    });

    it("splices enclosing form and raises subform into parent", () => {
        const spliced = spliceForm("(+ (1 2) 3)", 5);
        assert.ok(spliced);
        assert.strictEqual(spliced.text, "(+ 1 2 3)");

        const raisedAtom = raiseForm("(+ 1 (* 2 3))", 11);
        assert.ok(raisedAtom);
        assert.strictEqual(raisedAtom.text, "(+ 1 3)");

        const idxMul = "(+ 1 (* 2 3))".indexOf("(*");
        const raisedList = raiseForm("(+ 1 (* 2 3))", idxMul);
        assert.ok(raisedList);
        assert.strictEqual(raisedList.text, "(* 2 3)");
    });
});
