import * as https from "https";
import * as retry from "async-retry";
import * as fs from "fs";
import * as path from "path";
import { fetch, toPassportConfig } from "passport-saml-metadata";
import { NoderedUtil } from "openflow-api";
export class Config {
    public static getversion(): string {
        var versionfile: string = path.join(__dirname, "VERSION");
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "VERSION")
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "..", "VERSION")
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "..", "..", "VERSION")
        Config.version = (fs.existsSync(versionfile) ? fs.readFileSync(versionfile, "utf8") : "0.0.1");
        return Config.version;
    }
    public static reload(): void {
        Config.getversion();
        Config.logpath = Config.getEnv("logpath", __dirname);

        Config.nodered_id = Config.getEnv("nodered_id", "1");
        Config.nodered_sa = Config.getEnv("nodered_sa", "");

        Config.NODE_ENV = Config.getEnv("NODE_ENV", "development");

        Config.saml_federation_metadata = Config.getEnv("saml_federation_metadata", "");
        Config.saml_issuer = Config.getEnv("saml_issuer", "");
        Config.saml_entrypoint = Config.getEnv("saml_entrypoint", "");
        Config.saml_baseurl = Config.getEnv("saml_baseurl", "");
        Config.saml_crt = Config.getEnv("saml_crt", "");

        Config.port = parseInt(Config.getEnv("port", "1880"));
        Config.nodered_port = parseInt(Config.getEnv("nodered_port", "0"));
        Config.domain = Config.getEnv("domain", "localhost");
        Config.protocol = Config.getEnv("protocol", "http");
        Config.nodered_domain_schema = Config.getEnv("nodered_domain_schema", "");
        Config.noderedusers = Config.getEnv("noderedusers", "");
        Config.noderedadmins = Config.getEnv("noderedadmins", "");

        Config.flow_refresh_interval = parseInt(Config.getEnv("flow_refresh_interval", "60000"));
        Config.flow_refresh_initial_interval = parseInt(Config.getEnv("flow_refresh_initial_interval", "60000"));

        Config.api_ws_url = Config.getEnv("api_ws_url", "ws://localhost:3000");
        Config.amqp_url = Config.getEnv("amqp_url", "amqp://localhost");
        Config.amqp_reply_expiration = parseInt(Config.getEnv("amqp_reply_expiration", (60 * 1000).toString())); // 1 min
        Config.amqp_workflow_out_expiration = parseInt(Config.getEnv("amqp_workflow_out_expiration", (60 * 1000).toString())); // 1 min
        Config.amqp_reply_expiration = parseInt(Config.getEnv("amqp_reply_expiration", "10000")); // 10 seconds
        Config.amqp_workflow_out_expiration = parseInt(Config.getEnv("amqp_workflow_out_expiration", "10000")); // 10 seconds

        Config.api_credential_cache_seconds = parseInt(Config.getEnv("api_credential_cache_seconds", "300"));
        Config.api_allow_anonymous = Config.parseBoolean(Config.getEnv("api_allow_anonymous", "false"));

        Config.jwt = Config.getEnv("jwt", "");

        Config.aes_secret = Config.getEnv("aes_secret", "");
        Config.tls_crt = Config.getEnv("tls_crt", "");
        Config.tls_key = Config.getEnv("tls_key", "");
        Config.tls_ca = Config.getEnv("tls_ca", "");
        Config.tls_passphrase = Config.getEnv("tls_passphrase", "");

        Config.amqp_message_ttl = parseInt(Config.getEnv("amqp_message_ttl", "20000"));
    }
    public static version: string = Config.getversion();
    public static logpath: string = Config.getEnv("logpath", __dirname);
    public static nodered_id: string = Config.getEnv("nodered_id", "1");
    public static nodered_sa: string = Config.getEnv("nodered_sa", "");

    public static NODE_ENV: string = Config.getEnv("NODE_ENV", "development");

    public static saml_federation_metadata: string = Config.getEnv("saml_federation_metadata", "");
    public static saml_issuer: string = Config.getEnv("saml_issuer", "");
    public static saml_entrypoint: string = Config.getEnv("saml_entrypoint", "");
    public static saml_baseurl: string = Config.getEnv("saml_baseurl", "");
    public static saml_crt: string = Config.getEnv("saml_crt", "");

    public static port: number = parseInt(Config.getEnv("port", "1880"));
    public static nodered_port: number = parseInt(Config.getEnv("nodered_port", "0"));
    public static domain: string = Config.getEnv("domain", "localhost");
    public static protocol: string = Config.getEnv("protocol", "http");
    public static nodered_domain_schema: string = Config.getEnv("nodered_domain_schema", "");
    public static noderedusers: string = Config.getEnv("noderedusers", "");
    public static noderedadmins: string = Config.getEnv("noderedadmins", "");

    public static flow_refresh_interval: number = parseInt(Config.getEnv("flow_refresh_interval", "60000"));
    public static flow_refresh_initial_interval: number = parseInt(Config.getEnv("flow_refresh_initial_interval", "60000"));

    public static api_ws_url: string = Config.getEnv("api_ws_url", "ws://localhost:3000");
    public static amqp_url: string = Config.getEnv("amqp_url", "amqp://localhost");
    // public static amqp_reply_expiration: number = parseInt(Config.getEnv("amqp_reply_expiration", (60 * 1000).toString())); // 1 min
    // public static amqp_workflow_out_expiration: number = parseInt(Config.getEnv("amqp_workflow_out_expiration", (60 * 1000).toString())); // 1 min
    public static amqp_reply_expiration: number = parseInt(Config.getEnv("amqp_reply_expiration", "10000")); // 10 seconds
    public static amqp_workflow_out_expiration: number = parseInt(Config.getEnv("amqp_workflow_out_expiration", "10000")); // 10 seconds

    public static api_credential_cache_seconds: number = parseInt(Config.getEnv("api_credential_cache_seconds", "300"));
    public static api_allow_anonymous: boolean = Config.parseBoolean(Config.getEnv("api_allow_anonymous", "false"));

    public static jwt: string = Config.getEnv("jwt", "");

    public static aes_secret: string = Config.getEnv("aes_secret", "");
    public static tls_crt: string = Config.getEnv("tls_crt", "");
    public static tls_key: string = Config.getEnv("tls_key", "");
    public static tls_ca: string = Config.getEnv("tls_ca", "");
    public static tls_passphrase: string = Config.getEnv("tls_passphrase", "");

    // Environment variables to set a prefix for RabbitMQs Dead Letter Exchange, Dead Letter Routing Key,
    // Dead Letter Queue, and Message Time to Live - to enable timeouts for RabbitMQ messages
    // These values must be the same for OpenFlowNodeRED and OpenFlow, or will cause errors when asserting queues
    // public static amqp_dlx_prefix: string = Config.getEnv("amqp_dlx_prefix", "DLX.");
    // public static amqp_dlrk_prefix: string = Config.getEnv("amqp_dlrk_prefix", "dlx.");
    // public static amqp_dlq_prefix: string = Config.getEnv("amqp_dlq_prefix", "dlq.");
    public static amqp_message_ttl: number = parseInt(Config.getEnv("amqp_message_ttl", "20000"));


    public static baseurl(): string {
        if (NoderedUtil.IsNullEmpty(Config.domain)) {
            if (Config.nodered_sa === null || Config.nodered_sa === undefined || Config.nodered_sa === "") {
                var matches = Config.nodered_id.match(/\d+/);
                if (matches !== null && matches !== undefined) {
                    if (matches.length > 0) {
                        Config.nodered_id = matches[matches.length - 1]; // Just grab the last number
                    }
                }
                if (Config.nodered_domain_schema != "") {
                    Config.domain = Config.nodered_domain_schema.replace("$nodered_id$", Config.nodered_id)
                }
            } else {
                if (Config.nodered_domain_schema != "") {
                    Config.domain = Config.nodered_domain_schema.replace("$nodered_id$", Config.nodered_id)
                }
            }
        }
        // if (Config.tls_crt != '' && Config.tls_key != '') {
        //     return "https://" + Config.domain + ":" + Config.port + "/";
        // }
        // return "http://" + Config.domain + ":" + Config.port + "/";
        var result: string = "";
        if (Config.tls_crt != '' && Config.tls_key != '') {
            result = "https://" + Config.domain;
        } else {
            result = Config.protocol + "://" + Config.domain;
        }
        var port: number = Config.port;
        if (Config.nodered_port > 0) {
            port = Config.nodered_port;
        }
        if (port != 80 && port != 443) {
            result = result + ":" + port + "/";
        } else { result = result + "/"; }
        return result;
    }

    public static getEnv(name: string, defaultvalue: string): string {
        var value: any = process.env[name];
        if (!value || value === "") { value = defaultvalue; }
        return value;
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

    public static async parse_federation_metadata(url: string): Promise<any> {
        try {
            if (Config.tls_ca !== "") {
                var tls_ca: string = Buffer.from(Config.tls_ca, 'base64').toString('ascii')
                var rootCas = require('ssl-root-cas/latest').create();
                rootCas.push(tls_ca);
                // rootCas.addFile( tls_ca );
                https.globalAgent.options.ca = rootCas;
                require('https').globalAgent.options.ca = rootCas;
            }
        } catch (error) {
            console.error(error);
        }

        // if anything throws, we retry
        var metadata: any = await retry(async bail => {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
            var reader: any = await fetch({ url });
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
            if (reader === null || reader === undefined) { bail(new Error("Failed getting result")); return; }
            var config: any = toPassportConfig(reader);
            // we need this, for Office 365 :-/
            if (reader.signingCerts && reader.signingCerts.length > 1) {
                config.cert = reader.signingCerts;
            }
            return config;
        }, {
            retries: 50,
            onRetry: function (error: Error, count: number): void {
                console.log("retry " + count + " error " + error.message + " getting " + url);
            }
        });
        return metadata;
    }

}
