import { Ace } from "@openiap/nodeapi";
import { suite, test } from "@testdeck/mocha";
import * as fc from "fast-check";

const arbBit = fc.integer({ min: 1, max: Ace.ace_right_bits });

@suite class ace_bit_property_tests {
    @test "setBit then isBitSet is true (number rights)"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            Ace.resetnone(ace);
            // ensure numeric mode
            ace.rights = 0;
            Ace.setBit(ace, bit);
            return Ace.isBitSet(ace, bit);
        }));
    }

    @test "unsetBit then isBitSet is false (number rights)"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.setBit(ace, bit);
            Ace.unsetBit(ace, bit);
            return !Ace.isBitSet(ace, bit);
        }));
    }

    @test "setBit is idempotent"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.setBit(ace, bit);
            const after1 = ace.rights;
            Ace.setBit(ace, bit);
            const after2 = ace.rights;
            return after1 === after2;
        }));
    }

    @test "unsetBit is idempotent"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.setBit(ace, bit);
            Ace.unsetBit(ace, bit);
            const after1 = ace.rights;
            Ace.unsetBit(ace, bit);
            const after2 = ace.rights;
            return after1 === after2;
        }));
    }

    @test "setting one bit does not affect other bits"() {
        fc.assert(fc.property(arbBit, arbBit, (bit1, bit2) => {
            fc.pre(bit1 !== bit2);
            const ace = new Ace();
            ace.rights = 0;
            Ace.setBit(ace, bit1);
            Ace.setBit(ace, bit2);
            Ace.unsetBit(ace, bit1);
            return Ace.isBitSet(ace, bit2) && !Ace.isBitSet(ace, bit1);
        }));
    }

    @test "toogleBit flips state"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.toogleBit(ace, bit);
            const set = Ace.isBitSet(ace, bit);
            Ace.toogleBit(ace, bit);
            const unset = Ace.isBitSet(ace, bit);
            return set === true && unset === false;
        }));
    }

    @test "double toggle is a no-op"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.setBit(ace, bit);
            Ace.toogleBit(ace, bit);
            Ace.toogleBit(ace, bit);
            return Ace.isBitSet(ace, bit);
        }));
    }

    @test "resetfullcontrol sets all bits"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            ace.rights = 0;
            Ace.resetfullcontrol(ace);
            return Ace.isBitSet(ace, bit);
        }));
    }

    @test "resetnone clears all bits"() {
        fc.assert(fc.property(arbBit, (bit) => {
            const ace = new Ace();
            Ace.resetfullcontrol(ace);
            Ace.resetnone(ace);
            return !Ace.isBitSet(ace, bit);
        }));
    }

    @test "setting multiple random bits then checking each"() {
        fc.assert(fc.property(
            fc.uniqueArray(arbBit, { minLength: 1, maxLength: Ace.ace_right_bits }),
            (bits) => {
                const ace = new Ace();
                ace.rights = 0;
                bits.forEach(b => Ace.setBit(ace, b));
                return bits.every(b => Ace.isBitSet(ace, b));
            }
        ));
    }

    @test "set bits then unset subset, remaining stay set"() {
        fc.assert(fc.property(
            fc.uniqueArray(arbBit, { minLength: 2, maxLength: Ace.ace_right_bits }),
            (bits) => {
                const ace = new Ace();
                ace.rights = 0;
                bits.forEach(b => Ace.setBit(ace, b));
                // unset first half
                const toRemove = bits.slice(0, Math.floor(bits.length / 2));
                const toKeep = bits.slice(Math.floor(bits.length / 2));
                toRemove.forEach(b => Ace.unsetBit(ace, b));
                return toRemove.every(b => !Ace.isBitSet(ace, b)) &&
                       toKeep.every(b => Ace.isBitSet(ace, b));
            }
        ));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Ace.test.ts"
