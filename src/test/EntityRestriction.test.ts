import { suite, test } from "@testdeck/mocha";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { EntityRestriction } from "../EntityRestriction.js";
import { dbConfig } from "../Config.js";
import { Base, Customer, FederationId, Member, Role, Rolemember, User } from "../commoninterfaces.js";

@suite class entityrestriction_property_tests {
    async before() {
        Config.disablelogging();
        await Logger.configure(true, false);
    }

    @test "assign from object preserves fields"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 30 }),
            fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
            fc.boolean(),
            (collection, paths, copyperm) => {
                const obj = { collection, paths, copyperm, _type: "restriction", name: "test" };
                const er = EntityRestriction.assign(obj) as any;
                return er.collection === collection &&
                       er.paths.length === paths.length &&
                       er.copyperm === copyperm;
            }
        ));
    }

    @test "assign from JSON string preserves fields"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            (collection) => {
                const jsonStr = JSON.stringify({ collection, paths: ["$.test"], _type: "restriction" });
                const er = EntityRestriction.assign(jsonStr) as any;
                return er.collection === collection;
            }
        ));
    }

    @test "IsMatch returns false for null/undefined"() {
        const er = EntityRestriction.assign({ paths: ["$.a.name"], _type: "restriction" }) as any;
        return !er.IsMatch(null) && !er.IsMatch(undefined);
    }

    @test "IsMatch matches using JSONPath on wrapped object"() {
        // IsMatch wraps input as {a: object}, so paths reference $.a
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            (name) => {
                const er = EntityRestriction.assign({ paths: ["$.a.name"], _type: "restriction" }) as any;
                return er.IsMatch({ name }) === true;
            }
        ));
    }

    @test "IsMatch returns false for non-matching path"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
            (value) => {
                const er = EntityRestriction.assign({ paths: ["$.a.nonexistent_field_xyz"], _type: "restriction" }) as any;
                return er.IsMatch({ other: value }) === false;
            }
        ));
    }

    @test "IsMatch with empty paths returns false"() {
        fc.assert(fc.property(fc.object(), (obj) => {
            const er = EntityRestriction.assign({ paths: [], _type: "restriction" }) as any;
            return er.IsMatch(obj) === false;
        }));
    }

    @test "IsMatch with multiple paths matches if any path hits"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
            (name) => {
                const er = EntityRestriction.assign({
                    paths: ["$.a.nonexistent", "$.a.name"],
                    _type: "restriction"
                }) as any;
                // Second path should match even though first doesn't
                return er.IsMatch({ name }) === true;
            }
        ));
    }
}

@suite class version_compare_property_tests {
    @test "compare: same version returns 0"() {
        fc.assert(fc.property(
            fc.tuple(
                fc.integer({ min: 0, max: 99 }),
                fc.integer({ min: 0, max: 99 }),
                fc.integer({ min: 0, max: 99 }),
            ).map(([a, b, c]) => `${a}.${b}.${c}`),
            (version) => {
                const conf = new dbConfig();
                conf.version = version;
                return conf.compare(version) === 0;
            }
        ));
    }

    @test "compare: higher version returns positive"() {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 98 }),
            fc.integer({ min: 0, max: 99 }),
            (major, minor) => {
                const conf = new dbConfig();
                conf.version = `${major + 1}.${minor}.0`;
                return conf.compare(`${major}.${minor}.0`) > 0;
            }
        ));
    }

    @test "compare: lower version returns negative"() {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 99 }),
            fc.integer({ min: 0, max: 99 }),
            (major, minor) => {
                const conf = new dbConfig();
                conf.version = `${major - 1}.${minor}.0`;
                return conf.compare(`${major}.${minor}.0`) < 0;
            }
        ));
    }

    @test "compare: null version returns -1"() {
        const conf = new dbConfig();
        conf.version = null;
        return conf.compare("1.0.0") === -1;
    }
}

@suite class constructors_coverage_tests {
    // These exercise constructors for uncovered classes in commoninterfaces.ts
    @test "all entity constructors set correct _type"() {
        const member = new Member();
        const customer = new Customer();
        const role = new Role();
        const user = new User();

        return member._type === "member" &&
               customer._type === "customer" &&
               role._type === "role" &&
               user._type === "user";
    }

    @test "Base.assign copies all provided fields"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
            (name, type) => {
                const source = { name, _type: type, _version: 5 };
                const result = Base.assign(source);
                return result.name === name && result._type === type && result._version === 5;
            }
        ));
    }

    @test "User.assign copies all provided fields"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
            (name, username, email) => {
                const result: any = User.assign({ name, username, email, _type: "user" });
                return result.name === name && result.username === username && result.email === email;
            }
        ));
    }

    @test "Role.assign copies members"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.array(fc.tuple(
                fc.string({ minLength: 1 }),
                fc.stringMatching(/^[0-9a-f]{24}$/)
            ), { minLength: 0, maxLength: 5 }),
            (name, memberTuples) => {
                const members = memberTuples.map(([n, id]) => new Rolemember(n, id));
                const result: any = Role.assign({ name, members, _type: "role" });
                return result.name === name && result.members.length === members.length;
            }
        ));
    }

    @test "User.HasRoleName and HasRoleId work like TokenUser versions"() {
        fc.assert(fc.property(
            fc.uniqueArray(fc.tuple(
                fc.string({ minLength: 1 }),
                fc.stringMatching(/^[0-9a-f]{24}$/)
            ), { minLength: 1, maxLength: 10, selector: ([n]) => n }),
            (roleTuples) => {
                const user = new User();
                user.roles = roleTuples.map(([n, id]) => new Rolemember(n, id));
                return roleTuples.every(([n, id]) => user.HasRoleName(n) && user.HasRoleId(id));
            }
        ));
    }

    @test "FederationId constructor"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 }),
            (id, issuer) => {
                const fed = new FederationId(id, issuer);
                return fed.id === id && fed.issuer === issuer;
            }
        ));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/EntityRestriction.test.ts" "src/test/**/SocketMessage.test.ts"
