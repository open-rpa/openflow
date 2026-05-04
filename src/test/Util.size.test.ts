import { suite, test } from "@testdeck/mocha";
import assert from "assert";
import { Util } from "../Util.js";

@suite class util_message_size_tests {
    @test "assertMaxMessageSize is a no-op when limit is 0"() {
        const big = "x".repeat(5 * 1024);
        assert.doesNotThrow(() => Util.assertMaxMessageSize(big, "insertone", 0));
    }
    @test "assertMaxMessageSize is a no-op when limit is negative"() {
        const big = "x".repeat(5 * 1024);
        assert.doesNotThrow(() => Util.assertMaxMessageSize(big, "insertone", -1));
    }
    @test "assertMaxMessageSize is a no-op when limit is NaN"() {
        const big = "x".repeat(5 * 1024);
        assert.doesNotThrow(() => Util.assertMaxMessageSize(big, "insertone", NaN));
    }
    @test "assertMaxMessageSize allows messages under the limit"() {
        const ok = "x".repeat(5 * 1024);
        assert.doesNotThrow(() => Util.assertMaxMessageSize(ok, "insertone", 10));
    }
    @test "assertMaxMessageSize throws on messages over the limit"() {
        const big = "x".repeat(2 * 1024);
        assert.throws(
            () => Util.assertMaxMessageSize(big, "insertone", 1),
            /max_message_size_kb/
        );
    }
    @test "assertMaxMessageSize handles null and undefined data without throwing"() {
        assert.doesNotThrow(() => Util.assertMaxMessageSize(null, "ping", 1));
        assert.doesNotThrow(() => Util.assertMaxMessageSize(undefined, "pong", 1));
    }
    @test "assertMaxMessageSize counts UTF-8 bytes not characters"() {
        const multibyte = "✓".repeat(400);
        assert.throws(
            () => Util.assertMaxMessageSize(multibyte, "insertone", 1),
            /max_message_size_kb/
        );
    }
    @test "assertMaxMessageSize includes command name in error"() {
        const big = "x".repeat(2 * 1024);
        assert.throws(
            () => Util.assertMaxMessageSize(big, "addworkitem", 1),
            /addworkitem/
        );
    }
    @test "assertMaxMessageSize accepts a small object payload"() {
        const small = { item: { name: "x" }, w: 1, j: false };
        assert.doesNotThrow(() => Util.assertMaxMessageSize(small as any, "insertone", 1));
    }
    @test "assertMaxMessageSize rejects an oversized object payload"() {
        const big = { item: { payload: "x".repeat(3 * 1024) } };
        assert.throws(
            () => Util.assertMaxMessageSize(big as any, "addworkitem", 1),
            /max_message_size_kb/
        );
    }
    @test "assertMaxMessageSize handles circular references without throwing RangeError"() {
        const a: any = { name: "x" };
        a.self = a;
        a.peer = { back: a };
        assert.doesNotThrow(() => Util.assertMaxMessageSize(a, "insertone", 1));
    }
    @test "assertMaxMessageSize handles deeply nested objects without stack overflow"() {
        const root: any = {};
        let cur = root;
        for (let i = 0; i < 50000; i++) {
            cur.next = { i };
            cur = cur.next;
        }
        assert.doesNotThrow(() => Util.assertMaxMessageSize(root, "insertone", 0));
    }
    @test "assertMaxMessageSize rejects oversized deeply nested object"() {
        const root: any = {};
        let cur = root;
        for (let i = 0; i < 200; i++) {
            cur.next = { i, blob: "x".repeat(64) };
            cur = cur.next;
        }
        assert.throws(
            () => Util.assertMaxMessageSize(root, "insertone", 1),
            /max_message_size_kb/
        );
    }
    @test "assertMaxDocumentSize is a no-op when limit is 0"() {
        const big = { payload: "x".repeat(5 * 1024) };
        assert.doesNotThrow(() => Util.assertMaxDocumentSize(big, "insertone", 0));
    }
    @test "assertMaxDocumentSize allows under-limit document"() {
        const ok = { name: "x", value: 1 };
        assert.doesNotThrow(() => Util.assertMaxDocumentSize(ok, "insertone", 1));
    }
    @test "assertMaxDocumentSize rejects oversized document with max_document_size_kb in error"() {
        const big = { payload: "x".repeat(3 * 1024) };
        assert.throws(
            () => Util.assertMaxDocumentSize(big, "insertone", 1),
            /max_document_size_kb/
        );
    }
    @test "assertMaxDocumentSize includes command name in error"() {
        const big = { payload: "x".repeat(3 * 1024) };
        assert.throws(
            () => Util.assertMaxDocumentSize(big, "addworkitem", 1),
            /addworkitem/
        );
    }
    @test "assertMaxDocumentSize handles circular references"() {
        const a: any = { name: "x" };
        a.self = a;
        assert.doesNotThrow(() => Util.assertMaxDocumentSize(a, "insertone", 1));
    }
    @test "assertMaxDocumentSize is a no-op when limit is NaN"() {
        const big = { payload: "x".repeat(5 * 1024) };
        assert.doesNotThrow(() => Util.assertMaxDocumentSize(big, "insertone", NaN));
    }
}
