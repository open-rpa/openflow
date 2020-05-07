import { fetch, toPassportConfig } from "passport-saml-metadata";
import * as fs from "fs";
import * as retry from "async-retry";
import { json } from "body-parser";
import { DatabaseConnection } from "./DatabaseConnection";
import { Provider } from "./LoginProvider";
import { TokenUser } from "./TokenUser";
import { Logger } from "./Logger";
import { Util } from "./Util";

export class Config {
    public static db: DatabaseConnection = null;
    public static version: string = fs.readFileSync("VERSION", "utf8");

    public static NODE_ENV: string = Config.getEnv("NODE_ENV", "development");

    public static stripe_api_key: string = Config.getEnv("stripe_api_key", "");
    public static stripe_api_secret: string = Config.getEnv("stripe_api_secret", "");

    public static auto_create_users: boolean = Config.parseBoolean(Config.getEnv("auto_create_users", "false"));
    public static auto_create_domains: string[] = Config.parseArray(Config.getEnv("auto_create_domains", ""));
    public static allow_user_registration: boolean = Config.parseBoolean(Config.getEnv("allow_user_registration", "false"));
    public static allow_personal_nodered: boolean = Config.parseBoolean(Config.getEnv("allow_personal_nodered", "false"));
    public static auto_create_personal_nodered_group: boolean = Config.parseBoolean(Config.getEnv("auto_create_personal_nodered_group", "false"));

    public static tls_crt: string = Config.getEnv("tls_crt", "");
    public static tls_key: string = Config.getEnv("tls_key", "");
    public static tls_ca: string = Config.getEnv("tls_ca", "");
    public static tls_passphrase: string = Config.getEnv("tls_passphrase", "");


    public static update_acl_based_on_groups: boolean = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups", "false"));
    public static multi_tenant: boolean = Config.parseBoolean(Config.getEnv("multi_tenant", "false"));
    public static api_bypass_perm_check: boolean = Config.parseBoolean(Config.getEnv("api_bypass_perm_check", "false"));
    public static websocket_package_size: number = parseInt(Config.getEnv("websocket_package_size", "4096"), 10);
    public static websocket_max_package_count: number = parseInt(Config.getEnv("websocket_max_package_count", "1024"), 10);
    public static protocol: string = Config.getEnv("protocol", "http"); // used by personal nodered and baseurl()
    public static port: number = parseInt(Config.getEnv("port", "3000"));
    public static domain: string = Config.getEnv("domain", "localhost"); // sent to website and used in baseurl()


    public static amqp_url: string = Config.getEnv("amqp_url", "amqp://localhost"); // used to register queues and by personal nodered
    public static mongodb_url: string = Config.getEnv("mongodb_url", "mongodb://localhost:27017");
    public static mongodb_db: string = Config.getEnv("mongodb_db", "openflow");

    public static skip_history_collections: string = Config.getEnv("skip_history_collections", "");
    public static allow_skiphistory: boolean = Config.parseBoolean(Config.getEnv("allow_skiphistory", "true"));

    public static saml_issuer: string = Config.getEnv("saml_issuer", "the-issuer"); // define uri of STS, also sent to personal nodereds
    public static aes_secret: string = Config.getEnv("aes_secret", "");
    public static signing_crt: string = Config.getEnv("signing_crt", "");
    public static singing_key: string = Config.getEnv("singing_key", "");
    public static shorttoken_expires_in: string = Config.getEnv("shorttoken_expires_in", "5m");
    public static longtoken_expires_in: string = Config.getEnv("longtoken_expires_in", "365d");
    public static downloadtoken_expires_in: string = Config.getEnv("downloadtoken_expires_in", "15m");
    public static personalnoderedtoken_expires_in: string = Config.getEnv("personalnoderedtoken_expires_in", "365d");

    // Used to configure personal nodered's
    public static force_queue_prefix: boolean = Config.parseBoolean(Config.getEnv("force_queue_prefix", "true"));
    public static nodered_image: string = Config.getEnv("nodered_image", "cloudhack/openflownodered:edge");
    public static saml_federation_metadata: string = Config.getEnv("saml_federation_metadata", "");
    public static api_ws_url: string = Config.getEnv("api_ws_url", "ws://localhost:3000");
    public static namespace: string = Config.getEnv("namespace", ""); // also sent to website 
    public static nodered_domain_schema: string = Config.getEnv("nodered_domain_schema", ""); // also sent to website
    public static nodered_initial_liveness_delay: number = parseInt(Config.getEnv("nodered_initial_liveness_delay", "60"));

    public static baseurl(): string {
        var result: string = "";
        if (Config.tls_crt != '' && Config.tls_key != '') {
            result = "https://" + Config.domain;
        } else {
            result = Config.protocol + "://" + Config.domain;
        }
        if (Config.port != 80 && Config.port != 443) {
            result = result + ":" + Config.port + "/";
        } else { result = result + "/"; }
        return result;
    }
    // public static async get_login_providers():Promise<void> {
    //     this.login_providers = await Config.db.query<Provider>({_type: "provider"}, null, 1, 0, null, "config", TokenUser.rootToken());
    //     // if(this.login_providers.length > 0) { return; }
    //     if(fs.existsSync("config/login_providers.json")) {
    //         // this.login_providers = JSON.parse(fs.readFileSync("config/login_providers.json", "utf8"));
    //     }
    // }
    public static getEnv(name: string, defaultvalue: string): string {
        var value: any = process.env[name];
        if (!value || value === "") { value = defaultvalue; }
        return value;
    }
    public static async parse_federation_metadata(url: string): Promise<any> {
        // if anything throws, we retry
        var metadata: any = await retry(async bail => {
            var reader: any = await fetch({ url });
            if (Util.IsNullUndefinded(reader)) { bail(new Error("Failed getting result")); return; }
            var config: any = toPassportConfig(reader);
            // we need this, for Office 365 :-/
            if (reader.signingCerts && reader.signingCerts.length > 1) {
                config.cert = reader.signingCerts;
            }
            return config;
        }, {
            retries: 50,
            onRetry: function (error: Error, count: number): void {
                Logger.instanse.warn("retry " + count + " error " + error.message + " getting " + url);
            }
        });
        return metadata;
    }
    public static parseArray(s: string): string[] {
        var arr = s.split(",");
        arr = arr.map(p => p.trim());
        arr = arr.filter(result => (result.trim() !== ""));
        return arr;
    }
    public static parseBoolean(s: any): boolean {
        var val: string = "false";
        if (typeof s === "number") {
            val = s.toString();
        } else if (typeof s === "string") {
            val = s.toLowerCase().trim();
        } else if (typeof s === "boolean") {
            val = s.toString();
        } else {
            throw new Error("Unknown type!");
        }
        switch (val) {
            case "true": case "yes": case "1": return true;
            case "false": case "no": case "0": case null: return false;
            default: return Boolean(s);
        }
    }

}
