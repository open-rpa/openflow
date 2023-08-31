var xml2js = require('xml2js');
import * as https from "https";
import * as http from "http";
// import { fetch, toPassportConfig } from "passport-saml-metadata";
import * as fs from "fs";
import * as path from "path";
import { DatabaseConnection } from "./DatabaseConnection";
import { Logger } from "./Logger";
import { Base, NoderedUtil, Rights, WellknownIds } from "@openiap/openflow-api";
import { promiseRetry } from "./Logger";
import { Span } from "@opentelemetry/api";

export class dbConfig extends Base {
    constructor() {
        super();
        this._type = "config";
        this.name = "Base configuration";
        this.version = "0.0.1";
    }
    public version: string;
    public needsupdate: boolean;
    public updatedat: Date;
    public skip_history_collections: string;
    public history_delta_count: number;
    public allow_skiphistory: boolean;

    public allow_personal_nodered: boolean;
    public amqp_enabled_exchange: boolean;
    public log_with_trace: boolean;
    public log_with_colors: boolean;
    public enable_openai: boolean;
    public enable_openaiauth: boolean;
    public openai_token: string;
    public log_cache: boolean;
    public log_amqp: boolean;
    public log_login_provider: boolean;
    public log_websocket: boolean;
    public log_oauth: boolean;
    public log_webserver: boolean;
    public log_database: boolean;
    public log_database_queries: boolean;
    public log_database_queries_ms: number;
    public log_grafana: boolean;
    public log_housekeeping: boolean;
    public log_otel: boolean;
    public log_blocked_ips: boolean;
    public otel_debug_log: boolean;
    public otel_warn_log: boolean;
    public otel_err_log: boolean;
    public otel_measure_queued_messages: boolean;
    public otel_measure__mongodb_watch: boolean;
    public otel_measure_onlineuser: boolean;
    public otel_measure_nodeid: boolean;    
    public log_information: boolean;
    public log_debug: boolean;
    public log_verbose: boolean;
    public log_silly: boolean;
    public log_to_exchange: boolean;
    public heapdump_onstop: boolean;
    public api_bypass_perm_check: boolean;
    public ignore_expiration: boolean;

    public workitem_queue_monitoring_interval: number;
    public workitem_queue_monitoring_enabled: boolean;
    public client_heartbeat_timeout: number;
    public client_signin_timeout: number;
    public client_disconnect_signin_error: boolean;

    public amqp_allow_replyto_empty_queuename: boolean;
    public enable_web_tours: boolean;
    public enable_nodered_tours: boolean;
    public grafana_url:string;
    public housekeeping_skip_collections: string;

    public ensure_indexes: boolean;
    public text_index_name_fields: string[];
    public metadata_collections: string[];    

    public auto_create_users: boolean;
    public auto_create_user_from_jwt: boolean;
    public auto_create_domains: string[];
    public persist_user_impersonation: boolean;
    public ping_clients_interval: number;
    public websocket_message_callback_timeout: number;

    public otel_trace_pingclients: boolean;
    public otel_trace_dashboardauth: boolean;
    public otel_trace_include_query: boolean;
    public otel_trace_connection_ips: boolean;
    public otel_trace_mongodb_per_users: boolean;
    public otel_trace_mongodb_query_per_users: boolean;
    public otel_trace_mongodb_count_per_users: boolean;    
    public otel_trace_mongodb_aggregate_per_users: boolean;
    public otel_trace_mongodb_insert_per_users: boolean;
    public otel_trace_mongodb_update_per_users: boolean;
    public otel_trace_mongodb_delete_per_users: boolean;

    public grpc_keepalive_time_ms: number; 
    public grpc_keepalive_timeout_ms: number;
    public grpc_http2_min_ping_interval_without_data_ms: number; 
    public grpc_max_connection_idle_ms: number;
    public grpc_max_connection_age_ms: number;
    public grpc_max_connection_age_grace_ms: number;
    public grpc_http2_max_pings_without_data: number;
    public grpc_keepalive_permit_without_calls: number;
    public grpc_max_receive_message_length: number;
    public grpc_max_send_message_length: number;


    public cache_workitem_queues: boolean;

    public agent_images: NoderedImage[]
    public agent_node_selector: string;


    public async Save(jwt: string, parent: Span): Promise<void> {
        if (this.needsupdate = true) {
            this.updatedat = new Date(new Date().toISOString());
            this.needsupdate = false;
            this.version = Config.version;
        }
        Base.addRight(this, WellknownIds.admins, "admins", [Rights.full_control]);
        if (NoderedUtil.IsNullEmpty(this._id)) await Config.db.InsertOne(this, "config", 1, true, jwt, parent);
        if (!NoderedUtil.IsNullEmpty(this._id)) await Config.db._UpdateOne(null, this, "config", 1, true, jwt, parent);
    }
    public compare(version: string): number {
        return this.version.localeCompare(version, undefined, { numeric: true, sensitivity: 'base' });
    }
    public static async Load(jwt: string, parent: Span): Promise<dbConfig> {
        var conf: dbConfig = await Config.db.GetOne({ query: { "_type": "config" }, collectionname: "config", jwt }, parent);
        if (conf == null) { conf = new dbConfig(); }
        conf = Object.assign(new dbConfig(), conf);
        conf.needsupdate = false;
        if (conf.compare(Config.version) == -1) {
            conf.needsupdate = true;
        }
        Config.log_with_trace = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_with_trace) ? conf.log_with_trace : Config.getEnv("log_with_trace", "false"));

        if (!NoderedUtil.IsNullEmpty(conf.auto_create_users)) Config.auto_create_users = Config.parseBoolean(conf.auto_create_users);
        if (!NoderedUtil.IsNullEmpty(conf.allow_personal_nodered)) Config.allow_personal_nodered = Config.parseBoolean(conf.allow_personal_nodered);
        if (!NoderedUtil.IsNullEmpty(conf.amqp_enabled_exchange)) Config.amqp_enabled_exchange = Config.parseBoolean(conf.amqp_enabled_exchange);

        Logger.instanse.info("db version: " + conf.version, parent);

        Config.skip_history_collections = (!NoderedUtil.IsNullEmpty(conf.skip_history_collections) ? conf.skip_history_collections : Config.getEnv("skip_history_collections", "audit,openrpa_instances,workflow_instances"))
        Config.history_delta_count = parseInt(!NoderedUtil.IsNullEmpty(conf.history_delta_count) ? conf.history_delta_count.toString() : Config.getEnv("history_delta_count", "1000"));
        Config.allow_skiphistory = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.allow_skiphistory) ? conf.allow_skiphistory : Config.getEnv("allow_skiphistory", "false"));

        Config.log_with_trace = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_with_trace) ? conf.log_with_trace : Config.getEnv("log_with_trace", "false"));
        Config.log_with_colors = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_with_colors) ? conf.log_with_colors : Config.getEnv("log_with_colors", "true"));
        Config.enable_openai = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.enable_openai) ? conf.enable_openai : Config.getEnv("enable_openai", "false"));
        Config.enable_openaiauth = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.enable_openaiauth) ? conf.enable_openaiauth : Config.getEnv("enable_openaiauth", "true"));
        Config.openai_token = !NoderedUtil.IsNullEmpty(conf.openai_token) ? conf.openai_token : Config.getEnv("openai_token", "");
        

        Config.log_cache = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_cache) ? conf.log_cache : Config.getEnv("log_cache", "false"));
        Config.log_amqp = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_amqp) ? conf.log_amqp : Config.getEnv("log_amqp", "false"));
        Config.log_login_provider = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_login_provider) ? conf.log_login_provider : Config.getEnv("log_login_provider", "false"));
        Config.log_websocket = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_websocket) ? conf.log_websocket : Config.getEnv("log_websocket", "false"));
        Config.log_oauth = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_oauth) ? conf.log_oauth : Config.getEnv("log_oauth", "false"));
        Config.log_webserver = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_webserver) ? conf.log_webserver : Config.getEnv("log_webserver", "false"));
        Config.log_database = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_database) ? conf.log_database : Config.getEnv("log_database", "false"));
        Config.log_database_queries = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_database_queries) ? conf.log_database_queries : Config.getEnv("log_database_queries", "false"));
        Config.log_database_queries_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.log_database_queries_ms) ? conf.log_database_queries_ms.toString() : Config.getEnv("log_database_queries_ms", "0"));

        Config.log_grafana = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_grafana) ? conf.log_grafana : Config.getEnv("log_grafana", "false"));
        Config.log_housekeeping = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_housekeeping) ? conf.log_housekeeping : Config.getEnv("log_housekeeping", "false"));
        Config.log_otel = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_otel) ? conf.log_otel : Config.getEnv("log_otel", "false"));
        Config.log_blocked_ips = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_blocked_ips) ? conf.log_blocked_ips : Config.getEnv("log_blocked_ips", "true"));
        Config.otel_debug_log = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_debug_log) ? conf.otel_debug_log : Config.getEnv("otel_debug_log", "false"));
        Config.otel_warn_log = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_warn_log) ? conf.otel_warn_log : Config.getEnv("otel_warn_log", "false"));
        Config.otel_err_log = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_err_log) ? conf.otel_err_log : Config.getEnv("otel_err_log", "false"));
        Config.otel_measure_queued_messages = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_measure_queued_messages) ? conf.otel_measure_queued_messages : Config.getEnv("otel_measure_queued_messages", "false"));
        Config.otel_measure__mongodb_watch = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_measure__mongodb_watch) ? conf.otel_measure__mongodb_watch : Config.getEnv("otel_measure__mongodb_watch", "false"));
        Config.otel_measure_onlineuser = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_measure_onlineuser) ? conf.otel_measure_onlineuser : Config.getEnv("otel_measure_onlineuser", "false"));
        Config.otel_measure_nodeid = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_measure_nodeid) ? conf.otel_measure_nodeid : Config.getEnv("otel_measure_nodeid", "false"));


        Config.log_information = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_information) ? conf.log_information : Config.getEnv("log_information", "true"));
        Config.log_debug = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_debug) ? conf.log_debug : Config.getEnv("log_debug", "false"));
        Config.log_verbose = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_verbose) ? conf.log_verbose : Config.getEnv("log_verbose", "false"));
        Config.log_silly = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_silly) ? conf.log_silly : Config.getEnv("log_silly", "false"));
        Config.log_to_exchange = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.log_to_exchange) ? conf.log_to_exchange : Config.getEnv("log_to_exchange", "false"));
        Config.heapdump_onstop = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.heapdump_onstop) ? conf.heapdump_onstop : Config.getEnv("heapdump_onstop", "false"));

        Config.client_heartbeat_timeout = parseInt(!NoderedUtil.IsNullEmpty(conf.client_heartbeat_timeout) ? conf.client_heartbeat_timeout.toString() : Config.getEnv("client_heartbeat_timeout", "60"));
        Config.client_signin_timeout = parseInt(!NoderedUtil.IsNullEmpty(conf.client_signin_timeout) ? conf.client_signin_timeout.toString() : Config.getEnv("client_signin_timeout", "120"));
        Config.client_disconnect_signin_error = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.client_disconnect_signin_error) ? conf.client_disconnect_signin_error : Config.getEnv("client_disconnect_signin_error", "false"));
        Config.api_bypass_perm_check = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.api_bypass_perm_check) ? conf.api_bypass_perm_check : Config.getEnv("api_bypass_perm_check", "false"));
        Config.ignore_expiration = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.ignore_expiration) ? conf.ignore_expiration : Config.getEnv("ignore_expiration", "false"));
        



        Config.workitem_queue_monitoring_interval = parseInt(!NoderedUtil.IsNullEmpty(conf.workitem_queue_monitoring_interval) ? conf.workitem_queue_monitoring_interval.toString() : Config.getEnv("workitem_queue_monitoring_interval", "10000"));
        Config.workitem_queue_monitoring_enabled = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.workitem_queue_monitoring_enabled) ? conf.workitem_queue_monitoring_enabled : Config.getEnv("workitem_queue_monitoring_enabled", "true"));

        Config.amqp_allow_replyto_empty_queuename = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.amqp_allow_replyto_empty_queuename) ? conf.amqp_allow_replyto_empty_queuename : Config.getEnv("amqp_allow_replyto_empty_queuename", "false"));
        Config.enable_web_tours = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.enable_web_tours) ? conf.enable_web_tours : Config.getEnv("enable_web_tours", "true"));
        Config.enable_nodered_tours = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.enable_nodered_tours) ? conf.enable_nodered_tours : Config.getEnv("enable_nodered_tours", "true"));
        Config.grafana_url = !NoderedUtil.IsNullEmpty(conf.grafana_url) ? conf.grafana_url : Config.getEnv("grafana_url", "");
        Config.housekeeping_skip_collections = !NoderedUtil.IsNullEmpty(conf.housekeeping_skip_collections) ? conf.housekeeping_skip_collections : Config.getEnv("housekeeping_skip_collections", "");


        Config.ensure_indexes = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.ensure_indexes) ? conf.ensure_indexes : Config.getEnv("ensure_indexes", "true"));
        Config.text_index_name_fields = Config.parseArray(!NoderedUtil.IsNullEmpty(conf.text_index_name_fields) ? conf.text_index_name_fields.toString() : Config.getEnv("text_index_name_fields", "name,_names"))
        Config.metadata_collections = Config.parseArray(!NoderedUtil.IsNullEmpty(conf.metadata_collections) ? conf.metadata_collections.toString() : Config.getEnv("metadata_collections", ""))
        Config.auto_create_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.auto_create_users) ? conf.auto_create_users : Config.getEnv("auto_create_users", "false"))

        Config.auto_create_user_from_jwt = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.auto_create_user_from_jwt) ? conf.auto_create_user_from_jwt : Config.getEnv("auto_create_user_from_jwt", ""))
        Config.auto_create_user_from_jwt = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.auto_create_user_from_jwt) ? conf.auto_create_user_from_jwt : Config.getEnv("auto_create_user_from_jwt", ""))
        Config.auto_create_domains = Config.parseArray(!NoderedUtil.IsNullEmpty(conf.auto_create_domains) ? conf.auto_create_domains.toString() : Config.getEnv("auto_create_domains", ""))
        Config.persist_user_impersonation = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.persist_user_impersonation) ? conf.persist_user_impersonation : Config.getEnv("persist_user_impersonation", "true"))
        Config.ping_clients_interval = parseInt(!NoderedUtil.IsNullEmpty(conf.ping_clients_interval) ? conf.ping_clients_interval.toString() : Config.getEnv("ping_clients_interval", (10000).toString()))
        Config.websocket_message_callback_timeout = parseInt(!NoderedUtil.IsNullEmpty(conf.websocket_message_callback_timeout) ? conf.websocket_message_callback_timeout.toString() : Config.getEnv("websocket_message_callback_timeout", (10000).toString()))

        Config.otel_trace_pingclients = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_pingclients) ? conf.otel_trace_pingclients : Config.getEnv("otel_trace_pingclients", "false"));
        Config.otel_trace_dashboardauth = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_dashboardauth) ? conf.otel_trace_dashboardauth : Config.getEnv("otel_trace_dashboardauth", "false"));
        Config.otel_trace_include_query = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_include_query) ? conf.otel_trace_include_query : Config.getEnv("otel_trace_include_query", "false"));
        Config.otel_trace_connection_ips = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_connection_ips) ? conf.otel_trace_connection_ips : Config.getEnv("otel_trace_connection_ips", "false"));
        Config.otel_trace_mongodb_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_per_users) ? conf.otel_trace_mongodb_per_users : Config.getEnv("otel_trace_mongodb_per_users", "false"));
        Config.otel_trace_mongodb_query_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_query_per_users) ? conf.otel_trace_mongodb_query_per_users : Config.getEnv("otel_trace_mongodb_query_per_users", "false"));
        Config.otel_trace_mongodb_count_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_count_per_users) ? conf.otel_trace_mongodb_count_per_users : Config.getEnv("otel_trace_mongodb_query_per_users", "false"));
        Config.otel_trace_mongodb_aggregate_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_aggregate_per_users) ? conf.otel_trace_mongodb_aggregate_per_users : Config.getEnv("otel_trace_mongodb_aggregate_per_users", "false"));
        Config.otel_trace_mongodb_insert_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_insert_per_users) ? conf.otel_trace_mongodb_insert_per_users : Config.getEnv("otel_trace_mongodb_insert_per_users", "false"));
        Config.otel_trace_mongodb_update_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_update_per_users) ? conf.otel_trace_mongodb_update_per_users : Config.getEnv("otel_trace_mongodb_update_per_users", "false"));
        Config.otel_trace_mongodb_delete_per_users = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.otel_trace_mongodb_delete_per_users) ? conf.otel_trace_mongodb_delete_per_users : Config.getEnv("otel_trace_mongodb_delete_per_users", "false"));

        Config.grpc_keepalive_time_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_keepalive_time_ms) ? conf.grpc_keepalive_time_ms.toString() : Config.getEnv("grpc_keepalive_time_ms", (-1).toString()))
        Config.grpc_keepalive_timeout_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_keepalive_timeout_ms) ? conf.grpc_keepalive_timeout_ms.toString() : Config.getEnv("grpc_keepalive_timeout_ms", (-1).toString()))
        Config.grpc_http2_min_ping_interval_without_data_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_http2_min_ping_interval_without_data_ms) ? conf.grpc_http2_min_ping_interval_without_data_ms.toString() : Config.getEnv("grpc_http2_min_ping_interval_without_data_ms", (-1).toString()))
        Config.grpc_max_connection_idle_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_max_connection_idle_ms) ? conf.grpc_max_connection_idle_ms.toString() : Config.getEnv("grpc_max_connection_idle_ms", (-1).toString()))
        Config.grpc_max_connection_age_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_max_connection_age_ms) ? conf.grpc_max_connection_age_ms.toString() : Config.getEnv("grpc_max_connection_age_ms", (-1).toString()))
        Config.grpc_max_connection_age_grace_ms = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_max_connection_age_grace_ms) ? conf.grpc_max_connection_age_grace_ms.toString() : Config.getEnv("grpc_max_connection_age_grace_ms", (-1).toString()))
        Config.grpc_http2_max_pings_without_data = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_http2_max_pings_without_data) ? conf.grpc_http2_max_pings_without_data.toString() : Config.getEnv("grpc_http2_max_pings_without_data", (-1).toString()))
        Config.grpc_keepalive_permit_without_calls = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_keepalive_permit_without_calls) ? conf.grpc_keepalive_permit_without_calls.toString() : Config.getEnv("grpc_keepalive_permit_without_calls", (-1).toString()))
        Config.grpc_max_receive_message_length = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_max_receive_message_length) ? conf.grpc_max_receive_message_length.toString() : Config.getEnv("grpc_max_receive_message_length", (-1).toString()))
        Config.grpc_max_send_message_length = parseInt(!NoderedUtil.IsNullEmpty(conf.grpc_max_send_message_length) ? conf.grpc_max_send_message_length.toString() : Config.getEnv("grpc_max_send_message_length", (-1).toString()))
    
    

        Config.cache_workitem_queues = Config.parseBoolean(!NoderedUtil.IsNullEmpty(conf.cache_workitem_queues) ? conf.cache_workitem_queues : Config.getEnv("cache_workitem_queues", "false"));


        Config.agent_node_selector = (!NoderedUtil.IsNullEmpty(conf.agent_node_selector) ? conf.agent_node_selector : Config.getEnv("agent_node_selector", ""))

        if(!NoderedUtil.IsNullUndefinded(conf.agent_images)) {
            Config.agent_images = conf.agent_images;
            if(typeof conf.agent_images === "string") conf.agent_images = JSON.parse(conf.agent_images);
        } else {
            Config.agent_images = JSON.parse(Config.getEnv("agent_images", 
                JSON.stringify([{"name":"Agent", "image":"openiap/nodeagent", "languages": ["nodejs", "python"]}, {"name":"Agent+Chromium", "image":"openiap/nodechromiumagent", "chromium": true, "languages": ["nodejs", "python"]}, {"name":"NodeRED", "image":"openiap/noderedagent", "port": 3000}, {"name":"DotNet 6", "image":"openiap/dotnetagent", "languages": ["dotnet"]} ])
            ));
        }
        Logger.reload();
        return conf;
    }
    public static async Reload(jwt: string, parent: Span): Promise<void> {
        Config.dbConfig = await dbConfig.Load(jwt, parent);
    }
}
export class Config {
    public static dbConfig: dbConfig;
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
        Config.log_login_provider = false;
        Config.log_websocket = false;
        Config.log_oauth = false;
        Config.unittesting = true;
    }
    public static reload(): void {
        Config.getversion();
        Config.log_with_colors = Config.parseBoolean(Config.getEnv("log_with_colors", "true"));
        Config.enable_openai = Config.parseBoolean(Config.getEnv("enable_openai", "false"));
        Config.enable_openaiauth = Config.parseBoolean(Config.getEnv("enable_openaiauth", "true"));
        Config.openai_token = Config.getEnv("openai_token", "");

        Config.log_with_trace = Config.parseBoolean(Config.getEnv("log_with_trace", "false"));

        Config.log_cache = Config.parseBoolean(Config.getEnv("log_cache", "false"));
        Config.log_amqp = Config.parseBoolean(Config.getEnv("log_amqp", "false"));
        Config.log_login_provider = Config.parseBoolean(Config.getEnv("log_login_provider", "false"));
        Config.log_websocket = Config.parseBoolean(Config.getEnv("log_websocket", "false"));
        Config.log_oauth = Config.parseBoolean(Config.getEnv("log_oauth", "false"));
        Config.log_webserver = Config.parseBoolean(Config.getEnv("log_webserver", "false"));
        Config.log_database = Config.parseBoolean(Config.getEnv("log_database", "false"));
        Config.log_database_queries = Config.parseBoolean(Config.getEnv("log_database_queries", "false"));
        Config.log_database_queries_ms = parseInt(Config.getEnv("log_database_queries_ms", "0")); 
        Config.log_grafana = Config.parseBoolean(Config.getEnv("log_grafana", "false"));
        Config.log_housekeeping = Config.parseBoolean(Config.getEnv("log_housekeeping", "false"));
        Config.log_otel = Config.parseBoolean(Config.getEnv("log_otel", "false"));
        Config.log_blocked_ips = Config.parseBoolean(Config.getEnv("log_blocked_ips", "true"));
        Config.log_information = Config.parseBoolean(Config.getEnv("log_information", "true"));
        Config.log_debug = Config.parseBoolean(Config.getEnv("log_debug", "false"));
        Config.log_verbose = Config.parseBoolean(Config.getEnv("log_verbose", "false"));
        Config.log_silly = Config.parseBoolean(Config.getEnv("log_silly", "false"));
        Config.log_to_exchange = Config.parseBoolean(Config.getEnv("log_to_exchange", "false"));
        
        Config.heapdump_onstop = Config.parseBoolean(Config.getEnv("heapdump_onstop", "false"));

        Config.amqp_allow_replyto_empty_queuename = Config.parseBoolean(Config.getEnv("amqp_allow_replyto_empty_queuename", "false"));

        Config.openflow_uniqueid = Config.getEnv("openflow_uniqueid", "");
        Config.enable_openflow_amqp = Config.parseBoolean(Config.getEnv("enable_openflow_amqp", "false"));
        Config.openflow_amqp_expiration = parseInt(Config.getEnv("openflow_amqp_expiration", (60 * 1000 * 25).toString())); // 25 min
        Config.amqp_prefetch = parseInt(Config.getEnv("amqp_prefetch", "25"));
        Config.enable_entity_restriction = Config.parseBoolean(Config.getEnv("enable_entity_restriction", "false"));
        Config.enable_web_tours = Config.parseBoolean(Config.getEnv("enable_web_tours", "true"));
        Config.enable_nodered_tours = Config.parseBoolean(Config.getEnv("enable_nodered_tours", "true"));
        Config.grafana_url = Config.getEnv("grafana_url", "");
        Config.auto_hourly_housekeeping = Config.parseBoolean(Config.getEnv("auto_hourly_housekeeping", "true"));
        Config.housekeeping_update_usage_hourly = Config.parseBoolean(Config.getEnv("housekeeping_update_usage_hourly", "false"));
        Config.housekeeping_update_usersize_hourly = Config.parseBoolean(Config.getEnv("housekeeping_update_usersize_hourly", "true"));
        Config.housekeeping_skip_collections = Config.getEnv("housekeeping_skip_collections", "");
        Config.workitem_queue_monitoring_enabled = Config.parseBoolean(Config.getEnv("workitem_queue_monitoring_enabled", "true"));
        Config.workitem_queue_monitoring_interval = parseInt(Config.getEnv("workitem_queue_monitoring_interval", (10 * 1000).toString())); // 10 sec


        Config.getting_started_url = Config.getEnv("getting_started_url", "");

        Config.NODE_ENV = Config.getEnv("NODE_ENV", "development");
        Config.HTTP_PROXY = Config.getEnv("HTTP_PROXY", "");
        Config.HTTPS_PROXY = Config.getEnv("HTTPS_PROXY", "");
        Config.NO_PROXY = Config.getEnv("NO_PROXY", "");
        Config.agent_HTTP_PROXY = Config.getEnv("agent_HTTP_PROXY", "");
        Config.agent_HTTPS_PROXY = Config.getEnv("agent_HTTPS_PROXY", "");
        Config.agent_NO_PROXY = Config.getEnv("agent_NO_PROXY", "");
        

        Config.stripe_api_key = Config.getEnv("stripe_api_key", "");
        Config.stripe_api_secret = Config.getEnv("stripe_api_secret", "");
        Config.stripe_force_vat = Config.parseBoolean(Config.getEnv("stripe_force_vat", "false"));
        Config.stripe_force_checkout = Config.parseBoolean(Config.getEnv("stripe_force_checkout", "true"));
        Config.stripe_allow_promotion_codes = Config.parseBoolean(Config.getEnv("stripe_allow_promotion_codes", "true"));

        Config.supports_watch = Config.parseBoolean(Config.getEnv("supports_watch", "false"));
        Config.ensure_indexes = Config.parseBoolean(Config.getEnv("ensure_indexes", "true"));
        Config.text_index_name_fields = Config.parseArray(Config.getEnv("text_index_name_fields", "name,_names"));
        Config.metadata_collections = Config.parseArray(Config.getEnv("metadata_collections", ""));        

        Config.auto_create_users = Config.parseBoolean(Config.getEnv("auto_create_users", "false"));
        Config.auto_create_user_from_jwt = Config.parseBoolean(Config.getEnv("auto_create_user_from_jwt", "false"));
        Config.auto_create_domains = Config.parseArray(Config.getEnv("auto_create_domains", ""));
        Config.persist_user_impersonation = Config.parseBoolean(Config.getEnv("persist_user_impersonation", "true"));
        Config.ping_clients_interval = parseInt(Config.getEnv("ping_clients_interval", (10000).toString())); // 10 seconds
        Config.allow_personal_nodered = Config.parseBoolean(Config.getEnv("allow_personal_nodered", "false"));
        Config.use_ingress_beta1_syntax = Config.parseBoolean(Config.getEnv("use_ingress_beta1_syntax", "false"));
        Config.use_openshift_routes = Config.parseBoolean(Config.getEnv("use_openshift_routes", "false"));
        Config.agent_image_pull_secrets = Config.parseArray(Config.getEnv("agent_image_pull_secrets", ""));

        

        Config.auto_create_personal_nodered_group = Config.parseBoolean(Config.getEnv("auto_create_personal_nodered_group", "false"));
        Config.auto_create_personal_noderedapi_group = Config.parseBoolean(Config.getEnv("auto_create_personal_noderedapi_group", "false"));
        Config.force_add_admins = Config.parseBoolean(Config.getEnv("force_add_admins", "true"));
        Config.validate_emails = Config.parseBoolean(Config.getEnv("validate_emails", "false"));
        Config.forgot_pass_emails = Config.parseBoolean(Config.getEnv("forgot_pass_emails", "false"));
        Config.smtp_service = Config.getEnv("smtp_service", "");
        Config.smtp_from = Config.getEnv("smtp_from", "");
        Config.smtp_user = Config.getEnv("smtp_user", "");
        Config.smtp_pass = Config.getEnv("smtp_service", "");
        Config.smtp_url = Config.getEnv("smtp_url", "");
        Config.debounce_lookup = Config.parseBoolean(Config.getEnv("debounce_lookup", "false"));
        Config.validate_emails_disposable = Config.parseBoolean(Config.getEnv("validate_emails_disposable", "false"));



        Config.tls_crt = Config.getEnv("tls_crt", "");
        Config.tls_key = Config.getEnv("tls_key", "");
        Config.tls_ca = Config.getEnv("tls_ca", "");
        Config.tls_passphrase = Config.getEnv("tls_passphrase", "");

        Config.cache_store_type = Config.getEnv("cache_store_type", "memory");
        Config.cache_store_max = parseInt(Config.getEnv("cache_store_max", "1000"));
        Config.cache_store_ttl_seconds = parseInt(Config.getEnv("cache_store_ttl_seconds", "3600"));
        Config.cache_store_redis_host = Config.getEnv("cache_store_redis_host", "");
        Config.cache_store_redis_port = parseInt(Config.getEnv("cache_store_redis_port", "6379"));
        Config.cache_store_redis_password = Config.getEnv("cache_store_redis_password", "");

        Config.cache_workitem_queues = Config.parseBoolean(Config.getEnv("cache_workitem_queues", "false"));

        Config.oidc_access_token_ttl = parseInt(Config.getEnv("oidc_access_token_ttl", "480"));
        Config.oidc_authorization_code_ttl = parseInt(Config.getEnv("oidc_authorization_code_ttl", "480"));
        Config.oidc_client_credentials_ttl = parseInt(Config.getEnv("oidc_client_credentials_ttl", "480"));
        Config.oidc_refresh_token_ttl = parseInt(Config.getEnv("oidc_refresh_token_ttl", "20160"));
        Config.oidc_session_ttl = parseInt(Config.getEnv("oidc_session_ttl", "20160"));

        Config.api_rate_limit = Config.parseBoolean(Config.getEnv("api_rate_limit", "true"));
        Config.api_rate_limit_points = parseInt(Config.getEnv("api_rate_limit_points", "60"));
        Config.api_rate_limit_duration = parseInt(Config.getEnv("api_rate_limit_duration", "1"));
        Config.socket_rate_limit = Config.parseBoolean(Config.getEnv("socket_rate_limit", "true"));
        Config.socket_rate_limit_points = parseInt(Config.getEnv("socket_rate_limit_points", "30"));
        Config.socket_rate_limit_points_disconnect = parseInt(Config.getEnv("socket_rate_limit_points_disconnect", "100"));
        Config.socket_rate_limit_duration = parseInt(Config.getEnv("socket_rate_limit_duration", "1"));
        Config.socket_error_rate_limit_points = parseInt(Config.getEnv("socket_error_rate_limit_points", "16"));
        Config.socket_error_rate_limit_duration = parseInt(Config.getEnv("socket_error_rate_limit_duration", "2"));

        Config.client_heartbeat_timeout = parseInt(Config.getEnv("client_heartbeat_timeout", "60"));
        Config.client_signin_timeout = parseInt(Config.getEnv("client_signin_timeout", "120"));
        Config.client_disconnect_signin_error = Config.parseBoolean(Config.getEnv("client_disconnect_signin_error", "false"));


        Config.expected_max_roles = parseInt(Config.getEnv("expected_max_roles", "4000"));
        Config.decorate_roles_fetching_all_roles = Config.parseBoolean(Config.getEnv("decorate_roles_fetching_all_roles", "true"));
        Config.update_acl_based_on_groups = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups", "true"));
        Config.allow_merge_acl = Config.parseBoolean(Config.getEnv("allow_merge_acl", "false"));
        Config.multi_tenant = Config.parseBoolean(Config.getEnv("multi_tenant", "false"));
        Config.cleanup_on_delete_customer = Config.parseBoolean(Config.getEnv("cleanup_on_delete_customer", "false"));
        Config.cleanup_on_delete_user = Config.parseBoolean(Config.getEnv("cleanup_on_delete_user", "false"));

        Config.api_bypass_perm_check = Config.parseBoolean(Config.getEnv("api_bypass_perm_check", "false"));
        Config.ignore_expiration = Config.parseBoolean(Config.getEnv("ignore_expiration", "false"));
        Config.force_audit_ts = Config.parseBoolean(Config.getEnv("force_audit_ts", "false"));
        Config.force_dbusage_ts = Config.parseBoolean(Config.getEnv("force_dbusage_ts", "false"));
        Config.migrate_audit_to_ts = Config.parseBoolean(Config.getEnv("migrate_audit_to_ts", "true"));

        Config.websocket_package_size = parseInt(Config.getEnv("websocket_package_size", "25000"), 10);
        Config.websocket_max_package_count = parseInt(Config.getEnv("websocket_max_package_count", "1024"), 10);
        Config.websocket_message_callback_timeout = parseInt(Config.getEnv("websocket_message_callback_timeout", "3600"), 10);
        Config.protocol = Config.getEnv("protocol", "http"); // used by personal nodered and baseurl()
        Config.port = parseInt(Config.getEnv("port", "80"));
        Config.domain = Config.getEnv("domain", "localhost"); // sent to website and used in baseurl()
        Config.cookie_secret = Config.getEnv("cookie_secret", "NLgUIsozJaxO38ze0WuHthfj2eb1eIEu");

        Config.amqp_reply_expiration = parseInt(Config.getEnv("amqp_reply_expiration", "10000")); // 10 seconds
        Config.amqp_force_queue_prefix = Config.parseBoolean(Config.getEnv("amqp_force_queue_prefix", "false"));
        Config.amqp_force_exchange_prefix = Config.parseBoolean(Config.getEnv("amqp_force_exchange_prefix", "false"));
        Config.amqp_force_sender_has_read = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_read", "true"));
        Config.amqp_force_sender_has_invoke = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_invoke", "false"));
        Config.amqp_force_consumer_has_update = Config.parseBoolean(Config.getEnv("amqp_force_consumer_has_update", "false"));

        Config.amqp_enabled_exchange = Config.parseBoolean(Config.getEnv("amqp_enabled_exchange", "false"));
        Config.amqp_url = Config.getEnv("amqp_url", "amqp://localhost"); // used to register queues and by personal nodered
        Config.amqp_username = Config.getEnv("amqp_username", "guest"); // used to talk wth rabbitmq api, used if not present in amqp_url
        Config.amqp_password = Config.getEnv("amqp_password", "guest"); // used to talk wth rabbitmq api, used if not present in amqp_url
        Config.amqp_check_for_consumer = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer", "true"));
        Config.amqp_check_for_consumer_count = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer_count", "false"));
        Config.amqp_default_expiration = parseInt(Config.getEnv("amqp_default_expiration", "10000")); // 10 seconds
        Config.amqp_requeue_time = parseInt(Config.getEnv("amqp_requeue_time", "1000")); // 1 seconds    
        Config.amqp_dlx = Config.getEnv("amqp_dlx", "openflow-dlx");  // Dead letter exchange, used to pickup dead or timeout messages

        Config.mongodb_url = Config.getEnv("mongodb_url", "mongodb://localhost:27017");
        Config.mongodb_db = Config.getEnv("mongodb_db", "openflow");
        Config.mongodb_minpoolsize = parseInt(Config.getEnv("mongodb_minpoolsize", "25"));
        Config.mongodb_maxpoolsize = parseInt(Config.getEnv("mongodb_maxpoolsize", "25"));

        Config.skip_history_collections = Config.getEnv("skip_history_collections", "audit,openrpa_instances,workflow_instances");
        Config.history_delta_count = parseInt(Config.getEnv("history_delta_count", "1000"));
        Config.allow_skiphistory = Config.parseBoolean(Config.getEnv("allow_skiphistory", "false"));

        Config.saml_issuer = Config.getEnv("saml_issuer", "the-issuer"); // define uri of STS, also sent to personal nodereds
        Config.aes_secret = Config.getEnv("aes_secret", "");
        Config.signing_crt = Config.getEnv("signing_crt", "");
        Config.singing_key = Config.getEnv("singing_key", "");
        Config.wapid_mail = Config.getEnv("wapid_mail", "");
        Config.wapid_pub = Config.getEnv("wapid_pub", "");
        Config.wapid_key = Config.getEnv("wapid_key", "");
        Config.shorttoken_expires_in = Config.getEnv("shorttoken_expires_in", "5m");
        Config.longtoken_expires_in = Config.getEnv("longtoken_expires_in", "365d");
        Config.downloadtoken_expires_in = Config.getEnv("downloadtoken_expires_in", "15m");
        Config.personalnoderedtoken_expires_in = Config.getEnv("personalnoderedtoken_expires_in", "365d");

        Config.nodered_images = JSON.parse(Config.getEnv("nodered_images", "[{\"name\":\"Latest Plain Nodered\", \"image\":\"openiap/nodered\"}]"));
        Config.agent_images = JSON.parse(Config.getEnv("agent_images", 
        JSON.stringify([{"name":"Agent", "image":"openiap/nodeagent", "languages": ["nodejs", "python"]}, {"name":"Agent+Chromium", "image":"openiap/nodechromiumagent", "chromium": true, "languages": ["nodejs", "python"]}, {"name":"NodeRED", "image":"openiap/noderedagent", "port": 3000}, {"name":"DotNet 6", "image":"openiap/dotnetagent", "languages": ["dotnet"]} ])
        ));
        Config.agent_domain_schema = Config.getEnv("agent_domain_schema", "");
        Config.agent_node_selector = Config.getEnv("agent_node_selector", "");

        Config.agent_apiurl = Config.getEnv("agent_apiurl", "");
        Config.agent_oidc_config = Config.getEnv("agent_oidc_config", "");
        Config.agent_oidc_client_id = Config.getEnv("agent_oidc_client_id", "");
        Config.agent_oidc_client_secret = Config.getEnv("agent_oidc_client_secret", "");
        Config.agent_oidc_userinfo_endpoint = Config.getEnv("agent_oidc_userinfo_endpoint", "");
        Config.agent_oidc_issuer = Config.getEnv("agent_oidc_issuer", "");
        Config.agent_oidc_authorization_endpoint = Config.getEnv("agent_oidc_authorization_endpoint", "");
        Config.agent_oidc_token_endpoint = Config.getEnv("agent_oidc_token_endpoint", "");
    
        Config.saml_federation_metadata = Config.getEnv("saml_federation_metadata", "");
        Config.api_ws_url = Config.getEnv("api_ws_url", "");
        Config.nodered_ws_url = Config.getEnv("nodered_ws_url", "");
        Config.nodered_saml_entrypoint = Config.getEnv("nodered_saml_entrypoint", "");
        Config.agent_docker_entrypoints = Config.getEnv("agent_docker_entrypoints", "web");
        Config.agent_docker_use_project = Config.parseBoolean(Config.getEnv("agent_docker_use_project", "false"));
        Config.agent_docker_certresolver = Config.getEnv("agent_docker_certresolver", "");
        Config.namespace = Config.getEnv("namespace", ""); // also sent to website 
        Config.nodered_domain_schema = Config.getEnv("nodered_domain_schema", ""); // also sent to website
        Config.nodered_initial_liveness_delay = parseInt(Config.getEnv("nodered_initial_liveness_delay", "60"));
        Config.nodered_allow_nodeselector = Config.parseBoolean(Config.getEnv("nodered_allow_nodeselector", "false"));
        // Config.nodered_requests_memory = Config.getEnv("nodered_requests_memory", "");
        // Config.nodered_requests_cpu = Config.getEnv("nodered_requests_cpu", ""); // 1000m = 1vCPU
        // Config.nodered_limits_memory = Config.getEnv("nodered_limits_memory", "");
        // Config.nodered_limits_cpu = Config.getEnv("nodered_limits_cpu", ""); // 1000m = 1vCPU

        Config.nodered_liveness_failurethreshold = parseInt(Config.getEnv("nodered_liveness_failurethreshold", "5"));
        Config.nodered_liveness_timeoutseconds = parseInt(Config.getEnv("nodered_liveness_timeoutseconds", "5"));
        Config.noderedcatalogues = Config.getEnv("noderedcatalogues", "");

        Config.otel_measure_nodeid = Config.parseBoolean(Config.getEnv("otel_measure_nodeid", "false"));
        Config.otel_measure_queued_messages = Config.parseBoolean(Config.getEnv("otel_measure_queued_messages", "false"));
        Config.otel_measure__mongodb_watch = Config.parseBoolean(Config.getEnv("otel_measure__mongodb_watch", "false"));
        Config.otel_measure_onlineuser = Config.parseBoolean(Config.getEnv("otel_measure_onlineuser", "false"));
        Config.enable_analytics = Config.parseBoolean(Config.getEnv("enable_analytics", "true"));

        Config.otel_debug_log = Config.parseBoolean(Config.getEnv("otel_debug_log", "false"));
        Config.otel_warn_log = Config.parseBoolean(Config.getEnv("otel_warn_log", "false"));
        Config.otel_err_log = Config.parseBoolean(Config.getEnv("otel_err_log", "false"));
        Config.otel_trace_url = Config.getEnv("otel_trace_url", "");
        Config.otel_metric_url = Config.getEnv("otel_metric_url", "");
        Config.otel_trace_interval = parseInt(Config.getEnv("otel_trace_interval", "5000"));
        Config.otel_metric_interval = parseInt(Config.getEnv("otel_metric_interval", "5000"));

        Config.otel_trace_pingclients = Config.parseBoolean(Config.getEnv("otel_trace_pingclients", "false"));
        Config.otel_trace_dashboardauth = Config.parseBoolean(Config.getEnv("otel_trace_dashboardauth", "false"));
        Config.otel_trace_include_query = Config.parseBoolean(Config.getEnv("otel_trace_include_query", "false"));
        Config.otel_trace_connection_ips = Config.parseBoolean(Config.getEnv("otel_trace_connection_ips", "false"));
        Config.otel_trace_mongodb_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_per_users", "false"));
        Config.otel_trace_mongodb_query_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_query_per_users", "false"));
        Config.otel_trace_mongodb_count_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_count_per_users", "false"));
        Config.otel_trace_mongodb_aggregate_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_aggregate_per_users", "false"));
        Config.otel_trace_mongodb_insert_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_insert_per_users", "false"));
        Config.otel_trace_mongodb_update_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_update_per_users", "false"));
        Config.otel_trace_mongodb_delete_per_users = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_delete_per_users", "false"));

        Config.grpc_keepalive_time_ms = parseInt(Config.getEnv("grpc_keepalive_time_ms", "-1"));
        Config.grpc_keepalive_timeout_ms = parseInt(Config.getEnv("grpc_keepalive_timeout_ms", "-1"));
        Config.grpc_http2_min_ping_interval_without_data_ms = parseInt(Config.getEnv("grpc_http2_min_ping_interval_without_data_ms", "-1"));
        Config.grpc_max_connection_idle_ms = parseInt(Config.getEnv("grpc_max_connection_idle_ms", "-1"));
        Config.grpc_max_connection_age_ms = parseInt(Config.getEnv("grpc_max_connection_age_ms", "-1"));
        Config.grpc_max_connection_age_grace_ms = parseInt(Config.getEnv("grpc_max_connection_age_grace_ms", "-1"));
        Config.grpc_http2_max_pings_without_data = parseInt(Config.getEnv("grpc_http2_max_pings_without_data", "-1"));
        Config.grpc_keepalive_permit_without_calls = parseInt(Config.getEnv("grpc_keepalive_permit_without_calls", "-1"));
        Config.grpc_max_receive_message_length = parseInt(Config.getEnv("grpc_max_receive_message_length", "-1"));
        Config.grpc_max_send_message_length = parseInt(Config.getEnv("grpc_max_send_message_length", "-1"));
    

        Config.validate_user_form = Config.getEnv("validate_user_form", "");
    }
    public static load_drom_db(): void {
    }
    public static unittesting: boolean = false;
    public static db: DatabaseConnection = null;
    public static license_key: string = Config.getEnv("license_key", "");
    public static enable_openai: boolean = Config.parseBoolean(Config.getEnv("enable_openai", "false"));
    public static enable_openaiauth: boolean = Config.parseBoolean(Config.getEnv("enable_openaiauth", "true"));
    public static openai_token: string = Config.getEnv("openai_token", "");
    public static version: string = Config.getversion();
    public static log_with_colors: boolean = Config.parseBoolean(Config.getEnv("log_with_colors", "true"));
    
    public static log_cache: boolean = Config.parseBoolean(Config.getEnv("log_cache", "false"));
    public static log_amqp: boolean = Config.parseBoolean(Config.getEnv("log_amqp", "false"));
    public static log_login_provider: boolean = Config.parseBoolean(Config.getEnv("log_login_provider", "false"));
    public static log_with_trace: boolean = Config.parseBoolean(Config.getEnv("log_with_trace", "false"));
    public static log_websocket: boolean = Config.parseBoolean(Config.getEnv("log_websocket", "false"));
    public static log_oauth: boolean = Config.parseBoolean(Config.getEnv("log_oauth", "false"));
    public static log_webserver: boolean = Config.parseBoolean(Config.getEnv("log_webserver", "false"));
    public static log_database: boolean = Config.parseBoolean(Config.getEnv("log_database", "false"));
    public static log_database_queries: boolean = Config.parseBoolean(Config.getEnv("log_database_queries", "false"));
    public static log_database_queries_ms: number = parseInt(Config.getEnv("log_database_queries_ms", "0"));    

    public static log_grafana: boolean = Config.parseBoolean(Config.getEnv("log_grafana", "false"));
    public static log_housekeeping: boolean = Config.parseBoolean(Config.getEnv("log_housekeeping", "false"));
    public static log_otel: boolean = Config.parseBoolean(Config.getEnv("log_otel", "false"));
    public static log_blocked_ips: boolean = Config.parseBoolean(Config.getEnv("log_blocked_ips", "true"));
    public static log_information: boolean = Config.parseBoolean(Config.getEnv("log_information", "true"));
    public static log_debug: boolean = Config.parseBoolean(Config.getEnv("log_debug", "false"));
    public static log_verbose: boolean = Config.parseBoolean(Config.getEnv("log_verbose", "false"));
    public static log_silly: boolean = Config.parseBoolean(Config.getEnv("log_silly", "false"));
    public static log_to_exchange: boolean = Config.parseBoolean(Config.getEnv("log_to_exchange", "false"));

    public static heapdump_onstop: boolean = Config.parseBoolean(Config.getEnv("heapdump_onstop", "false"));

    public static amqp_allow_replyto_empty_queuename: boolean = Config.parseBoolean(Config.getEnv("amqp_allow_replyto_empty_queuename", "false"));

    public static openflow_uniqueid: string = Config.getEnv("openflow_uniqueid", "");
    public static enable_openflow_amqp: boolean = Config.parseBoolean(Config.getEnv("enable_openflow_amqp", "false"));
    public static openflow_amqp_expiration: number = parseInt(Config.getEnv("openflow_amqp_expiration", (60 * 1000 * 25).toString())); // 25 min
    public static amqp_prefetch: number = parseInt(Config.getEnv("amqp_prefetch", "25"));
    public static enable_entity_restriction: boolean = Config.parseBoolean(Config.getEnv("enable_entity_restriction", "false"));
    public static enable_web_tours: boolean = Config.parseBoolean(Config.getEnv("enable_web_tours", "true"));
    public static enable_nodered_tours: boolean = Config.parseBoolean(Config.getEnv("enable_nodered_tours", "true"));
    public static grafana_url:string = Config.getEnv("grafana_url", "");
    public static auto_hourly_housekeeping: boolean = Config.parseBoolean(Config.getEnv("auto_hourly_housekeeping", "true"));
    public static housekeeping_update_usage_hourly: boolean = Config.parseBoolean(Config.getEnv("housekeeping_update_usage_hourly", "false"));
    public static housekeeping_update_usersize_hourly: boolean = Config.parseBoolean(Config.getEnv("housekeeping_update_usersize_hourly", "true"));
    public static housekeeping_skip_collections: string = Config.getEnv("housekeeping_skip_collections", "");
    public static workitem_queue_monitoring_enabled: boolean = Config.parseBoolean(Config.getEnv("workitem_queue_monitoring_enabled", "true"));
    public static workitem_queue_monitoring_interval: number = parseInt(Config.getEnv("workitem_queue_monitoring_interval", (10 * 1000).toString())); // 10 sec

    public static upload_max_filesize_mb: number = parseInt(Config.getEnv("upload_max_filesize_mb", "25"));

    public static getting_started_url: string = Config.getEnv("getting_started_url", "");

    public static NODE_ENV: string = Config.getEnv("NODE_ENV", "development");
    public static HTTP_PROXY: string = Config.getEnv("HTTP_PROXY", "");
    public static HTTPS_PROXY: string = Config.getEnv("HTTPS_PROXY", "");
    public static NO_PROXY: string = Config.getEnv("NO_PROXY", "");
    public static agent_HTTP_PROXY: string = Config.getEnv("agent_HTTP_PROXY", "");
    public static agent_HTTPS_PROXY: string = Config.getEnv("agent_HTTPS_PROXY", "");
    public static agent_NO_PROXY: string = Config.getEnv("agent_NO_PROXY", "");

    public static stripe_api_key: string = Config.getEnv("stripe_api_key", "");
    public static stripe_api_secret: string = Config.getEnv("stripe_api_secret", "");
    public static stripe_force_vat: boolean = Config.parseBoolean(Config.getEnv("stripe_force_vat", "false"));
    public static stripe_force_checkout: boolean = Config.parseBoolean(Config.getEnv("stripe_force_checkout", "false"));
    public static stripe_allow_promotion_codes: boolean = Config.parseBoolean(Config.getEnv("stripe_allow_promotion_codes", "true"));

    public static supports_watch: boolean = Config.parseBoolean(Config.getEnv("supports_watch", "false"));
    public static ensure_indexes: boolean = Config.parseBoolean(Config.getEnv("ensure_indexes", "true"));
    public static text_index_name_fields: string[] = Config.parseArray(Config.getEnv("text_index_name_fields", "name,_names"));
    public static metadata_collections: string[] = Config.parseArray(Config.getEnv("metadata_collections", ""));    

    public static auto_create_users: boolean = Config.parseBoolean(Config.getEnv("auto_create_users", "false"));
    public static auto_create_user_from_jwt: boolean = Config.parseBoolean(Config.getEnv("auto_create_user_from_jwt", "false"));
    public static auto_create_domains: string[] = Config.parseArray(Config.getEnv("auto_create_domains", ""));
    public static persist_user_impersonation: boolean = Config.parseBoolean(Config.getEnv("persist_user_impersonation", "true"));
    public static ping_clients_interval: number = parseInt(Config.getEnv("ping_clients_interval", (10000).toString())); // 10 seconds

    public static allow_personal_nodered: boolean = Config.parseBoolean(Config.getEnv("allow_personal_nodered", "false"));
    public static use_ingress_beta1_syntax: boolean = Config.parseBoolean(Config.getEnv("use_ingress_beta1_syntax", "false"));
    public static use_openshift_routes: boolean = Config.parseBoolean(Config.getEnv("use_openshift_routes", "false"));
    public static agent_image_pull_secrets: string[] = Config.parseArray(Config.getEnv("agent_image_pull_secrets", ""));
    public static auto_create_personal_nodered_group: boolean = Config.parseBoolean(Config.getEnv("auto_create_personal_nodered_group", "false"));
    public static auto_create_personal_noderedapi_group: boolean = Config.parseBoolean(Config.getEnv("auto_create_personal_noderedapi_group", "false"));
    public static force_add_admins: boolean = Config.parseBoolean(Config.getEnv("force_add_admins", "true"));
    public static validate_emails: boolean = Config.parseBoolean(Config.getEnv("validate_emails", "false"));
    public static forgot_pass_emails: boolean = Config.parseBoolean(Config.getEnv("forgot_pass_emails", "false"));
    public static smtp_service: string = Config.getEnv("smtp_service", "");
    public static smtp_from: string = Config.getEnv("smtp_from", "");
    public static smtp_user: string = Config.getEnv("smtp_user", "");
    public static smtp_pass: string = Config.getEnv("smtp_pass", "");
    public static smtp_url: string = Config.getEnv("smtp_url", "");
    public static debounce_lookup: boolean = Config.parseBoolean(Config.getEnv("debounce_lookup", "false"));
    public static validate_emails_disposable: boolean = Config.parseBoolean(Config.getEnv("validate_emails_disposable", "false"));

    public static tls_crt: string = Config.getEnv("tls_crt", "");
    public static tls_key: string = Config.getEnv("tls_key", "");
    public static tls_ca: string = Config.getEnv("tls_ca", "");
    public static tls_passphrase: string = Config.getEnv("tls_passphrase", "");

    public static cache_store_type: string = Config.getEnv("cache_store_type", "memory");
    public static cache_store_max: number = parseInt(Config.getEnv("cache_store_max", "1000"));
    public static cache_store_ttl_seconds: number = parseInt(Config.getEnv("cache_store_ttl_seconds", "3600"));
    public static cache_store_redis_host: string = Config.getEnv("cache_store_redis_host", "");
    public static cache_store_redis_port: number = parseInt(Config.getEnv("cache_store_redis_port", "6379"));
    public static cache_store_redis_password: string = Config.getEnv("cache_store_redis_password", "");
    public static cache_workitem_queues: boolean = Config.parseBoolean(Config.getEnv("cache_workitem_queues", "false"));

    public static oidc_access_token_ttl: number = parseInt(Config.getEnv("oidc_access_token_ttl", "480")); // 8 hours
    public static oidc_authorization_code_ttl: number = parseInt(Config.getEnv("oidc_authorization_code_ttl", "480")); // 8 hours
    public static oidc_client_credentials_ttl: number = parseInt(Config.getEnv("oidc_client_credentials_ttl", "480")); // 8 hours
    public static oidc_refresh_token_ttl: number = parseInt(Config.getEnv("oidc_refresh_token_ttl", "20160")); // 14 days in seconds
    public static oidc_session_ttl: number = parseInt(Config.getEnv("oidc_session_ttl", "20160")); // 14 days in seconds

    public static oidc_cookie_key: string = Config.getEnv("oidc_cookie_key", "Y6SPiXCxDhAJbN7cbydMw5eX1wIrdy8PiWApqEcguss=");
    public static api_rate_limit: boolean = Config.parseBoolean(Config.getEnv("api_rate_limit", "true"));
    public static api_rate_limit_points: number = parseInt(Config.getEnv("api_rate_limit_points", "20"));
    public static api_rate_limit_duration: number = parseInt(Config.getEnv("api_rate_limit_duration", "1"));
    public static socket_rate_limit: boolean = Config.parseBoolean(Config.getEnv("socket_rate_limit", "true"));
    public static socket_rate_limit_points: number = parseInt(Config.getEnv("socket_rate_limit_points", "30"));
    public static socket_rate_limit_points_disconnect: number = parseInt(Config.getEnv("socket_rate_limit_points_disconnect", "100"));
    public static socket_rate_limit_duration: number = parseInt(Config.getEnv("socket_rate_limit_duration", "1"));
    public static socket_error_rate_limit_points: number = parseInt(Config.getEnv("socket_error_rate_limit_points", "30"));
    public static socket_error_rate_limit_duration: number = parseInt(Config.getEnv("socket_error_rate_limit_duration", "1"));

    public static client_heartbeat_timeout: number = parseInt(Config.getEnv("client_heartbeat_timeout", "60"));
    public static client_signin_timeout: number = parseInt(Config.getEnv("client_signin_timeout", "120"));
    public static client_disconnect_signin_error: boolean = Config.parseBoolean(Config.getEnv("client_disconnect_signin_error", "false"));

    public static expected_max_roles: number = parseInt(Config.getEnv("expected_max_roles", "20000"));
    public static decorate_roles_fetching_all_roles = Config.parseBoolean(Config.getEnv("decorate_roles_fetching_all_roles", "true"));
    public static max_recursive_group_depth: number = parseInt(Config.getEnv("max_recursive_group_depth", "2"));
    public static update_acl_based_on_groups: boolean = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups", "true"));
    public static allow_merge_acl: boolean = Config.parseBoolean(Config.getEnv("allow_merge_acl", "false"));

    public static multi_tenant: boolean = Config.parseBoolean(Config.getEnv("multi_tenant", "false"));
    public static cleanup_on_delete_customer: boolean = Config.parseBoolean(Config.getEnv("cleanup_on_delete_customer", "false"));
    public static cleanup_on_delete_user: boolean = Config.parseBoolean(Config.getEnv("cleanup_on_delete_user", "false"));
    public static api_bypass_perm_check: boolean = Config.parseBoolean(Config.getEnv("api_bypass_perm_check", "false"));
    public static ignore_expiration: boolean = Config.parseBoolean(Config.getEnv("ignore_expiration", "false"));
    public static force_audit_ts: boolean = Config.parseBoolean(Config.getEnv("force_audit_ts", "false"));
    public static force_dbusage_ts: boolean = Config.parseBoolean(Config.getEnv("force_dbusage_ts", "false"));
    public static migrate_audit_to_ts: boolean = Config.parseBoolean(Config.getEnv("migrate_audit_to_ts", "true"));

    public static websocket_package_size: number = parseInt(Config.getEnv("websocket_package_size", "25000"), 10);
    public static websocket_max_package_count: number = parseInt(Config.getEnv("websocket_max_package_count", "25000"), 10);
    public static websocket_message_callback_timeout: number = parseInt(Config.getEnv("websocket_message_callback_timeout", "3600"), 10);    
    public static websocket_disconnect_out_of_sync: boolean = Config.parseBoolean(Config.getEnv("websocket_disconnect_out_of_sync", "false"));
    public static protocol: string = Config.getEnv("protocol", "http"); // used by personal nodered and baseurl()
    public static port: number = parseInt(Config.getEnv("port", "80"));
    public static domain: string = Config.getEnv("domain", "localhost"); // sent to website and used in baseurl()
    public static cookie_secret: string = Config.getEnv("cookie_secret", "NLgUIsozJaxO38ze0WuHthfj2eb1eIEu"); // Used to protect cookies
    public static max_ace_count: number = parseInt(Config.getEnv("max_ace_count", "128"), 10);

    public static amqp_reply_expiration: number = parseInt(Config.getEnv("amqp_reply_expiration", (60 * 1000).toString())); // 1 min
    public static amqp_force_queue_prefix: boolean = Config.parseBoolean(Config.getEnv("amqp_force_queue_prefix", "false"));
    public static amqp_force_exchange_prefix: boolean = Config.parseBoolean(Config.getEnv("amqp_force_exchange_prefix", "false"));
    public static amqp_force_sender_has_read: boolean = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_read", "true"));
    public static amqp_force_sender_has_invoke: boolean = Config.parseBoolean(Config.getEnv("amqp_force_sender_has_invoke", "false"));
    public static amqp_force_consumer_has_update: boolean = Config.parseBoolean(Config.getEnv("amqp_force_consumer_has_update", "false"));
    public static amqp_enabled_exchange: boolean = Config.parseBoolean(Config.getEnv("amqp_enabled_exchange", "false"));
    public static amqp_url: string = Config.getEnv("amqp_url", "amqp://localhost"); // used to register queues and by personal nodered
    public static amqp_username: string = Config.getEnv("amqp_username", "guest"); // used to talk wth rabbitmq api
    public static amqp_password: string = Config.getEnv("amqp_password", "guest"); // used to talk wth rabbitmq api

    public static amqp_check_for_consumer: boolean = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer", "true"));
    public static amqp_check_for_consumer_count: boolean = Config.parseBoolean(Config.getEnv("amqp_check_for_consumer_count", "false"));
    public static amqp_default_expiration: number = parseInt(Config.getEnv("amqp_default_expiration", (60 * 1000).toString())); // 1 min
    public static amqp_requeue_time: number = parseInt(Config.getEnv("amqp_requeue_time", "1000")); // 1 seconds    
    public static amqp_dlx: string = Config.getEnv("amqp_dlx", "openflow-dlx");  // Dead letter exchange, used to pickup dead or timeout messages

    public static mongodb_url: string = Config.getEnv("mongodb_url", "mongodb://localhost:27017");
    public static mongodb_db: string = Config.getEnv("mongodb_db", "openflow");
    public static mongodb_minpoolsize: number = parseInt(Config.getEnv("mongodb_minpoolsize", "25"));
    public static mongodb_maxpoolsize: number = parseInt(Config.getEnv("mongodb_maxpoolsize", "25"));

    public static skip_history_collections: string = Config.getEnv("skip_history_collections", "audit,openrpa_instances,workflow_instances");
    public static history_delta_count: number = parseInt(Config.getEnv("history_delta_count", "1000"));
    public static allow_skiphistory: boolean = Config.parseBoolean(Config.getEnv("allow_skiphistory", "false"));

    public static saml_issuer: string = Config.getEnv("saml_issuer", "the-issuer"); // define uri of STS, also sent to personal nodereds
    public static aes_secret: string = Config.getEnv("aes_secret", "");
    public static signing_crt: string = Config.getEnv("signing_crt", "");
    public static singing_key: string = Config.getEnv("singing_key", "");
    public static wapid_mail: string = Config.getEnv("wapid_mail", "");
    public static wapid_pub: string = Config.getEnv("wapid_pub", "");
    public static wapid_key: string = Config.getEnv("wapid_key", "");

    public static shorttoken_expires_in: string = Config.getEnv("shorttoken_expires_in", "5m");
    public static longtoken_expires_in: string = Config.getEnv("longtoken_expires_in", "365d");
    public static downloadtoken_expires_in: string = Config.getEnv("downloadtoken_expires_in", "15m");
    public static personalnoderedtoken_expires_in: string = Config.getEnv("personalnoderedtoken_expires_in", "365d");

    // public static nodered_image: string = Config.getEnv("nodered_image", "openiap/nodered");
    public static nodered_images: NoderedImage[] = JSON.parse(Config.getEnv("nodered_images", "[{\"name\":\"Latest Plain Nodered\", \"image\":\"openiap/nodered\"}]"));
    public static agent_images: NoderedImage[] = JSON.parse(Config.getEnv("agent_images", 
        JSON.stringify([{"name":"Agent", "image":"openiap/nodeagent", "languages": ["nodejs", "python"]}, {"name":"Agent+Chromium", "image":"openiap/nodechromiumagent", "chromium": true, "languages": ["nodejs", "python"]}, {"name":"NodeRED", "image":"openiap/noderedagent", "port": 3000}, {"name":"DotNet 6", "image":"openiap/dotnetagent", "languages": ["dotnet"]} , {"name":"PowerShell 7.3", "image":"openiap/nodeagent:pwsh", "languages": ["powershell"]} ])
    ));
    public static agent_domain_schema: string = Config.getEnv("agent_domain_schema", "");
    public static agent_node_selector:string = Config.getEnv("agent_node_selector", "");

    public static agent_apiurl: string = Config.getEnv("agent_apiurl", "");
    public static agent_oidc_config: string = Config.getEnv("agent_oidc_config", "");
    public static agent_oidc_client_id: string = Config.getEnv("agent_oidc_client_id", "");
    public static agent_oidc_client_secret: string = Config.getEnv("agent_oidc_client_secret", "");
    public static agent_oidc_userinfo_endpoint: string = Config.getEnv("agent_oidc_userinfo_endpoint", "");
    public static agent_oidc_issuer: string = Config.getEnv("agent_oidc_issuer", "");
    public static agent_oidc_authorization_endpoint: string = Config.getEnv("agent_oidc_authorization_endpoint", "");
    public static agent_oidc_token_endpoint: string = Config.getEnv("agent_oidc_token_endpoint", "");

    public static saml_federation_metadata: string = Config.getEnv("saml_federation_metadata", "");
    public static api_ws_url: string = Config.getEnv("api_ws_url", "");
    public static nodered_ws_url: string = Config.getEnv("nodered_ws_url", "");
    public static nodered_saml_entrypoint: string = Config.getEnv("nodered_saml_entrypoint", "");

    public static agent_docker_entrypoints: string = Config.getEnv("agent_docker_entrypoints", "web");
    public static agent_docker_use_project: boolean = Config.parseBoolean(Config.getEnv("agent_docker_use_project", "false"));
    public static agent_docker_certresolver: string = Config.getEnv("agent_docker_certresolver", "");

    public static namespace: string = Config.getEnv("namespace", ""); // also sent to website 
    public static nodered_domain_schema: string = Config.getEnv("nodered_domain_schema", ""); // also sent to website
    public static nodered_initial_liveness_delay: number = parseInt(Config.getEnv("nodered_initial_liveness_delay", "60"));
    public static nodered_allow_nodeselector: boolean = Config.parseBoolean(Config.getEnv("nodered_allow_nodeselector", "false"));
    // public static nodered_requests_memory: string = Config.getEnv("nodered_requests_memory", "");
    // public static nodered_requests_cpu: string = Config.getEnv("nodered_requests_cpu", ""); // 1000m = 1vCPU
    // public static nodered_limits_memory: string = Config.getEnv("nodered_limits_memory", "");
    // public static nodered_limits_cpu: string = Config.getEnv("nodered_limits_cpu", ""); // 1000m = 1vCPU
    public static nodered_liveness_failurethreshold: number = parseInt(Config.getEnv("nodered_liveness_failurethreshold", "5"));
    public static nodered_liveness_timeoutseconds: number = parseInt(Config.getEnv("nodered_liveness_timeoutseconds", "5"));
    public static noderedcatalogues: string = Config.getEnv("noderedcatalogues", "");

    public static otel_measure_nodeid: boolean = Config.parseBoolean(Config.getEnv("otel_measure_nodeid", "false"));
    public static otel_measure_queued_messages: boolean = Config.parseBoolean(Config.getEnv("otel_measure_queued_messages", "false"));
    public static otel_measure__mongodb_watch: boolean = Config.parseBoolean(Config.getEnv("otel_measure__mongodb_watch", "false"));
    public static otel_measure_onlineuser: boolean = Config.parseBoolean(Config.getEnv("otel_measure_onlineuser", "false"));
    public static enable_analytics: boolean = Config.parseBoolean(Config.getEnv("enable_analytics", "true"));
    public static otel_debug_log: boolean = Config.parseBoolean(Config.getEnv("otel_debug_log", "false"));
    public static otel_warn_log: boolean = Config.parseBoolean(Config.getEnv("otel_warn_log", "false"));
    public static otel_err_log: boolean = Config.parseBoolean(Config.getEnv("otel_err_log", "false"));
    public static otel_trace_url: string = Config.getEnv("otel_trace_url", "");
    public static otel_metric_url: string = Config.getEnv("otel_metric_url", "");
    public static otel_trace_interval: number = parseInt(Config.getEnv("otel_trace_interval", "5000"));
    public static otel_metric_interval: number = parseInt(Config.getEnv("otel_metric_interval", "5000"));
    public static otel_trace_pingclients: boolean = Config.parseBoolean(Config.getEnv("otel_trace_pingclients", "false"));
    public static otel_trace_dashboardauth: boolean = Config.parseBoolean(Config.getEnv("otel_trace_dashboardauth", "false"));
    public static otel_trace_include_query: boolean = Config.parseBoolean(Config.getEnv("otel_trace_include_query", "false"));
    public static otel_trace_connection_ips: boolean = Config.parseBoolean(Config.getEnv("otel_trace_connection_ips", "false"));
    public static otel_trace_mongodb_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_per_users", "false"));
    public static otel_trace_mongodb_query_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_query_per_users", "false"));
    public static otel_trace_mongodb_count_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_count_per_users", "false"));
    public static otel_trace_mongodb_aggregate_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_aggregate_per_users", "false"));
    public static otel_trace_mongodb_insert_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_insert_per_users", "false"));
    public static otel_trace_mongodb_update_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_update_per_users", "false"));
    public static otel_trace_mongodb_delete_per_users: boolean = Config.parseBoolean(Config.getEnv("otel_trace_mongodb_delete_per_users", "false"));

    public static grpc_keepalive_time_ms = parseInt(Config.getEnv("grpc_keepalive_time_ms", "-1"));
    public static grpc_keepalive_timeout_ms = parseInt(Config.getEnv("grpc_keepalive_timeout_ms", "-1"));
    public static grpc_http2_min_ping_interval_without_data_ms = parseInt(Config.getEnv("grpc_http2_min_ping_interval_without_data_ms", "-1"));
    public static grpc_max_connection_idle_ms = parseInt(Config.getEnv("grpc_max_connection_idle_ms", "-1"));
    public static grpc_max_connection_age_ms = parseInt(Config.getEnv("grpc_max_connection_age_ms", "-1"));
    public static grpc_max_connection_age_grace_ms = parseInt(Config.getEnv("grpc_max_connection_age_grace_ms", "-1"));
    public static grpc_http2_max_pings_without_data = parseInt(Config.getEnv("grpc_http2_max_pings_without_data", "-1"));
    public static grpc_keepalive_permit_without_calls = parseInt(Config.getEnv("grpc_keepalive_permit_without_calls", "-1"));
    public static grpc_max_receive_message_length = parseInt(Config.getEnv("grpc_max_receive_message_length", "-1"));
    public static grpc_max_send_message_length = parseInt(Config.getEnv("grpc_max_send_message_length", "-1"));

    public static validate_user_form: string = Config.getEnv("validate_user_form", "");

    public static externalbaseurl(): string {
        let result: string = "";
        result = Config.protocol + "://" + Config.domain + "/";
        return result;
    }
    public static baseurl(): string {
        let result: string = "";
        if (Config.tls_crt != '' && Config.tls_key != '') {
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
        if (Config.tls_crt != '' && Config.tls_key != '') {
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
    public static getEnv(name: string, defaultvalue: string): string {
        let value: any = process.env[name];
        if (!value || value === "") { value = defaultvalue; }
        return value;
    }
    public static get(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            var provider = http;
            if (url.startsWith('https')) {
                provider = https as any;
            }
            provider.get(url, (resp) => {
                let data = '';
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    resolve(data);
                });
            }).on("error", (err) => {
                reject(err);
            });
        })
    }
    public static async parse_federation_metadata(tls_ca: String, url: string): Promise<any> {
        // try {
        //     if (tls_ca !== null && tls_ca !== undefined && tls_ca !== "") {
        //         const rootCas = require('ssl-root-cas/latest').create();
        //         rootCas.push(tls_ca);
        //         // rootCas.addFile( tls_ca );
        //         https.globalAgent.options.ca = rootCas;
        //         require('https').globalAgent.options.ca = rootCas;
        //     }
        // } catch (error) {
        //     console.error(error);
        // }
        const metadata: any = await promiseRetry(async () => {
            // if (Config.saml_ignore_cert) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
            const data: string = await Config.get(url)
            // if (Config.saml_ignore_cert) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
            if (NoderedUtil.IsNullEmpty(data)) { throw new Error("Failed getting result"); }
            var xml = await xml2js.parseStringPromise(data);
            if (xml && xml.EntityDescriptor && xml.EntityDescriptor.IDPSSODescriptor && xml.EntityDescriptor.IDPSSODescriptor.length > 0) {
                // const reader: any = await fetch({ url });
                // if (NoderedUtil.IsNullUndefinded(reader)) { throw new Error("Failed getting result"); }
                // const _config: any = toPassportConfig(reader);
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
                // var signingCerts = IDPSSODescriptor.KeyDescriptor[0].KeyInfo[0].X509Data[0].X509Certificate;
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
    public static parseArray(s: string): string[] {
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