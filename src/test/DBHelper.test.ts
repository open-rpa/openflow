import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { FederationId, TokenUser, User } from "../commoninterfaces.js";
import { testConfig } from "./testConfig.js";

@suite class dbhelper_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test async "FindByUsername"() {
        var user = await Logger.DBHelper.FindByUsername(testConfig.testUser.username, Crypt.rootToken(), null);
        assert.notStrictEqual(user, null, "Failed locating test user as root")
        user = await Logger.DBHelper.FindByUsername(testConfig.testUser.username, testConfig.userToken, null);
        assert.notStrictEqual(user, null, "Failed locating test user as self")
        user = await Logger.DBHelper.FindByUsername(null, Crypt.rootToken(), null);
        assert.strictEqual(user, null, "Returned user with null as username")
        // await assert.rejects(DBHelper.FindByUsername(null, Crypt.rootToken(), null));
    }
    @test async "FindById"() {
        var user = await Logger.DBHelper.FindById(testConfig.testUser._id, null);
        assert.notStrictEqual(user, null, "Failed locating test user as root")
    }
    @test async "FindByUsernameOrFederationid"() {
        var user = await Logger.DBHelper.FindByUsernameOrFederationid(testConfig.testUser.username, null, null);
        assert.notStrictEqual(user, null, "Failed locating user by username")
        user = await Logger.DBHelper.FindByUsernameOrFederationid("test@federation.id", "google", null);
        assert.notStrictEqual(user, null, "Failed locating user by federation id")
        user = await Logger.DBHelper.FindByUsernameOrFederationid(null, null, null)
        assert.strictEqual(user, null, "Returned user with null as username and Federationid")
        // await assert.rejects(DBHelper.FindByUsernameOrFederationid(null, null));
    }
    @test async "DecorateWithRoles"() {
        var tuser = TokenUser.From(testConfig.testUser);
        tuser.roles = [];
        tuser = await Logger.DBHelper.DecorateWithRoles(tuser, null);
        assert.notStrictEqual(tuser.roles.length, 0, "No roles added to user")
        Config.decorate_roles_fetching_all_roles = !Config.decorate_roles_fetching_all_roles;
        tuser.roles = [];
        tuser = await Logger.DBHelper.DecorateWithRoles(tuser, null);
        assert.notStrictEqual(tuser.roles.length, 0, "No roles added to user")
        tuser = await Logger.DBHelper.DecorateWithRoles(null, null)
        assert.strictEqual(tuser, null, "DecorateWithRoles Returned user with null argument")
        // await assert.rejects(DBHelper.DecorateWithRoles(null, null));
    }
    @test async "FindRoleByName"() {
        var role = await Logger.DBHelper.FindRoleByName(testConfig.testUser.username, null, null);
        assert.strictEqual(role, null, "returned something with illegal name")
        role = await Logger.DBHelper.FindRoleByName(Wellknown.users.name, null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
    }
    @test async "FindRoleByNameOrId"() {
        var role = await Logger.DBHelper.FindRoleByName(testConfig.testUser.username, null, null);
        assert.strictEqual(role, null, "returned something with illegal name")
        role = await Logger.DBHelper.FindRoleByName(Wellknown.users.name, null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
        role = await Logger.DBHelper.FindRoleById(Wellknown.users._id, null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
        role = await Logger.DBHelper.FindRoleByName(null, null, null);
        assert.strictEqual(role, null, "Returned role with null as username")
        role = await Logger.DBHelper.FindRoleById(null, null, null);
        assert.strictEqual(role, null, "Returned userrole with null as id")

        // await assert.rejects(DBHelper.FindRoleByName(null, null));
        // await assert.rejects(DBHelper.FindRoleById(null, null, null));
    }
    @timeout(5000)
    @test async "EnsureUser"() {
        var name = "dummytestuser" + Util.GetUniqueIdentifier();
        let extraoptions = {
            federationids: [new FederationId("test@federation.id", "google")],
            emailvalidated: true,
            formvalidated: true,
            validated: true
        }
        var dummyuser: User = await Logger.DBHelper.EnsureUser(Crypt.rootToken(), name, name, null, "RandomPassword", extraoptions, null);
        var result = await Crypt.ValidatePassword(dummyuser, "RandomPassword", null);

        await Logger.DBHelper.EnsureNoderedRoles(dummyuser, Crypt.rootToken(), true, null);

        dummyuser = await Logger.DBHelper.DecorateWithRoles(dummyuser, null);
        assert.ok(dummyuser.roles.filter(x => x.name.endsWith("noderedadmins")), "EnsureNoderedRoles did not make dummy user member of noderedadmins");
        assert.ok(dummyuser.roles.filter(x => x.name.endsWith("nodered api users")), "EnsureNoderedRoles did not make dummy user member of nodered api users");


        assert.ok(result, "Failed validating with the correct password");
        await Config.db.DeleteOne(dummyuser._id, Wellknown.users.name, false, Crypt.rootToken(), null);

        await assert.rejects(Logger.DBHelper.EnsureUser(Crypt.rootToken(), null, null, null, null, null, null));
    }
    @test async "EnsureRole"() {
        var name = "dummytestrole" + Util.GetUniqueIdentifier();
        var dummyrole = await Logger.DBHelper.EnsureRole(name, null, null);
        await Config.db.DeleteOne(dummyrole._id, Wellknown.users.name, false, Crypt.rootToken(), null);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/DBHelper.test.ts"