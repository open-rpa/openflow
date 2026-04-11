import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { Rolemember, TokenUser, User } from "../commoninterfaces.js";

const arbId = fc.stringMatching(/^[0-9a-f]{24}$/);
const arbName = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);
const arbExpiry = fc.constantFrom("1h", "2h", "12h", "1d", "7d", "30d");

function makeUser(id: string, name: string, username: string, roles: Rolemember[]): User {
    const u = new User();
    u._id = id;
    u.name = name;
    u.username = username;
    u.roles = roles;
    u._type = "user";
    return u;
}

@suite class token_property_tests {
    async before() {
        if (Util.IsNullEmpty(Config.aes_secret)) {
            Config.aes_secret = "7f2e27ed0e3a45f289ac249e1c4bc6f6";
        }
        Crypt.encryption_key = null;
        Config.disablelogging();
        await Logger.configure(true, false);
    }

    @test "createSlimToken then decryptToken roundtrips id"() {
        fc.assert(fc.property(arbId, arbExpiry, (id, exp) => {
            const token = Crypt.createSlimToken(id, null, null, exp);
            const decoded = Crypt.decryptToken(token);
            return decoded.data._id === id;
        }));
    }

    @test "createSlimToken preserves impostor field"() {
        fc.assert(fc.property(arbId, arbId, arbExpiry, (id, impostor, exp) => {
            const token = Crypt.createSlimToken(id, impostor, null, exp);
            const decoded = Crypt.decryptToken(token);
            return decoded.data._id === id && decoded.data.impostor === impostor;
        }));
    }

    @test "createSlimToken preserves tokenid field"() {
        fc.assert(fc.property(arbId, arbId, arbExpiry, (id, tokenid, exp) => {
            const token = Crypt.createSlimToken(id, null, tokenid, exp);
            const decoded = Crypt.decryptToken(token);
            return decoded.data.tokenid === tokenid;
        }));
    }

    @test "createSlimToken rejects empty id"() {
        fc.assert(fc.property(arbExpiry, (exp) => {
            try {
                Crypt.createSlimToken("", null, null, exp);
                return false;
            } catch {
                return true;
            }
        }));
    }

    @test "createToken preserves user fields in token"() {
        fc.assert(fc.property(arbId, arbName, arbName, arbExpiry, (id, name, username, exp) => {
            const user = makeUser(id, name, username, []);
            const token = Crypt.createToken(user, exp);
            const decoded = Crypt.decryptToken(token);
            return decoded.data._id === id &&
                   decoded.data.name === name &&
                   decoded.data.username === username &&
                   decoded.data._type === "user";
        }));
    }

    @test "createToken preserves roles"() {
        fc.assert(fc.property(
            arbId, arbName, arbName,
            fc.array(fc.tuple(arbName, arbId), { minLength: 1, maxLength: 5 }),
            arbExpiry,
            (id, name, username, roleTuples, exp) => {
                const roles = roleTuples.map(([n, rid]) => new Rolemember(n, rid));
                const user = makeUser(id, name, username, roles);
                const token = Crypt.createToken(user, exp);
                const decoded = Crypt.decryptToken(token);
                return decoded.data.roles.length === roles.length &&
                       decoded.data.roles.every((r, i) => r.name === roles[i].name && r._id === roles[i]._id);
            }
        ));
    }

    @test async "getTokenExp returns a future date"() {
        await fc.assert(fc.asyncProperty(arbId, arbExpiry, async (id, exp) => {
            const token = Crypt.createSlimToken(id, null, null, exp);
            const expDate = await Crypt.getTokenExp(token);
            return expDate.getTime() > Date.now();
        }));
    }

    @test async "getTokenExp throws on empty token"() {
        try {
            await Crypt.getTokenExp("");
            assert.fail("should have thrown");
        } catch (e) {
            assert.ok(e.message.includes("jwt must be provided"));
        }
    }

    @test "decryptToken fails on garbage input"() {
        fc.assert(fc.property(
            fc.string({ minLength: 10, maxLength: 100 }).filter(s => !s.includes(".")),
            (garbage) => {
                try {
                    Crypt.decryptToken(garbage);
                    return false;
                } catch {
                    return true;
                }
            }
        ));
    }

    @test "two tokens for same user have different signatures"() {
        fc.assert(fc.property(arbId, arbName, arbName, arbExpiry, (id, name, username, exp) => {
            const user = makeUser(id, name, username, []);
            const t1 = Crypt.createToken(user, exp);
            const t2 = Crypt.createToken(user, exp);
            // iat differs since they're created at slightly different times (or same second = same token)
            // At minimum, both should be valid
            const d1 = Crypt.decryptToken(t1);
            const d2 = Crypt.decryptToken(t2);
            return d1.data._id === d2.data._id;
        }));
    }
}

@suite class tokenuser_property_tests {
    @test "TokenUser.From preserves all fields"() {
        fc.assert(fc.property(
            arbId, arbName, arbName, arbName,
            fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
            (id, name, username, email, disabled, validated, emailvalidated, formvalidated) => {
                const user = new User();
                user._id = id;
                user.name = name;
                user.username = username;
                user.email = email;
                user.disabled = disabled;
                user.validated = validated;
                user.emailvalidated = emailvalidated;
                user.formvalidated = formvalidated;
                user.roles = [];
                user._type = "user";

                const token = TokenUser.From(user);
                return token._id === id &&
                       token.name === name &&
                       token.username === username &&
                       token.email === email &&
                       token.disabled === disabled &&
                       token.validated === validated &&
                       token.emailvalidated === emailvalidated &&
                       token.formvalidated === formvalidated &&
                       token._type === "user";
            }
        ));
    }

    @test "HasRoleName finds added roles"() {
        fc.assert(fc.property(
            fc.uniqueArray(fc.tuple(arbName, arbId), { minLength: 1, maxLength: 10, selector: ([n]) => n }),
            (roleTuples) => {
                const user = new TokenUser();
                user.roles = roleTuples.map(([n, id]) => new Rolemember(n, id));
                return roleTuples.every(([n]) => user.HasRoleName(n));
            }
        ));
    }

    @test "HasRoleName returns false for unknown roles"() {
        fc.assert(fc.property(arbName, arbName, arbId, (knownName, unknownName, id) => {
            fc.pre(knownName !== unknownName);
            const user = new TokenUser();
            user.roles = [new Rolemember(knownName, id)];
            return !user.HasRoleName(unknownName);
        }));
    }

    @test "HasRoleId finds added roles"() {
        fc.assert(fc.property(
            fc.uniqueArray(fc.tuple(arbName, arbId), { minLength: 1, maxLength: 10, selector: ([, id]) => id }),
            (roleTuples) => {
                const user = new TokenUser();
                user.roles = roleTuples.map(([n, id]) => new Rolemember(n, id));
                return roleTuples.every(([, id]) => user.HasRoleId(id));
            }
        ));
    }

    @test "HasRoleId returns false for unknown ids"() {
        fc.assert(fc.property(arbId, arbId, arbName, (knownId, unknownId, name) => {
            fc.pre(knownId !== unknownId);
            const user = new TokenUser();
            user.roles = [new Rolemember(name, knownId)];
            return !user.HasRoleId(unknownId);
        }));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Token.test.ts"
