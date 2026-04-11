import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { dbConfig } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";

@suite class util_property_tests {
    @test "IsNullEmpty: null, undefined, empty string, whitespace are all empty"() {
        assert.ok(Util.IsNullEmpty(null));
        assert.ok(Util.IsNullEmpty(undefined));
        assert.ok(Util.IsNullEmpty(""));
        fc.assert(fc.property(
            fc.stringMatching(/^ {1,100}$/),
            (s) => Util.IsNullEmpty(s) === true
        ));
    }

    @test "IsNullEmpty: non-whitespace strings are never empty"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
            (s) => Util.IsNullEmpty(s) === false
        ));
    }

    @test "IsNullUndefinded: only null and undefined return true"() {
        assert.ok(Util.IsNullUndefinded(null));
        assert.ok(Util.IsNullUndefinded(undefined));
        fc.assert(fc.property(
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(0), fc.constant(""), fc.constant(false)),
            (v) => Util.IsNullUndefinded(v) === false
        ));
    }

    @test "IsString: strings return true, non-strings return false"() {
        fc.assert(fc.property(fc.string(), (s) => Util.IsString(s) === true));
        fc.assert(fc.property(
            fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
            (v) => Util.IsString(v) === false
        ));
    }

    @test "isObject: objects return true, primitives return false"() {
        fc.assert(fc.property(
            fc.oneof(
                fc.object(),
                fc.array(fc.anything()),
                fc.constant({}),
            ),
            (v) => Util.isObject(v) === true
        ));
        fc.assert(fc.property(
            fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
            (v) => Util.isObject(v) === false
        ));
    }

    @test "GetUniqueIdentifier: correct length and hex chars"() {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 32 }),
            (len) => {
                const id = Util.GetUniqueIdentifier(len);
                return id.length === len && /^[0-9a-f]+$/.test(id);
            }
        ));
    }

    @test "GetUniqueIdentifier: two calls never collide"() {
        fc.assert(fc.property(
            fc.integer({ min: 8, max: 32 }),
            (len) => Util.GetUniqueIdentifier(len) !== Util.GetUniqueIdentifier(len)
        ));
    }
}

@suite class parseBoolean_property_tests {
    @test "boolean inputs roundtrip"() {
        fc.assert(fc.property(fc.boolean(), (b) => Config.parseBoolean(b) === b));
    }

    @test "truthy string variants"() {
        fc.assert(fc.property(
            fc.constantFrom("true", "True", "TRUE", "yes", "Yes", "YES", "1"),
            (s) => Config.parseBoolean(s) === true
        ));
    }

    @test "falsy string variants"() {
        fc.assert(fc.property(
            fc.constantFrom("false", "False", "FALSE", "no", "No", "NO", "0"),
            (s) => Config.parseBoolean(s) === false
        ));
    }

    @test "number 0 is false, any positive number is true"() {
        assert.strictEqual(Config.parseBoolean(0), false);
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 10000 }),
            (n) => Config.parseBoolean(n) === true
        ));
    }

    @test "objects always throw"() {
        fc.assert(fc.property(fc.object(), (o) => {
            try {
                Config.parseBoolean(o);
                return false;
            } catch {
                return true;
            }
        }));
    }
}

@suite class parseArray_property_tests {
    @test "already an array passes through"() {
        fc.assert(fc.property(
            fc.array(fc.string({ minLength: 1 }).filter(s => !s.includes(",") && s.trim().length > 0)),
            (arr) => {
                const result = Config.parseArray(arr as any);
                return JSON.stringify(result) === JSON.stringify(arr);
            }
        ));
    }

    @test "comma-separated string splits correctly"() {
        fc.assert(fc.property(
            fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(",") && s.trim().length > 0), { minLength: 1, maxLength: 10 }),
            (items) => {
                const csv = items.join(",");
                const result = Config.parseArray(csv);
                return result.length === items.length && result.every((v, i) => v === items[i].trim());
            }
        ));
    }

    @test "empty segments are filtered out"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(",") && s.trim().length > 0),
            (s) => {
                const csv = ",," + s + ",,";
                const result = Config.parseArray(csv);
                return result.length === 1 && result[0] === s.trim();
            }
        ));
    }
}

@suite class areEqual_property_tests {
    @test "reflexive: areEqual(x, x) is always true"() {
        fc.assert(fc.property(
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.object()),
            (x) => dbConfig.areEqual(x, x) === true
        ));
    }

    @test "symmetric: areEqual(x, y) === areEqual(y, x)"() {
        fc.assert(fc.property(
            fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            (x, y) => dbConfig.areEqual(x, y) === dbConfig.areEqual(y, x)
        ));
    }

    @test "null handling: both null is equal, one null is not"() {
        assert.ok(dbConfig.areEqual(null, null));
        fc.assert(fc.property(
            fc.oneof(fc.string({ minLength: 1 }), fc.integer(), fc.boolean()),
            (x) => dbConfig.areEqual(x, null) === false && dbConfig.areEqual(null, x) === false
        ));
    }

    @test "deep clone is equal"() {
        fc.assert(fc.property(
            fc.object({ maxDepth: 2 }),
            (obj) => {
                const clone = JSON.parse(JSON.stringify(obj));
                return dbConfig.areEqual(obj, clone) === true;
            }
        ));
    }
}

@suite class crypt_property_tests {
    async before() {
        // Crypt needs an encryption key but not a DB connection
        if (Util.IsNullEmpty(Config.aes_secret)) {
            Config.aes_secret = "7f2e27ed0e3a45f289ac249e1c4bc6f6";
        }
        Crypt.encryption_key = null; // force re-derive from aes_secret
        Config.disablelogging();
        await Logger.configure(true, false);
    }

    @test "encrypt then decrypt roundtrips any ASCII string"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 500 }),
            (text) => Crypt.decrypt(Crypt.encrypt(text)) === text
        ));
    }

    @test "encrypt then decrypt roundtrips unicode"() {
        // Note: lone surrogates (U+D800-DFFF) break Buffer roundtrip — that's expected,
        // they're invalid Unicode. Exclude them from generation.
        fc.assert(fc.property(
            fc.stringMatching(/^[\u0080-\uD7FF\uE000-\uFFFF]{1,200}$/),
            (text) => Crypt.decrypt(Crypt.encrypt(text)) === text
        ));
    }

    @test "encrypt produces different ciphertext each time (random IV)"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 100 }),
            (text) => Crypt.encrypt(text) !== Crypt.encrypt(text)
        ));
    }

    @test "ciphertext has expected colon-separated format"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 100 }),
            (text) => {
                const encrypted = Crypt.encrypt(text);
                const parts = encrypted.split(":");
                // GCM format: iv:ciphertext:authTag
                return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/.test(p));
            }
        ));
    }

    @timeout(30000)
    @test async "hash then compare roundtrips any password"() {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 72 }), // bcrypt max is 72 bytes
            async (password) => {
                const hashed = await Crypt.hash(password);
                return await Crypt.compare(password, hashed, null);
            }
        ), { numRuns: 20 }); // fewer runs since bcrypt is slow
    }

    @timeout(30000)
    @test async "different passwords never match same hash"() {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 30 }),
            fc.string({ minLength: 1, maxLength: 30 }),
            async (pw1, pw2) => {
                fc.pre(pw1 !== pw2);
                const hashed = await Crypt.hash(pw1);
                return !(await Crypt.compare(pw2, hashed, null));
            }
        ), { numRuns: 10 }); // bcrypt is slow
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Property.test.ts"
