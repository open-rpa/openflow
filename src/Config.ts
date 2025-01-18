import { Span } from "@opentelemetry/api";
import { config } from "dotenv";
import fs from "fs";
import http from "http";
import https from "https";
import os from "os";
import path, { dirname } from "path";
import querystring from "querystring";
import { fileURLToPath } from "url";
import xml2js from "xml2js";
import { Crypt } from "./Crypt.js";
import { DatabaseConnection } from "./DatabaseConnection.js";
import { Logger, promiseRetry } from "./Logger.js";
import { Util, Wellknown } from "./Util.js";
import { Base, Rights } from "./commoninterfaces.js";
const env = path.join(process.cwd(), "config", ".env");
if (fs.existsSync(env)) {
    console.log("Loading env file: " + env);
    config({ path: env });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class dbConfig extends Base {
    constructor() {
        super();
        this._type = "config";
        this.name = "Base configuration";
        this.version = "0.0.1";
        this._encrypt = ["mongodb_url", "amqp_url", "stripe_api_secret", "smtp_url", "amqp_password", "cache_store_redis_password", "cookie_secret", "singing_key", "wapid_key"];
    }
    public version: string;
    public needsupdate: boolean;
    public updatedat: Date;



    public async Save(jwt: string, parent: Span): Promise<void> {
        if (this.needsupdate = true) {
            this.updatedat = new Date(new Date().toISOString());
            this.needsupdate = false;
            this.version = Config.version;
        }
        Base.addRight(this, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
        if (Util.IsNullEmpty(this._id)) {
            const result = await Config.db.InsertOne(this, "config", 1, true, jwt, parent);
            this._id = result._id;
        }
        if (!Util.IsNullEmpty(this._id)) {
            await Config.db.UpdateOne(this, "config", 1, true, jwt, parent);
        }
    }
    public compare(version: string): number {
        if (this.version == null) return -1;
        return this.version.localeCompare(version, undefined, { numeric: true, sensitivity: "base" });
    }
    public static areEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        try {
            var _a = JSON.stringify(a);
            var _b = JSON.stringify(b);
        } catch (error) {
            console.error("areEqual failed to stringify")
            return false;
        }
        if (_a !== _b) return false;
        return true;
    }
    public static cleanAndApply(conf: dbConfig, parent: Span): Boolean {
        if (Config.disable_db_config) return false;
        var updated = false;
        // add settings et via env variables that is not the default value
        var keys = Object.keys(Config);
        for (var i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key == "_version") continue;
            if (key.startsWith("_")) continue;
            if (key == "disable_db_config") continue;

            if (["db", "api_ws_url", "mongodb_url", "mongodb_db", "domain", "name", "version", "needsupdate", "updatedat"].indexOf(key) > -1) continue;
            if (["license_key", "otel_trace_url", "cache_store_type", "cache_store_redis_host", "cache_store_max", "workitem_queue_monitoring_interval",
                "NODE_ENV", "validate_emails", "amqp_url", "port", "saml_issuer", "saml_federation_metadata",
                "enable_openapi", "ping_clients_interval", "tls_crt", "tls_key", "tls_ca",
                "otel_metric_url", "otel_trace_url", "multi_tenant", "auto_hourly_housekeeping", "housekeeping_skip_calculate_size", "housekeeping_skip_update_user_size",
                "enable_openflow_amqp"].indexOf(key) > -1) {

                if (os.hostname().toLowerCase() == "nixos") {
                    continue;
                }
            }

            if (Object.prototype.hasOwnProperty.call(Config.default_config, key) &&
                !Object.prototype.hasOwnProperty.call(conf, key)
            ) {
                let _default: any = Config.default_config[key]; // envorinment variable 
                if (_default == null) _default = "";
                let _env: any = process.env[key]; // db value
                if (_env == null || _env == "") {
                    Config[key] = _default; // reset to original
                    continue;
                }
                _env = Config.parse(key, _env);
                if (key == "HTTP_PROXY") {
                    var b = true;
                }
                if (!dbConfig.areEqual(_env, _default)) {
                    updated = true;
                    conf[key] = Config[key];
                }
            }

        }

        // Update Config with db values
        var keys = Object.keys(conf);
        for (var i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key == "_version") continue;
            if (key == "disable_db_config") continue;
            let value = conf[key];
            try {
                if (key.startsWith("_")) continue;
                if (["db", "api_ws_url", "mongodb_url", "mongodb_db", "domain", "name", "version", "needsupdate", "updatedat"].indexOf(key) > -1) continue;

                if (["license_key", "otel_trace_url", "cache_store_type", "cache_store_redis_host", "cache_store_max", "workitem_queue_monitoring_interval",
                    "NODE_ENV", "validate_emails", "amqp_url", "port", "saml_issuer", "saml_federation_metadata",
                    "enable_openapi", "ping_clients_interval", "tls_crt", "tls_key", "tls_ca",
                    "otel_metric_url", "otel_trace_url", "multi_tenant", "auto_hourly_housekeeping", "housekeeping_skip_calculate_size", "housekeeping_skip_update_user_size",
                    "enable_openflow_amqp"].indexOf(key) > -1) {
                    if (os.hostname().toLowerCase() == "nixos") {
                        continue;
                    }
                }
                if (Object.prototype.hasOwnProperty.call(Config, key)) {
                    let _default: any = Config.default_config[key]; // envorinment variable 
                    if (typeof Config[key] === "boolean") {
                        value = Config.parseBoolean(value);
                    } else if (typeof Config[key] === "number") {
                        value = parseInt(value);
                    } else if (Array.isArray(Config[key])) {
                        value = Config.parseArray(value);
                    } else if (typeof Config[key] === "string") {
                        value = value;
                    } else {
                        continue;
                    }
                    Config[key] = value;

                    if (_default == null) _default = "";
                    let _env: any = process.env[key]; // db value
                    if (_env != null && _env != "") {
                        if (typeof Config[key] === "boolean") {
                            _env = Config.parseBoolean(_env);
                        } else if (typeof Config[key] === "number") {
                            _env = parseInt(_env);
                        } else if (Array.isArray(Config[key])) {
                            _env = Config.parseArray(_env);
                        } else if (typeof Config[key] === "string") {
                            _env = _env;
                        } else {
                            continue;
                        }
                        if (_env != _default) {
                        } else if (dbConfig.areEqual(_env, value)) {
                            updated = true;
                            delete conf[key];
                        }
                    } else {
                        if (dbConfig.areEqual(_default, value)) {
                            updated = true;
                            delete conf[key];
                        }
                    }
                }
            } catch (error) {
                Logger.instanse.error("Error setting config " + keys + " to " + value, null, {cls: "Config", func: "cleanAndApply"});
            }
        }
        conf._encrypt = ["mongodb_url", "amqp_url", "stripe_api_secret", "smtp_url", "amqp_password", "cache_store_redis_password", "cookie_secret", "singing_key", "wapid_key"];
        if (Config._version != conf._version) {
            Config._version = conf._version;
            Logger.instanse.info("Loaded config version " + conf._version, parent, {cls: "Config", func: "cleanAndApply"});
        }

        return updated;
    }
    public static async Load(jwt: string, watch: boolean, parent: Span): Promise<dbConfig> {
        var conf: dbConfig = await Config.db.GetOne({ query: { "_type": "config" }, collectionname: "config", jwt, decrypt: true }, parent);
        // @ts-ignore
        if (conf == null) { conf = new dbConfig(); } else {
            if (Config._version == conf._version) {
                conf = Object.assign(new dbConfig(), conf);
                return conf;
            }
        }
        conf = Object.assign(new dbConfig(), conf);
        conf.needsupdate = false;
        if (conf.compare(Config.version) == -1) {
            conf.needsupdate = true;
        }

        let updated = dbConfig.cleanAndApply(conf, parent);
        if (updated) {
            await conf.Save(jwt, parent);
        }
        await Logger.reload();
        return conf;
    }
    public static async Reload(jwt: string, watch: boolean, parent: Span): Promise<void> {
        Config.dbConfig = await dbConfig.Load(jwt, watch, parent);
    }
}
export class Config {
    public static dbConfig: dbConfig;
    public static default_config: dbConfig = {
        enable_openapi: true,
        enable_grafanaapi: true,

        llmchat_queue: "",
        log_with_colors: true,
        cache_store_type: "memory",
        cache_store_max: 1000,
        cache_store_ttl_seconds: 300,
        cache_store_redis_host: "",
        cache_store_redis_port: 6379,
        cache_workitem_queues: false,

        log_cache: false,
        log_amqp: false,
        log_openapi: false,
        log_login_provider: false,
        log_with_trace: false,
        log_websocket: false,
        log_oauth: false,
        log_webserver: false,
        log_database: false,
        log_database_queries: false,
        log_database_queries_to_collection: "",
        log_database_queries_ms: 0,
        log_grafana: false,
        log_git: false,
        log_housekeeping: false,
        log_otel: false,
        log_blocked_ips: true,
        log_information: true,
        log_debug: false,
        log_verbose: false,
        log_silly: false,
        log_to_exchange: false,
        log_all_watches: false,

        tls_crt: "",
        tls_key: "",
        tls_ca: "",
        tls_passphrase: "",

        heapdump_onstop: false,
        amqp_allow_replyto_empty_queuename: false,
        enable_openflow_amqp: false,
        openflow_amqp_expiration: 60 * 1000 * 25, // 25 min
        amqp_prefetch: 25,
        enable_entity_restriction: false,
        enable_web_tours: true,
        enable_nodered_tours: true,
        grafana_url: "",
        auto_hourly_housekeeping: true,
        housekeeping_skip_calculate_size: false,
        housekeeping_skip_update_user_size: false,
        housekeeping_skip_collections: "",
        housekeeping_remove_unvalidated_user_days: 0, // if above 0, remove unvalidated users after x days
        housekeeping_cleanup_openrpa_instances: false,
        workitem_queue_monitoring_enabled: true,
        workitem_queue_monitoring_interval: 10 * 1000, // 10 sec
        upload_max_filesize_mb: 25,
        getting_started_url: "",
        NODE_ENV: "development",
        agent_HTTP_PROXY: "",
        agent_HTTPS_PROXY: "",
        agent_NO_PROXY: "",
        agent_NPM_REGISTRY: "",
        agent_NPM_TOKEN: "",

        stripe_api_key: "",
        stripe_api_secret: "",
        stripe_force_vat: false,
        stripe_force_checkout: false,
        stripe_allow_promotion_codes: true,

        ensure_indexes: true,
        text_index_name_fields: ["name", "_names"],
        auto_create_users: false,
        auto_create_user_from_jwt: false,
        allow_signin_with_expired_jwt: false,
        auto_create_domains: [],
        persist_user_impersonation: false,
        ping_clients_interval: 10000, // 10 seconds

        use_ingress_beta1_syntax: false,
        use_openshift_routes: false,
        agent_image_pull_secrets: [],
        auto_create_personal_nodered_group: false,
        auto_create_personal_noderedapi_group: false,
        force_add_admins: true,

        validate_emails: false,
        forgot_pass_emails: false,
        smtp_service: "",
        smtp_from: "",
        smtp_user: "",
        smtp_pass: "",
        smtp_url: "",
        debounce_lookup: false,
        validate_emails_disposable: false,

        oidc_access_token_ttl: 480, // 8 hours
        oidc_authorization_code_ttl: 480, // 8 hours
        oidc_client_credentials_ttl: 480, // 8 hours
        oidc_refresh_token_ttl: 20160, // 14 days in seconds
        oidc_session_ttl: 20160, // 14 days in seconds
        oidc_max_roles: 25,

        oidc_cookie_key: "Y6SPiXCxDhAJbN7cbydMw5eX1wIrdy8PiWApqEcguss=",
        api_rate_limit: true,
        api_rate_limit_points: 20,
        api_rate_limit_duration: 1,
        socket_rate_limit: true,
        socket_rate_limit_points: 30,
        socket_rate_limit_points_disconnect: 100,
        socket_rate_limit_duration: 1,
        socket_error_rate_limit_points: 30,
        socket_error_rate_limit_duration: 1,

        client_heartbeat_timeout: 60,
        client_signin_timeout: 120,
        client_disconnect_signin_error: false,

        expected_max_roles: 20000,
        decorate_roles_fetching_all_roles: true,
        max_recursive_group_depth: 2,
        update_acl_based_on_groups: true,
        allow_merge_acl: false,

        multi_tenant: false,
        workspace_enabled: false,
        enable_guest: false,
        enable_guest_file_upload: false,
        enable_gitserver: false,
        enable_gitserver_guest: false,
        enable_gitserver_guest_create: false,
        cleanup_on_delete_customer: false,
        cleanup_on_delete_user: false,
        api_bypass_perm_check: false,
        disable_db_config: false,
        force_audit_ts: false,
        force_dbusage_ts: false,
        migrate_audit_to_ts: true,

        websocket_package_size: 25000,
        websocket_max_package_count: 1048576,
        websocket_message_callback_timeout: 3600,
        websocket_disconnect_out_of_sync: false,
        protocol: "http",
        port: 3000,
        domain: "localhost.openiap.io",
        cookie_secret: "NLgUIsozJaxO38ze0WuHthfj2eb1eIEu",
        max_ace_count: 128,

        amqp_reply_expiration: 60 * 1000, // 1 min
        amqp_force_queue_prefix: false,
        amqp_force_exchange_prefix: false,
        amqp_force_sender_has_read: true,
        amqp_force_sender_has_invoke: false,
        amqp_force_consumer_has_update: false,
        amqp_enabled_exchange: false,
        amqp_url: "amqp://localhost",
        amqp_username: "guest",
        amqp_password: "guest",

        amqp_check_for_consumer: true,
        amqp_check_for_consumer_count: false,
        amqp_default_expiration: 60 * 1000, // 1 min
        amqp_requeue_time: 1000, // 1 seconds
        amqp_dlx: "openflow-dlx", // Dead letter exchange, used to pickup dead or timeout messages

        mongodb_url: "mongodb://127.0.0.1:27017",
        mongodb_db: "openflow",
        mongodb_minpoolsize: 25,
        mongodb_maxpoolsize: 25,

        skip_history_collections: "audit,oauthtokens,openrpa_instances,workflow_instances,workitems,mailhist",
        history_delta_count: 1000,
        history_obj_max_kb_size: 10240,
        allow_skiphistory: false,
        max_memory_restart_mb: 0,
        max_memory_query_mb: 0,
        max_memory_aggregate_mb: 0,

        saml_issuer: "the-issuer",
        // aes_secret: "",
        signing_crt: "",
        singing_key: "",
        wapid_mail: "",
        wapid_pub: "",
        wapid_key: "",
        shorttoken_expires_in: "5m",
        longtoken_expires_in: "365d",
        downloadtoken_expires_in: "15m",
        personalnoderedtoken_expires_in: "365d",

        agent_images: [{ "name": "Agent", "image": "openiap/nodeagent", "languages": ["nodejs", "exec", "python"] }, { "name": "Agent+Chromium", "image": "openiap/nodechromiumagent", "chromium": true, "languages": ["nodejs", "exec", "python"] }, { "name": "NodeRED", "image": "openiap/noderedagent", "port": 3000 }, { "name": "DotNet 6", "image": "openiap/dotnetagent", "languages": ["nodejs", "exec", "python", "dotnet", "powershell"] }],
        agent_domain_schema: "",
        agent_node_selector: "",
        agent_apiurl: "",
        agent_grpc_apihost: "",
        agent_ws_apihost: "",
        agent_oidc_config: "",
        agent_oidc_client_id: "",
        agent_oidc_client_secret: "",
        agent_oidc_userinfo_endpoint: "",
        agent_oidc_issuer: "",

        saml_federation_metadata: "",
        api_ws_url: "",
        agent_docker_entrypoints: "web",
        agent_docker_use_project: false,
        agent_docker_certresolver: "",
        namespace: "",
        agent_allow_nodeselector: false,
        otel_measure_nodeid: false,
        otel_measure_queued_messages: false,
        otel_measure__mongodb_watch: false,
        enable_analytics: true,
        enable_detailed_analytic: false,
        otel_debug_log: false,
        otel_warn_log: false,
        otel_err_log: false,
        otel_trace_url: "",
        otel_metric_url: "",
        otel_log_url: "",

        otel_trace_interval: 5000,
        otel_metric_interval: 5000,

        otel_trace_pingclients: false,
        otel_trace_dashboardauth: false,
        otel_trace_include_query: false,
        otel_trace_connection_ips: false,
        otel_trace_mongodb_per_users: false,
        otel_trace_mongodb_query_per_users: false,
        otel_trace_mongodb_count_per_users: false,
        otel_trace_mongodb_aggregate_per_users: false,
        otel_trace_mongodb_insert_per_users: false,
        otel_trace_mongodb_update_per_users: false,
        otel_trace_mongodb_delete_per_users: false,

        grpc_keepalive_time_ms: -1,
        grpc_keepalive_timeout_ms: -1,
        grpc_http2_min_ping_interval_without_data_ms: -1,
        grpc_max_connection_idle_ms: -1,
        grpc_max_connection_age_ms: -1,
        grpc_max_connection_age_grace_ms: -1,
        grpc_http2_max_pings_without_data: -1,
        grpc_keepalive_permit_without_calls: -1,
        grpc_max_receive_message_length: -1,
        grpc_max_send_message_length: -1,

        validate_user_form: "",
    } as any;
    public static getversion(): string {
        let packagefile: string = path.join(__dirname, "package.json");
        if (!fs.existsSync(packagefile)) packagefile = path.join(__dirname, "..", "package.json")
        if (!fs.existsSync(packagefile)) packagefile = path.join(__dirname, "..", "..", "package.json")
        if (!fs.existsSync(packagefile)) packagefile = path.join(__dirname, "..", "..", "..", "package.json")

        let version = "0.0.1"
        if (fs.existsSync(packagefile)) {
            let packagejson = JSON.parse(fs.readFileSync(packagefile, "utf8"));
            version = packagejson.version;
        }
        Config.version = version;
        return Config.version;
    }
    public static disablelogging(): void {
        Config.log_cache = false;
        Config.log_amqp = false;
        Config.log_openapi = false;

        Config.log_login_provider = false;
        Config.log_websocket = false;
        Config.log_oauth = false;
        Config.unittesting = true;
    }
    public static async Load(span: Span) {
        Config.aes_secret = Config.getEnv("aes_secret");
        Config.mongodb_url = Config.getEnv("mongodb_url");
        const jwt: string = Crypt.rootToken();
        Config.dbConfig = await dbConfig.Load(jwt, false, span);
    }
    public static _version: number = -1;
    public static unittesting: boolean = false;
    public static db: DatabaseConnection = null;
    public static license_key: string = Config.getEnv("license_key");
    public static enable_openapi: boolean = Config.parseBoolean(Config.getEnv("enable_openapi"));
    public static enable_grafanaapi: boolean = Config.parseBoolean(Config.getEnv("enable_grafanaapi"));

    public static llmchat_queue: string = Config.getEnv("llmchat_queue");
    public static version: string = Config.getversion();
    public static log_with_colors: boolean = Config.parseBoolean(Config.getEnv("log_with_colors"));

    public static cache_store_type: string = Config.getEnv("cache_store_type");
    public static cache_store_max: number = parseInt(Config.getEnv("cache_store_max"));
    public static cache_store_ttl_seconds: number = parseInt(Config.getEnv("cache_store_ttl_seconds"));
    public static cache_store_redis_host: string = Config.getEnv("cache_store_redis_host");
    public static cache_store_redis_port: number = parseInt(Config.getEnv("cache_store_redis_port"));
    public static cache_store_redis_password: string = Config.getEnv("cache_store_redis_password");
    public static cache_workitem_queues: boolean = Config.parseBoolean(Config.getEnv("cache_workitem_queues"));

    public static log_cache: boolean = Config.parseBoolean(Config.getEnv("log_cache"));
    public static log_amqp: boolean = Config.parseBoolean(Config.getEnv("log_amqp"));
    public static log_openapi: boolean = Config.parseBoolean(Config.getEnv("log_openapi"));
    public static log_login_provider: boolean = Config.parseBoolean(Config.getEnv("log_login_provider"));
    public static log_with_trace: boolean = Config.parseBoolean(Config.getEnv("log_with_trace"));
    public static log_websocket: boolean = Config.parseBoolean(Config.getEnv("log_websocket"));
    public static log_oauth: boolean = Config.parseBoolean(Config.getEnv("log_oauth"));
    public static log_webserver: boolean = Config.parseBoolean(Config.getEnv("log_webserver"));
    public static log_database: boolean = Config.parseBoolean(Config.getEnv("log_database"));
    public static log_database_queries: boolean = Config.parseBoolean(Config.getEnv("log_database_queries"));
    public static log_database_queries_to_collection: string = Config.getEnv("log_database_queries_to_collection");
    public static log_database_queries_ms: number = parseInt(Config.getEnv("log_database_queries_ms"));

    public static log_grafana: boolean = Config.parseBoolean(Config.getEnv("log_grafana"));
    public static log_git: boolean = Config.parseBoolean(Config.getEnv("log_git"));
    public static log_housekeeping: boolean = Config.parseBoolean(Config.getEnv("log_housekeeping"));
    public static log_otel: boolean = Config.parseBoolean(Config.getEnv("log_otel"));
    public static log_blocked_ips: boolean = Config.parseBoolean(Config.getEnv("log_blocked_ips"));
    public static log_information: boolean = Config.parseBoolean(Config.getEnv("log_information"));
    public static log_debug: boolean = Config.parseBoolean(Config.getEnv("log_debug"));
    public static log_verbose: boolean = Config.parseBoolean(Config.getEnv("log_verbose"));
    public static log_silly: boolean = Config.parseBoolean(Config.getEnv("log_silly"));
    public static log_to_exchange: boolean = Config.parseBoolean(Config.getEnv("log_to_exchange"));
    public static log_all_watches: boolean = Config.parseBoolean(Config.getEnv("log_all_watches"));


    public static heapdump_onstop: boolean = Config.parseBoolean(Config.getEnv("heapdump_onstop"));

    public static amqp_allow_replyto_empty_queuename: boolean = Config.parseBoolean(Config.getEnv("amqp_allow_replyto_empty_queuename"));

    public static openflow_uniqueid: string = Config.getEnv("openflow_uniqueid");
    public static enable_openflow_amqp: boolean = Config.parseBoolean(Config.getEnv("enable_openflow_amqp"));
    public static openflow_amqp_expiration: number = parseInt(Config.getEnv("openflow_amqp_expiration"));
    public static amqp_prefetch: number = parseInt(Config.getEnv("amqp_prefetch"));
    public static enable_entity_restriction: boolean = Config.parseBoolean(Config.getEnv("enable_entity_restriction"));
    public static enable_web_tours: boolean = Config.parseBoolean(Config.getEnv("enable_web_tours"));
    public static enable_nodered_tours: boolean = Config.parseBoolean(Config.getEnv("enable_nodered_tours"));
    public static grafana_url: string = Config.getEnv("grafana_url");
    public static auto_hourly_housekeeping: boolean = Config.parseBoolean(Config.getEnv("auto_hourly_housekeeping"));
    public static housekeeping_skip_calculate_size: boolean = Config.parseBoolean(Config.getEnv("housekeeping_skip_calculate_size"));
    public static housekeeping_skip_update_user_size: boolean = Config.parseBoolean(Config.getEnv("housekeeping_skip_update_user_size"));

    public static housekeeping_skip_collections: string = Config.getEnv("housekeeping_skip_collections");
    public static housekeeping_remove_unvalidated_user_days: number = parseInt(Config.getEnv("housekeeping_remove_unvalidated_user_days"));
    public static housekeeping_cleanup_openrpa_instances: boolean = Config.parseBoolean(Config.getEnv("housekeeping_cleanup_openrpa_instances"));
    public static workitem_queue_monitoring_enabled: boolean = Config.parseBoolean(Config.getEnv("workitem_queue_monitoring_enabled"));
    public static workitem_queue_monitoring_interval: number = parseInt(Config.getEnv("workitem_queue_monitoring_interval"));

    public static upload_max_filesize_mb: number = parseInt(Config.getEnv("upload_max_filesize_mb"));

    public static getting_started_url: string = Config.getEnv("getting_started_url");

    public static NODE_ENV: string = Config.getEnv("NODE_ENV");
    public static HTTP_PROXY: string = Config.getEnv("HTTP_PROXY");
    public static HTTPS_PROXY: string = Config.getEnv("HTTPS_PROXY");
    public static NO_PROXY: string = Config.getEnv("NO_PROXY");
    public static agent_HTTP_PROXY: string = Config.getEnv("agent_HTTP_PROXY");
    public static agent_HTTPS_PROXY: string = Config.getEnv("agent_HTTPS_PROXY");
    public static agent_NO_PROXY: string = Config.getEnv("agent_NO_PROXY");
    public static agent_NPM_REGISTRY: string = Config.getEnv("agent_NPM_REGISTRY");
    public static agent_NPM_TOKEN: string = Config.getEnv("agent_NPM_TOKEN");


    public static stripe_api_key: string = Config.getEnv("stripe_api_key");
    public static stripe_api_secret: string = Config.getEnv("stripe_api_secret");
    public static stripe_force_vat: boolean = Config.parseBoolean(Config.getEnv("stripe_force_vat"));
    public static stripe_force_checkout: boolean = Config.parseBoolean(Config.getEnv("stripe_force_checkout"));
    public static stripe_allow_promotion_codes: boolean = Config.parseBoolean(Config.getEnv("stripe_allow_promotion_codes"));

    public static ensure_indexes: boolean = Config.parseBoolean(Config.getEnv("ensure_indexes"));
    public static text_index_name_fields: string[] = Config.parseArray(Config.getEnv("text_index_name_fields"));

    public static auto_create_users: boolean = Config.parseBoolean(Config.getEnv("auto_create_users"));
    public static auto_create_user_from_jwt: boolean = Config.parseBoolean(Config.getEnv("auto_create_user_from_jwt"));
    public static allow_signin_with_expired_jwt: boolean = Config.parseBoolean(Config.getEnv("allow_signin_with_expired_jwt"));
    public static auto_create_domains: string[] = Config.parseArray(Config.getEnv("auto_create_domains"));
    public static persist_user_impersonation: boolean = Config.parseBoolean(Config.getEnv("persist_user_impersonation"));
    public static ping_clients_interval: number = parseInt(Config.getEnv("ping_clients_interval")); // 10 seconds

    public static use_ingress_beta1_syntax: boolean = Config.parseBoolean(Config.getEnv("use_ingress_beta1_syntax"));
    public static use_openshift_routes: boolean = Config.parseBoolean(Config.getEnv("use_openshift_routes"));
    public static agent_image_pull_secrets: string[] = Config.parseArray(Config.getEnv("agent_image_pull_secrets"));
    public static auto_create_personal_nodered_group: boolean = Config.parseBoolean(Config.getEnv("auto_create_personal_nodered_group"));
    public static auto_create_personal_noderedapi_group: boolean = Config.parseBoolean(Config.getEnv("auto_create_personal_noderedapi_group"));
    public static force_add_admins: boolean = Config.parseBoolean(Config.getEnv("force_add_admins"));
    public static validate_emails: boolean = Config.parseBoolean(Config.getEnv("validate_emails"));
    public static forgot_pass_emails: boolean = Config.parseBoolean(Config.getEnv("forgot_pass_emails"));
    public static smtp_service: string = Config.getEnv("smtp_service");
    public static smtp_from: string = Config.getEnv("smtp_from");
    public static smtp_user: string = Config.getEnv("smtp_user");
    public static smtp_pass: string = Config.getEnv("smtp_pass");
    public static smtp_url: string = Config.getEnv("smtp_url");
    public static debounce_lookup: boolean = Config.parseBoolean(Config.getEnv("debounce_lookup"));
    public static validate_emails_disposable: boolean = Config.parseBoolean(Config.getEnv("validate_emails_disposable"));

    public static tls_crt: string = Config.getEnv("tls_crt");
    public static tls_key: string = Config.getEnv("tls_key");
    public static tls_ca: string = Config.getEnv("tls_ca");
    public static tls_passphrase: string = Config.getEnv("tls_passphrase");

    public static oidc_access_token_ttl: number = parseInt(Config.getEnv("oidc_access_token_ttl"));
    public static oidc_authorization_code_ttl: number = parseInt(Config.getEnv("oidc_authorization_code_ttl"));
    public static oidc_client_credentials_ttl: number = parseInt(Config.getEnv("oidc_client_credentials_ttl"));
    public static oidc_refresh_token_ttl: number = parseInt(Config.getEnv("oidc_refresh_token_ttl"));
    public static oidc_session_ttl: number = parseInt(Config.getEnv("oidc_session_ttl"));
    public static oidc_max_roles: number = parseInt(Config.getEnv("oidc_max_roles"));
    public static oidc_cookie_key: string = Config.getEnv("oidc_cookie_key");

    public static api_rate_limit: boolean = Config.parseBoolean(Config.getEnv("api_rate_limit"));
    public static api_rate_limit_points: number = parseInt(Config.getEnv("api_rate_limit_points"));
    public static api_rate_limit_duration: number = parseInt(Config.getEnv("api_rate_limit_duration"));
    public static socket_rate_limit: boolean = Config.parseBoolean(Config.getEnv("socket_rate_limit"));
    public static socket_rate_limit_points: number = parseInt(Config.getEnv("socket_rate_limit_points"));
    public static socket_rate_limit_points_disconnect: number = parseInt(Config.getEnv("socket_rate_limit_points_disconnect"));
    public static socket_rate_limit_duration: number = parseInt(Config.getEnv("socket_rate_limit_duration"));
    public static socket_error_rate_limit_points: number = parseInt(Config.getEnv("socket_error_rate_limit_points"));
    public static socket_error_rate_limit_duration: number = parseInt(Config.getEnv("socket_error_rate_limit_duration"));

    public static client_heartbeat_timeout: number = parseInt(Config.getEnv("client_heartbeat_timeout"));
    public static client_signin_timeout: number = parseInt(Config.getEnv("client_signin_timeout"));
    public static client_disconnect_signin_error: boolean = Config.parseBoolean(Config.getEnv("client_disconnect_signin_error"));

    public static expected_max_roles: number = parseInt(Config.getEnv("expected_max_roles"));
    public static decorate_roles_fetching_all_roles = Config.parseBoolean(Config.getEnv("decorate_roles_fetching_all_roles"));
    public static max_recursive_group_depth: number = parseInt(Config.getEnv("max_recursive_group_depth"));
    public static update_acl_based_on_groups: boolean = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups"));
    public static allow_merge_acl: boolean = Config.parseBoolean(Config.getEnv("allow_merge_acl"));

    public static multi_tenant: boolean = Config.parseBoolean(Config.getEnv("multi_tenant"));
    public static workspace_enabled: boolean = Config.parseBoolean(Config.getEnv("workspace_enabled"));
    public static enable_guest: boolean = Config.parseBoolean(Config.getEnv("enable_guest"));
    public static enable_guest_file_upload: boolean = Config.parseBoolean(Config.getEnv("enable_guest_file_upload"));
    public static enable_gitserver: boolean = Config.parseBoolean(Config.getEnv("enable_gitserver"));
    public static enable_gitserver_guest: boolean = Config.parseBoolean(Config.getEnv("enable_gitserver_guest"));
    public static enable_gitserver_guest_create: boolean = Config.parseBoolean(Config.getEnv("enable_gitserver_guest_create"));

    public static cleanup_on_delete_customer: boolean = Config.parseBoolean(Config.getEnv("cleanup_on_delete_customer"));
    public static cleanup_on_delete_user: boolean = Config.parseBoolean(Config.getEnv("cleanup_on_delete_user"));
    public static api_bypass_perm_check: boolean = Config.parseBoolean(Config.getEnv("api_bypass_perm_check"));
    public static disable_db_config: boolean = Config.parseBoolean(Config.getEnv("disable_db_config"));
    public static force_audit_ts: boolean = Config.parseBoolean(Config.getEnv("force_audit_ts"));
    public static force_dbusage_ts: boolean = Config.parseBoolean(Config.getEnv("force_dbusage_ts"));
    public static migrate_audit_to_ts: boolean = Config.parseBoolean(Config.getEnv("migrate_audit_to_ts"));

    public static websocket_package_size: number = parseInt(Config.getEnv("websocket_package_size"), 10);
    public static websocket_max_package_count: number = parseInt(Config.getEnv("websocket_max_package_count"), 10);
    public static websocket_message_callback_timeout: number = parseInt(Config.getEnv("websocket_message_callback_timeout"), 10);
    public static websocket_disconnect_out_of_sync: boolean = Config.parseBoolean(Config.getEnv("websocket_disconnect_out_of_sync"));
    public static protocol: string = Config.getEnv("protocol");
    public static port: number = parseInt(Config.getEnv("port"));
    public static domain: string = Config.getEnv("domain");
    public static cookie_secret: string = Config.getEnv("cookie_secret");
    public static max_ace_count: number = parseInt(Config.getEnv("max_ace_count"), 10);

    public static amqp_reply_expiration: number = parseInt(Config.getEnv("amqp_reply_expiration"));
    public static amqp_force_queue_prefix: boolean = Config.parseBoolean(Config.getEnv("amqp_force_queue_prefix"));
    public static amqp_force_exchange_prefix: boolean = Config.parseBoolean(Config.getEnv("amqp_force_exchange_prefix"));
    public static amqp_force_sender_has_read: boolean = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_read"));
    public static amqp_force_sender_has_invoke: boolean = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_invoke"));
    public static amqp_force_consumer_has_update: boolean = Config.parseBoolean(Config.getEnv("amqp_force_consumer_has_update"));
    public static amqp_enabled_exchange: boolean = Config.parseBoolean(Config.getEnv("amqp_enabled_exchange"));
    public static amqp_url: string = Config.getEnv("amqp_url");
    public static amqp_username: string = Config.getEnv("amqp_username");
    public static amqp_password: string = Config.getEnv("amqp_password");

    public static amqp_check_for_consumer: boolean = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer"));
    public static amqp_check_for_consumer_count: boolean = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer_count"));
    public static amqp_default_expiration: number = parseInt(Config.getEnv("amqp_default_expiration"));
    public static amqp_requeue_time: number = parseInt(Config.getEnv("amqp_requeue_time"));
    public static amqp_dlx: string = Config.getEnv("amqp_dlx");

    public static mongodb_url: string = Config.getEnv("mongodb_url");
    public static mongodb_db: string = Config.getEnv("mongodb_db");
    public static mongodb_minpoolsize: number = parseInt(Config.getEnv("mongodb_minpoolsize"));
    public static mongodb_maxpoolsize: number = parseInt(Config.getEnv("mongodb_maxpoolsize"));

    public static skip_history_collections: string = Config.getEnv("skip_history_collections");
    public static history_delta_count: number = parseInt(Config.getEnv("history_delta_count"));
    public static history_obj_max_kb_size: number = parseInt(Config.getEnv("history_obj_max_kb_size"));

    public static allow_skiphistory: boolean = Config.parseBoolean(Config.getEnv("allow_skiphistory"));
    public static max_memory_restart_mb: number = parseInt(Config.getEnv("max_memory_restart_mb"));
    public static max_memory_query_mb: number = parseInt(Config.getEnv("max_memory_query_mb"));
    public static max_memory_aggregate_mb: number = parseInt(Config.getEnv("max_memory_aggregate_mb"));

    public static saml_issuer: string = Config.getEnv("saml_issuer");
    public static aes_secret: string = Config.getEnv("aes_secret");
    public static signing_crt: string = Config.getEnv("signing_crt");
    public static singing_key: string = Config.getEnv("singing_key");
    public static wapid_mail: string = Config.getEnv("wapid_mail");
    public static wapid_pub: string = Config.getEnv("wapid_pub");
    public static wapid_key: string = Config.getEnv("wapid_key");

    public static shorttoken_expires_in: string = Config.getEnv("shorttoken_expires_in");
    public static longtoken_expires_in: string = Config.getEnv("longtoken_expires_in");
    public static downloadtoken_expires_in: string = Config.getEnv("downloadtoken_expires_in");
    public static personalnoderedtoken_expires_in: string = Config.getEnv("personalnoderedtoken_expires_in");

    public static agent_images: NoderedImage[] = Array.isArray(Config.getEnv("agent_images")) ? Config.getEnv("agent_images") : JSON.parse(Config.getEnv("agent_images"));
    public static agent_domain_schema: string = Config.getEnv("agent_domain_schema");
    public static agent_node_selector: string = Config.getEnv("agent_node_selector");

    public static agent_grpc_apihost: string = Config.getEnv("agent_grpc_apihost");
    public static agent_ws_apihost: string = Config.getEnv("agent_ws_apihost");
    public static agent_oidc_config: string = Config.getEnv("agent_oidc_config");
    public static agent_oidc_client_id: string = Config.getEnv("agent_oidc_client_id");
    public static agent_oidc_client_secret: string = Config.getEnv("agent_oidc_client_secret");
    public static agent_oidc_userinfo_endpoint: string = Config.getEnv("agent_oidc_userinfo_endpoint");
    public static agent_oidc_issuer: string = Config.getEnv("agent_oidc_issuer");
    public static agent_oidc_authorization_endpoint: string = Config.getEnv("agent_oidc_authorization_endpoint");
    public static agent_oidc_token_endpoint: string = Config.getEnv("agent_oidc_token_endpoint");

    public static saml_federation_metadata: string = Config.getEnv("saml_federation_metadata");
    public static api_ws_url: string = Config.getEnv("api_ws_url");

    public static agent_docker_entrypoints: string = Config.getEnv("agent_docker_entrypoints");
    public static agent_docker_use_project: boolean = Config.parseBoolean(Config.getEnv("agent_docker_use_project"));
    public static agent_docker_certresolver: string = Config.getEnv("agent_docker_certresolver");

    public static namespace: string = Config.getEnv("namespace");
    public static agent_allow_nodeselector: boolean = Config.parseBoolean(Config.getEnv("agent_allow_nodeselector"));

    public static otel_measure_queued_messages: boolean = Config.parseBoolean(Config.getEnv("otel_measure_queued_messages"));
    public static otel_measure__mongodb_watch: boolean = Config.parseBoolean(Config.getEnv("otel_measure__mongodb_watch"));
    public static enable_analytics: boolean = Config.parseBoolean(Config.getEnv("enable_analytics"));
    public static enable_detailed_analytic: boolean = Config.parseBoolean(Config.getEnv("enable_detailed_analytic"));
    public static otel_debug_log: boolean = Config.parseBoolean(Config.getEnv("otel_debug_log"));
    public static otel_warn_log: boolean = Config.parseBoolean(Config.getEnv("otel_warn_log"));
    public static otel_err_log: boolean = Config.parseBoolean(Config.getEnv("otel_err_log"));
    public static otel_trace_url: string = Config.getEnv("otel_trace_url");
    public static otel_log_url: string = Config.getEnv("otel_log_url");
    public static otel_metric_url: string = Config.getEnv("otel_metric_url");
    public static otel_trace_interval: number = parseInt(Config.getEnv("otel_trace_interval"));
    public static otel_metric_interval: number = parseInt(Config.getEnv("otel_metric_interval"));
    public static otel_trace_pingclients: boolean = Config.parseBoolean(Config.getEnv("otel_trace_pingclients"));
    public static otel_trace_dashboardauth: boolean = Config.parseBoolean(Config.getEnv("otel_trace_dashboardauth"));
    public static otel_trace_include_query: boolean = Config.parseBoolean(Config.getEnv("otel_trace_include_query"));
    public static otel_trace_connection_ips: boolean = Config.parseBoolean(Config.getEnv("otel_trace_connection_ips"));
    public static otel_trace_mongodb_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_per_users"));
    public static otel_trace_mongodb_query_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_query_per_users"));
    public static otel_trace_mongodb_count_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_count_per_users"));
    public static otel_trace_mongodb_aggregate_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_aggregate_per_users"));
    public static otel_trace_mongodb_insert_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_insert_per_users"));
    public static otel_trace_mongodb_update_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_update_per_users"));
    public static otel_trace_mongodb_delete_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_delete_per_users"));

    public static grpc_keepalive_time_ms: number = parseInt(Config.getEnv("grpc_keepalive_time_ms"));
    public static grpc_keepalive_timeout_ms: number = parseInt(Config.getEnv("grpc_keepalive_timeout_ms"));
    public static grpc_http2_min_ping_interval_without_data_ms: number = parseInt(Config.getEnv("grpc_http2_min_ping_interval_without_data_ms"));
    public static grpc_max_connection_idle_ms: number = parseInt(Config.getEnv("grpc_max_connection_idle_ms"));
    public static grpc_max_connection_age_ms: number = parseInt(Config.getEnv("grpc_max_connection_age_ms"));
    public static grpc_max_connection_age_grace_ms: number = parseInt(Config.getEnv("grpc_max_connection_age_grace_ms"));
    public static grpc_http2_max_pings_without_data: number = parseInt(Config.getEnv("grpc_http2_max_pings_without_data"));
    public static grpc_keepalive_permit_without_calls: number = parseInt(Config.getEnv("grpc_keepalive_permit_without_calls"));
    public static grpc_max_receive_message_length: number = parseInt(Config.getEnv("grpc_max_receive_message_length"));
    public static grpc_max_send_message_length: number = parseInt(Config.getEnv("grpc_max_send_message_length"));

    public static validate_user_form: string = Config.getEnv("validate_user_form");


    public static externalbaseurl(): string {
        let result: string = "";
        result = Config.protocol + "://" + Config.domain + "/";
        return result;
    }
    public static baseurl(): string {
        let result: string = "";
        if (Config.tls_crt != "" && Config.tls_key != "") {
            result = "https://" + Config.domain;
        } else {
            result = Config.protocol + "://" + Config.domain;
        }
        if (Config.port != 80 && Config.port != 443 && Config.port != 3000) {
            result = result + ":" + Config.port + "/";
        } else { result = result + "/"; }
        return result;
    }
    public static basewsurl(): string {
        let result: string = "";
        if (Config.tls_crt != "" && Config.tls_key != "") {
            result = "wss://" + Config.domain;
        } else if (Config.protocol == "http") {
            result = "ws://" + Config.domain;
        } else {
            result = "wss://" + Config.domain;
        }
        if (Config.port != 80 && Config.port != 443 && Config.port != 3000) {
            result = result + ":" + Config.port + "/";
        } else { result = result + "/"; }
        return result;
    }
    public static getEnv(name: string): string {
        let value: any = process.env[name];
        if (value == null || value == "") {
            value = this.default_config[name]
        }
        return value;
    }
    public static post_x_www_form_data_urlencoded(url: string, data: any, headers: string[][]): Promise<string> {
        return new Promise((resolve, reject) => {
            var provider = http;
            if (url.startsWith("https")) {
                provider = https as any;
            }
            const dataString = querystring.stringify(data);
            const options = {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": dataString.length
                }
            };
            if (headers != null) {
                headers.forEach(header => {
                    options.headers[header[0]] = header[1];
                });
            }
            const req = provider.request(url, options, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    resolve(data);
                });
            });
            req.on("error", (error) => {
                reject(error);
            });
            req.write(dataString);
            req.end();
        });
    }
    public static post(url: string, data: any, headers: string[][]): Promise<string> {
        return new Promise((resolve, reject) => {
            var provider = http;
            if (url.startsWith("https")) {
                provider = https as any;
            }
            const dataString = JSON.stringify(data);
            const options = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": dataString.length
                }
            };
            if (headers != null) {
                headers.forEach(header => {
                    options.headers[header[0]] = header[1];
                });
            }
            const req = provider.request(url, options, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    resolve(data);
                });
            });
            req.on("error", (error) => {
                reject(error);
            });
            req.write(dataString);
            req.end();
        });
    }
    public static get(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            var provider = http;
            if (url.startsWith("https")) {
                provider = https as any;
            }
            provider.get(url, (resp) => {
                let data = "";
                resp.on("data", (chunk) => {
                    data += chunk;
                });
                resp.on("end", () => {
                    resolve(data);
                });
            }).on("error", (err) => {
                reject(err);
            });
        })
    }
    public static async parse_federation_metadata(tls_ca: String, url: string): Promise<any> {
        const metadata: any = await promiseRetry(async () => {
            // if (Config.saml_ignore_cert) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
            const data: string = await Config.get(url)
            // if (Config.saml_ignore_cert) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
            if (Util.IsNullEmpty(data)) { throw new Error("Failed getting result"); }
            var xml = await xml2js.parseStringPromise(data);
            if (xml && xml.EntityDescriptor && xml.EntityDescriptor.IDPSSODescriptor && xml.EntityDescriptor.IDPSSODescriptor.length > 0) {
                var IDPSSODescriptor = xml.EntityDescriptor.IDPSSODescriptor[0];
                var identifierFormat = "urn:oasis:names:tc:SAML:2.0:attrname-format:uri";
                if (IDPSSODescriptor.NameIDFormat && IDPSSODescriptor.NameIDFormat.length > 0) {
                    identifierFormat = IDPSSODescriptor.NameIDFormat[0];
                }
                var signingCerts = [];
                IDPSSODescriptor.KeyDescriptor.forEach(key => {
                    if (key.$.use == "signing") {
                        signingCerts.push(key.KeyInfo[0].X509Data[0].X509Certificate[0]);
                    }
                });
                var identityProviderUrl = IDPSSODescriptor.SingleSignOnService[0].$.Location;
                var logoutUrl = IDPSSODescriptor.SingleLogoutService[0].$.Location;
                const config = {
                    identityProviderUrl,
                    entryPoint: identityProviderUrl,
                    logoutUrl,
                    cert: signingCerts,
                    identifierFormat
                }
                return config;
            } else {
                throw new Error("Failed parsing metadata");
            }
        }, 50, 1000);
        return metadata;
    }
    public static parse(key, value: any) {
        if (typeof Config.default_config[key] === "boolean") {
            return Config.parseBoolean(value);
        } else if (typeof Config.default_config[key] === "number") {
            return parseInt(value);
        } else if (Array.isArray(Config.default_config[key])) {
            return Config.parseArray(value);
        } else if (typeof Config.default_config[key] === "string") {
            return value;
        } else {
            return value;
        }
    }
    public static parseArray(s: string): string[] {
        if (Array.isArray(s)) return s;
        let arr = s.split(",");
        arr = arr.map(p => p.trim());
        arr = arr.filter(result => (result.trim() !== ""));
        return arr;
    }
    public static parseBoolean(s: any): boolean {
        let val: string;
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
export class NoderedImage {
    public name: string;
    public image: string;
}