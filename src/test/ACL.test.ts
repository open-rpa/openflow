import { Ace } from "@openiap/nodeapi";
import { suite, test } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Base, Rights, Role, Rolemember } from "../commoninterfaces.js";

// Arbitraries
const arbId = fc.stringMatching(/^[0-9a-f]{24}$/);
const arbName = fc.string({ minLength: 1, maxLength: 50 });
const arbBit = fc.constantFrom(Rights.create, Rights.read, Rights.update, Rights.delete, Rights.invoke);
const arbRights = fc.uniqueArray(arbBit, { minLength: 1, maxLength: 5 });

@suite class acl_property_tests {
    @test "addRight then hasRight is always true"() {
        fc.assert(fc.property(arbId, arbName, arbBit, (id, name, bit) => {
            const item = new Base();
            Base.addRight(item, id, name, [bit]);
            return Base.hasRight(item, id, bit);
        }));
    }

    @test "addRight with multiple rights then each is present"() {
        fc.assert(fc.property(arbId, arbName, arbRights, (id, name, rights) => {
            const item = new Base();
            Base.addRight(item, id, name, rights);
            return rights.every(bit => Base.hasRight(item, id, bit));
        }));
    }

    @test "removeRight then hasRight is always false"() {
        fc.assert(fc.property(arbId, arbName, arbBit, (id, name, bit) => {
            const item = new Base();
            Base.addRight(item, id, name, [bit]);
            Base.removeRight(item, id, [bit]);
            return !Base.hasRight(item, id, bit);
        }));
    }

    @test "full_control grants all permission bits"() {
        fc.assert(fc.property(arbId, arbName, arbBit, (id, name, bit) => {
            const item = new Base();
            Base.addRight(item, id, name, [Rights.full_control]);
            return Base.hasRight(item, id, bit);
        }));
    }

    @test "removeRight with full_control removes the entire ACL entry"() {
        fc.assert(fc.property(arbId, arbName, (id, name) => {
            const item = new Base();
            Base.addRight(item, id, name, [Rights.full_control]);
            Base.removeRight(item, id, [Rights.full_control]);
            return Base.getRight(item, id) === null;
        }));
    }

    @test "adding same right twice does not duplicate ACL entries"() {
        fc.assert(fc.property(arbId, arbName, arbBit, (id, name, bit) => {
            const item = new Base();
            Base.addRight(item, id, name, [bit]);
            const countBefore = item._acl.filter(a => a._id === id).length;
            Base.addRight(item, id, name, [bit]);
            const countAfter = item._acl.filter(a => a._id === id).length;
            return countBefore === countAfter;
        }));
    }

    @test "different IDs get independent rights"() {
        fc.assert(fc.property(arbId, arbId, arbName, arbBit, arbBit, (id1, id2, name, bit1, bit2) => {
            fc.pre(id1 !== id2);
            const item = new Base();
            Base.addRight(item, id1, name, [bit1]);
            Base.addRight(item, id2, name, [bit2]);
            Base.removeRight(item, id1, [bit1]);
            // id2's rights should be unaffected
            return Base.hasRight(item, id2, bit2);
        }));
    }

    @test "deny rights are separate from allow rights"() {
        fc.assert(fc.property(arbId, arbName, arbBit, (id, name, bit) => {
            const item = new Base();
            Base.addRight(item, id, name, [bit], true);  // deny
            Base.addRight(item, id, name, [bit], false); // allow
            // Both should exist independently
            return Base.hasRight(item, id, bit, true) && Base.hasRight(item, id, bit, false);
        }));
    }

    @test "getRight returns null for unknown IDs"() {
        fc.assert(fc.property(arbId, arbId, arbName, arbBit, (knownId, unknownId, name, bit) => {
            fc.pre(knownId !== unknownId);
            const item = new Base();
            Base.addRight(item, knownId, name, [bit]);
            return Base.getRight(item, unknownId) === null;
        }));
    }

    // --- Role membership ---

    @test "AddMember then IsMember is always true"() {
        fc.assert(fc.property(arbId, arbName, (id, name) => {
            const role = new Role();
            role.members = [];
            const member = new Base();
            member._id = id;
            member.name = name;
            role.AddMember(member);
            return role.IsMember(id);
        }));
    }

    @test "RemoveMember then IsMember is always false"() {
        fc.assert(fc.property(arbId, arbName, (id, name) => {
            const role = new Role();
            role.members = [];
            const member = new Base();
            member._id = id;
            member.name = name;
            role.AddMember(member);
            role.RemoveMember(id);
            return !role.IsMember(id);
        }));
    }

    @test "AddMember is idempotent"() {
        fc.assert(fc.property(arbId, arbName, (id, name) => {
            const role = new Role();
            role.members = [];
            const member = new Base();
            member._id = id;
            member.name = name;
            role.AddMember(member);
            role.AddMember(member);
            return role.members.filter(m => m._id === id).length === 1;
        }));
    }

    @test "removing one member does not affect others"() {
        fc.assert(fc.property(arbId, arbId, arbName, arbName, (id1, id2, name1, name2) => {
            fc.pre(id1 !== id2);
            const role = new Role();
            role.members = [];
            const m1 = new Base(); m1._id = id1; m1.name = name1;
            const m2 = new Base(); m2._id = id2; m2.name = name2;
            role.AddMember(m1);
            role.AddMember(m2);
            role.RemoveMember(id1);
            return !role.IsMember(id1) && role.IsMember(id2);
        }));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/ACL.test.ts"
