import crypto from "crypto";
export class Wellknown {
    static root = {_id: "59f1f6e6f0a22200126638d8", name: "root"};
    static guest = {_id: "65cb30c40ff51e174095573c", name: "guest"};
    static admins = {_id: "5a1702fa245d9013697656fb", name: "admins"};
    static users = {_id: "5a17f157c4815318c8536c21", name: "users"};
    static robots = {_id: "5ac0850ca538fee1ebdb996c", name: "robots"};
    static customer_admins = {_id: "5a1702fa245d9013697656fc", name: "customer admins"};
    static resellers = {_id: "5a1702fa245d9013697656fd", name: "resellers"};
    static nodered_users = {_id: "5a23f18a2e8987292ddbe061", name: "nodered users"};
    static nodered_admins = {_id: "5a17f157c4815318c8536c20", name: "nodered admins"};
    static nodered_api_users = {_id: "5a17f157c4815318c8536c22", name: "nodered api users"};
    static filestore_users = {_id: "5b6ab63c8d4a64b7c47f4a8f", name: "filestore users"};
    static filestore_admins = {_id: "5b6ab63c8d4a64b7c47f4a8e", name: "filestore admins"};
    static robot_users = {_id: "5aef0142f3683977b0aa3dd3", name: "robot users"};
    static robot_admins = {_id: "5aef0142f3683977b0aa3dd2", name: "robot admins"};
    static personal_nodered_users = {_id: "5a23f18a2e8987292ddbe062", name: "personal nodered users"};
    static robot_agent_users = {_id: "5f33c29d8fe78504bd259a04", name: "robot agent users"};
    static workitem_queue_admins = {_id: "625440c4231309af5f2052cd", name: "workitem queue admins"};
    static workitem_queue_users = {_id: "62544134231309e2cd2052ce", name: "workitem queue users"};
}
export class Util {
    public static Delay = ms => new Promise<void>(res => setTimeout(res, ms));
    public static IsNullUndefinded(obj: any) {
        if (obj === null || obj === undefined) {
            return true;
        }
        return false;
    }
    public static IsNullEmpty(obj: any) {
        if (obj === null || obj === undefined || obj === "") {
            return true;
        }
        return false;
    }
    public static IsString(obj: any) {
        if (typeof obj === "string" || obj instanceof String) {
            return true;
        }
        return false;
    }
    public static isObject(obj: any): boolean {
        return obj === Object(obj);
    }
    public static GetUniqueIdentifier(length: number = 16): string {
        return crypto.randomBytes(16).toString("hex")
    }

}