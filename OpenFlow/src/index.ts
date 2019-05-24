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
import { Base, WellknownIds } from "./base";
import { User, FederationId } from "./User";
import { Crypt } from "./Crypt";
import { TokenUser } from "./TokenUser";
import { Auth } from "./Auth";
import { Role } from "./Role";
import { Config } from "./Config";

const logger: winston.Logger = Logger.configure();
Config.db = new DatabaseConnection(logger, Config.mongodb_url, Config.mongodb_db);

var con: amqp_consumer = new amqp_consumer(logger, Config.amqp_url, "hello1");
var pub: amqp_publisher = new amqp_publisher(logger, Config.amqp_url, "hello1");
var excon1: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var excon2: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var expub: amqp_exchange_publisher = new amqp_exchange_publisher(logger, Config.amqp_url, "hello2");
var rpccon: amqp_rpc_consumer = new amqp_rpc_consumer(logger, Config.amqp_url, "rpchello", (msg: string): string => {
    console.log("SUCCESS!!!!!! " + msg);
    return "server response! " + msg;
});
var rpcpub: amqp_rpc_publisher = new amqp_rpc_publisher(logger, Config.amqp_url);

async function ensureUser(jwt: string, name: string, username: string, id: string): Promise<User> {
    var user: User = await User.FindByUsernameOrId(username, id);
    if (user !== null && (user._id === id || id === null)) { return user; }
    if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", jwt); }
    user = new User(); user._id = id; user.name = name; user.username = username;
    await user.SetPassword(Math.random().toString(36).substr(2, 9));
    user = await Config.db.InsertOne(user, "users", jwt);
    user = User.assign(user);
    return user;
}
async function ensureRole(jwt: string, name: string, id: string): Promise<Role> {
    var role: Role = await Role.FindByNameOrId(name, id);
    if (role !== null && role._id === id) { return role; }
    if (role !== null) { await Config.db.DeleteOne(role._id, "users", jwt); }
    role = new Role(); role._id = id; role.name = name;
    role = await Config.db.InsertOne(role, "users", jwt);
    role = Role.assign(role);
    return role;
}
async function initDatabase(): Promise<void> {
    var jwt: string = TokenUser.rootToken();
    var admins: Role = await ensureRole(jwt, "admins", WellknownIds.admins);
    var users: Role = await ensureRole(jwt, "users", WellknownIds.users);
    var root: User = await ensureUser(jwt, "root", "root", WellknownIds.root);

    var nodered_admins: Role = await ensureRole(jwt, "nodered admins", WellknownIds.nodered_admins);
    nodered_admins.AddMember(admins);
    await nodered_admins.Save(jwt);
    var nodered_users: Role = await ensureRole(jwt, "nodered users", WellknownIds.nodered_users);
    nodered_users.AddMember(admins);
    await nodered_users.Save(jwt);
    var nodered_api_users: Role = await ensureRole(jwt, "nodered api users", WellknownIds.nodered_api_users);
    nodered_api_users.AddMember(admins);
    await nodered_api_users.Save(jwt);

    var robot_admins: Role = await ensureRole(jwt, "robot admins", WellknownIds.robot_admins);
    robot_admins.AddMember(admins);
    await robot_admins.Save(jwt);
    var robot_users: Role = await ensureRole(jwt, "robot users", WellknownIds.robot_users);
    robot_users.AddMember(admins);
    robot_users.AddMember(users);
    await robot_users.Save(jwt);

    users.AddMember(root);
    await users.Save(jwt);

    if (!admins.IsMember(root._id)) {
        admins.AddMember(root);
        await admins.Save(jwt);
    }
}

(async function (): Promise<void> {
    try {
        // await Config.get_login_providers();
        const server: http.Server = await WebServer.configure(logger, Config.baseurl());
        WebSocketServer.configure(logger, server);
        logger.info("listening on " + Config.baseurl());
        await initDatabase();

        // console.log("************************");
        // var e:Base = new Base();
        // e.name = "find me";
        // item = await db.create(e, "users", userjwt);
        // console.log(item);
        // console.log(res);
        // var arr:any[] = await db.query({}, null, 500, 0, null, "users", userjwt);
        // console.log(arr);
        // console.log("************************");
        // arr = await db.query({}, null, 500, 0, null, "users", jwt);
        // console.log(arr);
        // var item:Base = await db.getbyid(arr[0]._id, "users", jwt);
        // console.log(item);
        // item.name = "TEST: " + new Date().toISOString();
        // item = await db.update(item, "users", userjwt);
        // console.log(item);

        // console.log("************************");
        // await con.connect();
        // await pub.connect();
        // pub.SendMessage("pub/sub hi mom");
        // console.log("************************");
        // await excon1.connect();
        // await excon2.connect();
        // await expub.connect();
        // expub.SendMessage("exchange/hi mom");
        // console.log("************************");
        // await rpccon.connect();
        // await rpcpub.connect();
        // console.log("************************");
        // var rpcresult:string  = await rpcpub.SendMessage("Client says hi!", "rpchello");
        // console.log("rpcresult: " + rpcresult);
        // console.log("************************");
    } catch (error) {
        logger.error(error.message);
        console.error(error);
    }
})();
