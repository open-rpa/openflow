import * as winston from "winston";
import * as http from "http";
import * as WebSocket from "ws";

import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { WebSocketServer } from "./WebSocketServer";
import { amqp_consumer, amqp_rpc_consumer } from "./amqp_consumer";
import { amqp_publisher, amqp_rpc_publisher } from "./amqp_publisher";
import { amqp_exchange_consumer } from "./amqp_exchange_consumer";
import { amqp_exchange_publisher } from "./amqp_exchange_publisher";
import { DatabaseConnection } from "./DatabaseConnection";
import { Base, WellknownIds, Rights } from "./base";
import { User, FederationId } from "./User";
import { Crypt } from "./Crypt";
import { TokenUser } from "./TokenUser";
import { Auth } from "./Auth";
import { Role } from "./Role";
import { Config } from "./Config";
import { KubeUtil } from "./KubeUtil";

const logger: winston.Logger = Logger.configure();
Config.db = new DatabaseConnection(logger, Config.mongodb_url, Config.mongodb_db);

var con: amqp_consumer = new amqp_consumer(logger, Config.amqp_url, "hello1");
var pub: amqp_publisher = new amqp_publisher(logger, Config.amqp_url, "hello1");
var excon1: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var excon2: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var expub: amqp_exchange_publisher = new amqp_exchange_publisher(logger, Config.amqp_url, "hello2");
var rpccon: amqp_rpc_consumer = new amqp_rpc_consumer(logger, Config.amqp_url, "rpchello", (msg: string): string => {
    return "server response! " + msg;
});
var rpcpub: amqp_rpc_publisher = new amqp_rpc_publisher(logger, Config.amqp_url);


async function initDatabase(): Promise<boolean> {
    try {
        var jwt: string = TokenUser.rootToken();
        var admins: Role = await User.ensureRole(jwt, "admins", WellknownIds.admins);
        var users: Role = await User.ensureRole(jwt, "users", WellknownIds.users);
        var root: User = await User.ensureUser(jwt, "root", "root", WellknownIds.root, null);

        root.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        root.removeRight(WellknownIds.admins, [Rights.delete]);
        root.addRight(WellknownIds.root, "root", [Rights.full_control]);
        root.removeRight(WellknownIds.root, [Rights.delete]);
        await root.Save(jwt);


        admins.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        admins.removeRight(WellknownIds.admins, [Rights.delete]);
        await admins.Save(jwt);

        users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        users.removeRight(WellknownIds.admins, [Rights.delete]);
        users.AddMember(root);
        if (users.getRight(users._id) && Config.multi_tenant) users.removeRight(users._id, [Rights.full_control])
        await users.Save(jwt);


        var personal_nodered_users: Role = await User.ensureRole(jwt, "personal nodered users", WellknownIds.personal_nodered_users);
        personal_nodered_users.AddMember(admins);
        personal_nodered_users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        personal_nodered_users.removeRight(WellknownIds.admins, [Rights.delete]);
        if (personal_nodered_users.getRight(personal_nodered_users._id) && Config.multi_tenant) personal_nodered_users.removeRight(personal_nodered_users._id, [Rights.full_control])
        await personal_nodered_users.Save(jwt);
        var nodered_admins: Role = await User.ensureRole(jwt, "nodered admins", WellknownIds.nodered_admins);
        nodered_admins.AddMember(admins);
        nodered_admins.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        nodered_admins.removeRight(WellknownIds.admins, [Rights.delete]);
        await nodered_admins.Save(jwt);
        var nodered_users: Role = await User.ensureRole(jwt, "nodered users", WellknownIds.nodered_users);
        nodered_users.AddMember(admins);
        nodered_users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        nodered_users.removeRight(WellknownIds.admins, [Rights.delete]);
        if (nodered_users.getRight(nodered_users._id) && Config.multi_tenant) nodered_users.removeRight(nodered_users._id, [Rights.full_control])
        await nodered_users.Save(jwt);
        var nodered_api_users: Role = await User.ensureRole(jwt, "nodered api users", WellknownIds.nodered_api_users);
        nodered_api_users.AddMember(admins);
        nodered_api_users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        nodered_api_users.removeRight(WellknownIds.admins, [Rights.delete]);
        if (nodered_api_users.getRight(nodered_api_users._id) && Config.multi_tenant) nodered_api_users.removeRight(nodered_api_users._id, [Rights.full_control])
        await nodered_api_users.Save(jwt);

        var robot_admins: Role = await User.ensureRole(jwt, "robot admins", WellknownIds.robot_admins);
        robot_admins.AddMember(admins);
        robot_admins.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        robot_admins.removeRight(WellknownIds.admins, [Rights.delete]);
        await robot_admins.Save(jwt);
        var robot_users: Role = await User.ensureRole(jwt, "robot users", WellknownIds.robot_users);
        robot_users.AddMember(admins);
        robot_users.AddMember(users);
        robot_users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        robot_users.removeRight(WellknownIds.admins, [Rights.delete]);
        if (robot_users.getRight(robot_users._id) && Config.multi_tenant) robot_users.removeRight(robot_users._id, [Rights.full_control])
        await robot_users.Save(jwt);

        if (!admins.IsMember(root._id)) {
            admins.AddMember(root);
            await admins.Save(jwt);
        }

        var filestore_admins: Role = await User.ensureRole(jwt, "filestore admins", WellknownIds.filestore_admins);
        filestore_admins.AddMember(admins);
        filestore_admins.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        filestore_admins.removeRight(WellknownIds.admins, [Rights.delete]);
        if (filestore_admins.getRight(filestore_admins._id) && Config.multi_tenant) filestore_admins.removeRight(filestore_admins._id, [Rights.full_control])
        await filestore_admins.Save(jwt);
        var filestore_users: Role = await User.ensureRole(jwt, "filestore users", WellknownIds.filestore_users);
        filestore_users.AddMember(admins);
        filestore_users.AddMember(users);
        filestore_users.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        filestore_users.removeRight(WellknownIds.admins, [Rights.delete]);
        if (filestore_users.getRight(filestore_users._id) && Config.multi_tenant) filestore_users.removeRight(filestore_users._id, [Rights.full_control])
        await filestore_users.Save(jwt);



        // Temp hack to update all existing users and roles
        // var _users = await Config.db.query<Role>({ $or: [{ _type: "user" }, { _type: "role" }] }, null, 1000, 0, null, "users", jwt);
        // for (var i = 0; i < _users.length; i++) {
        //     var u = await Role.FindByNameOrId(null, _users[i]._id);
        // }

        return true;
    } catch (error) {
        logger.error(error);
        return false;
    }
}


process.on('unhandledRejection', up => {
    console.error(up);
    throw up
});

(async function (): Promise<void> {
    try {
        // await Config.get_login_providers();
        const server: http.Server = await WebServer.configure(logger, Config.baseurl());
        WebSocketServer.configure(logger, server);
        logger.info("listening on " + Config.baseurl());
        logger.info("namespace: " + Config.namespace);
        if (!await initDatabase()) {
            process.exit(404);
        }
    } catch (error) {
        // logger.error(error.message);
        var json = JSON.stringify(error, null, 3);
        console.error(json);

    }
})();
