import { suite, test } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { SocketMessage } from "../SocketMessage.js";

const arbCommand = fc.constantFrom("signin", "query", "insertone", "updateone", "deleteone", "aggregate", "watch", "unwatch");
const arbId = fc.stringMatching(/^[0-9a-f]{16,32}$/);

@suite class socketmessage_property_tests {
    @test "fromjson then tojson roundtrips command and data"() {
        fc.assert(fc.property(arbCommand, fc.string(), (command, data) => {
            const json = JSON.stringify({ command, data });
            const msg = SocketMessage.fromjson(json);
            assert.strictEqual(msg.command, command);
            assert.strictEqual(msg.data, data);
            // tojson should produce valid JSON
            const reparsed = JSON.parse(msg.tojson());
            return reparsed.command === command && reparsed.data === data;
        }));
    }

    @test "fromjson assigns a generated id when missing"() {
        fc.assert(fc.property(arbCommand, (command) => {
            const json = JSON.stringify({ command });
            const msg = SocketMessage.fromjson(json);
            return msg.id != null && msg.id.length > 0;
        }));
    }

    @test "fromjson preserves provided id"() {
        fc.assert(fc.property(arbCommand, arbId, (command, id) => {
            const json = JSON.stringify({ command, id });
            const msg = SocketMessage.fromjson(json);
            return msg.id === id;
        }));
    }

    @test "fromjson preserves replyto"() {
        fc.assert(fc.property(arbCommand, arbId, arbId, (command, id, replyto) => {
            const json = JSON.stringify({ command, id, replyto });
            const msg = SocketMessage.fromjson(json);
            return msg.replyto === replyto;
        }));
    }

    @test "fromjson defaults count to 1 and index to 0"() {
        fc.assert(fc.property(arbCommand, (command) => {
            const json = JSON.stringify({ command });
            const msg = SocketMessage.fromjson(json);
            return msg.count === 1 && msg.index === 0;
        }));
    }

    @test "fromjson parses count and index when provided"() {
        fc.assert(fc.property(
            arbCommand,
            fc.integer({ min: 1, max: 100 }),
            fc.integer({ min: 0, max: 99 }),
            (command, count, index) => {
                const json = JSON.stringify({ command, count, index });
                const msg = SocketMessage.fromjson(json);
                return msg.count === count && msg.index === index;
            }
        ));
    }

    @test "fromjson parses priority"() {
        fc.assert(fc.property(
            arbCommand,
            fc.integer({ min: 1, max: 5 }),
            (command, priority) => {
                const json = JSON.stringify({ command, priority });
                const msg = SocketMessage.fromjson(json);
                return msg.priority === priority;
            }
        ));
    }

    @test "fromjson defaults priority to 1 when missing"() {
        fc.assert(fc.property(arbCommand, (command) => {
            const json = JSON.stringify({ command });
            const msg = SocketMessage.fromjson(json);
            return msg.priority === 1;
        }));
    }

    @test "fromjson parses clientagent and clientversion"() {
        fc.assert(fc.property(
            arbCommand,
            fc.constantFrom("openrpa", "nodered", "webapp", "test"),
            fc.stringMatching(/^\d+\.\d+\.\d+$/),
            (command, agent, version) => {
                const json = JSON.stringify({ command, clientagent: agent, clientversion: version });
                const msg = SocketMessage.fromjson(json);
                return msg.clientagent === agent && msg.clientversion === version;
            }
        ));
    }

    @test "fromcommand creates message with correct defaults"() {
        fc.assert(fc.property(arbCommand, (command) => {
            const msg = SocketMessage.fromcommand(command);
            return msg.command === command &&
                   msg.count === 1 &&
                   msg.index === 0 &&
                   msg.id != null && msg.id.length > 0;
        }));
    }

    @test "tojson produces valid JSON for any message"() {
        fc.assert(fc.property(
            arbCommand,
            fc.string({ maxLength: 200 }),
            fc.integer({ min: 1, max: 10 }),
            fc.integer({ min: 0, max: 9 }),
            (command, data, count, index) => {
                const json = JSON.stringify({ command, data, count, index });
                const msg = SocketMessage.fromjson(json);
                const output = msg.tojson();
                // Must not throw
                JSON.parse(output);
                return true;
            }
        ));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/SocketMessage.test.ts"
