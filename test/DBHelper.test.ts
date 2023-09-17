const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { FederationId, NoderedUtil, TokenUser, User, WellknownIds } from '@openiap/openflow-api';
import { Crypt } from '../OpenFlow/src/Crypt';

@suite class dbhelper_test {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    async after() {
        await Logger.shutdown();
    }
    @test async 'FindByUsername'() {
        var user = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null);
        assert.notStrictEqual(user, null, "Failed locating test user as root")
        user = await Logger.DBHelper.FindByUsername("testuser", this.userToken, null);
        assert.notStrictEqual(user, null, "Failed locating test user as self")
        user = await Logger.DBHelper.FindByUsername(null, this.rootToken, null);
        assert.strictEqual(user, null, "Returned user with null as username")
        // await assert.rejects(DBHelper.FindByUsername(null, this.rootToken, null));
    }
    @test async 'FindById'() {
        var user = await Logger.DBHelper.FindById(this.testUser._id, null);
        assert.notStrictEqual(user, null, "Failed locating test user as root")
    }
    @test async 'FindByUsernameOrFederationid'() {
        var user = await Logger.DBHelper.FindByUsernameOrFederationid(this.testUser.username, null, null);
        assert.notStrictEqual(user, null, "Failed locating user by username")
        user = await Logger.DBHelper.FindByUsernameOrFederationid("test@federation.id", 'google', null);
        assert.notStrictEqual(user, null, "Failed locating user by federation id")
        user = await Logger.DBHelper.FindByUsernameOrFederationid(null, null, null)
        assert.strictEqual(user, null, "Returned user with null as username and Federationid")
        // await assert.rejects(DBHelper.FindByUsernameOrFederationid(null, null));
    }
    @test async 'DecorateWithRoles'() {
        var tuser = TokenUser.From(this.testUser);
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
    @test async 'FindRoleByName'() {
        var role = await Logger.DBHelper.FindRoleByName(this.testUser.username, null, null);
        assert.strictEqual(role, null, "returned something with illegal name")
        role = await Logger.DBHelper.FindRoleByName("users", null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
    }
    @test async 'FindRoleByNameOrId'() {
        var role = await Logger.DBHelper.FindRoleByName(this.testUser.username, null, null);
        assert.strictEqual(role, null, "returned something with illegal name")
        role = await Logger.DBHelper.FindRoleByName("users", null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
        role = await Logger.DBHelper.FindRoleById(WellknownIds.users, null, null);
        assert.notStrictEqual(role, null, "Failed locating role users")
        role = await Logger.DBHelper.FindRoleByName(null, null, null);
        assert.strictEqual(role, null, "Returned role with null as username")
        role = await Logger.DBHelper.FindRoleById(null, null, null);
        assert.strictEqual(role, null, "Returned userrole with null as id")

        // await assert.rejects(DBHelper.FindRoleByName(null, null));
        // await assert.rejects(DBHelper.FindRoleById(null, null, null));
    }
    @timeout(5000)
    @test async 'EnsureUser'() {
        var name = "dummytestuser" + NoderedUtil.GetUniqueIdentifier();
        let extraoptions = {
            federationids: [new FederationId("test@federation.id", 'google')],
            emailvalidated: true,
            formvalidated: true,
            validated: true
        }
        var dummyuser: User = await Logger.DBHelper.EnsureUser(this.rootToken, name, name, null, "RandomPassword", extraoptions, null);
        var result = await Crypt.ValidatePassword(dummyuser, "RandomPassword", null);

        await Logger.DBHelper.EnsureNoderedRoles(dummyuser, this.rootToken, true, null);

        dummyuser = await Logger.DBHelper.DecorateWithRoles(dummyuser, null);
        assert.ok(dummyuser.roles.filter(x => x.name.endsWith("noderedadmins")), "EnsureNoderedRoles did not make dummy user member of noderedadmins");
        assert.ok(dummyuser.roles.filter(x => x.name.endsWith("nodered api users")), "EnsureNoderedRoles did not make dummy user member of nodered api users");


        assert.ok(result, "Failed validating with the correct password");
        await Config.db.DeleteOne(dummyuser._id, "users", false, this.rootToken, null);

        await assert.rejects(Logger.DBHelper.EnsureUser(this.rootToken, null, null, null, null, null, null));
    }
    @test async 'EnsureRole'() {
        var name = "dummytestrole" + NoderedUtil.GetUniqueIdentifier();
        var dummyrole = await Logger.DBHelper.EnsureRole(this.rootToken, name, null, null);
        await Config.db.DeleteOne(dummyrole._id, "users", false, this.rootToken, null);
        await assert.rejects(Logger.DBHelper.EnsureRole(null, null, null, null));
    }
}
// clear && ./node_modules/.bin/_mocha 'test/**/DBHelper.test.ts'