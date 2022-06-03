import { fetch, toPassportConfig } from "passport-saml-metadata";
import * as fs from "fs";
import * as path from "path";
import { DatabaseConnection } from "./DatabaseConnection";
// import { Logger } from "./Logger";
import { NoderedUtil } from "@openiap/openflow-api";
import { promiseRetry } from "./Logger";
export class Config {
    public static getversion(): string {
        let versionfile: string = path.join(__dirname, "VERSION");
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "VERSION")
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "..", "VERSION")
        if (!fs.existsSync(versionfile)) versionfile = path.join(__dirname, "..", "..", "..", "VERSION")
        Config.version = (fs.existsSync(versionfile) ? fs.readFileSync(versionfile, "utf8") : "0.0.1");
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
        Config.logpath = Config.getEnv("logpath", __dirname);
        Config.log_with_colors = Config.parseBoolean(Config.getEnv("log_with_colors", "true"));
        Config.log_cache = Config.parseBoolean(Config.getEnv("log_cache", "true"));
        Config.log_amqp = Config.parseBoolean(Config.getEnv("log_amqp", "true"));
        Config.log_login_provider = Config.parseBoolean(Config.getEnv("log_login_provider", "false"));
        Config.log_websocket = Config.parseBoolean(Config.getEnv("log_websocket", "false"));
        Config.log_oauth = Config.parseBoolean(Config.getEnv("log_oauth", "false"));
        Config.log_webserver = Config.parseBoolean(Config.getEnv("log_webserver", "false"));
        Config.log_database = Config.parseBoolean(Config.getEnv("log_database", "false"));
        Config.log_grafana = Config.parseBoolean(Config.getEnv("log_grafana", "false"));
        Config.log_otel = Config.parseBoolean(Config.getEnv("log_otel", "false"));
        Config.log_information = Config.parseBoolean(Config.getEnv("log_information", "true"));
        Config.log_debug = Config.parseBoolean(Config.getEnv("log_debug", "false"));
        Config.log_verbose = Config.parseBoolean(Config.getEnv("log_verbose", "false"));
        Config.log_silly = Config.parseBoolean(Config.getEnv("log_silly", "false"));

        Config.amqp_allow_replyto_empty_queuename = Config.parseBoolean(Config.getEnv("amqp_allow_replyto_empty_queuename", "false"));

        Config.openflow_uniqueid = Config.getEnv("openflow_uniqueid", "");
        Config.enable_openflow_amqp = Config.parseBoolean(Config.getEnv("enable_openflow_amqp", "false"));
        Config.openflow_amqp_expiration = parseInt(Config.getEnv("openflow_amqp_expiration", (60 * 1000 * 25).toString())); // 25 min
        Config.amqp_prefetch = parseInt(Config.getEnv("amqp_prefetch", "50"));
        Config.enable_entity_restriction = Config.parseBoolean(Config.getEnv("enable_entity_restriction", "false"));
        Config.enable_web_tours = Config.parseBoolean(Config.getEnv("enable_web_tours", "true"));
        Config.auto_hourly_housekeeping = Config.parseBoolean(Config.getEnv("auto_hourly_housekeeping", "false"));
        Config.housekeeping_update_usage_hourly = Config.parseBoolean(Config.getEnv("housekeeping_update_usage_hourly", "false"));
        Config.housekeeping_update_usersize_hourly = Config.parseBoolean(Config.getEnv("housekeeping_update_usersize_hourly", "true"));
        Config.housekeeping_skip_collections = Config.getEnv("housekeeping_skip_collections", "");
        Config.workitem_queue_monitoring_enabled = Config.parseBoolean(Config.getEnv("workitem_queue_monitoring_enabled", "true"));
        Config.workitem_queue_monitoring_interval = parseInt(Config.getEnv("workitem_queue_monitoring_interval", (30 * 1000).toString())); // 30 sec


        Config.getting_started_url = Config.getEnv("getting_started_url", "");

        Config.NODE_ENV = Config.getEnv("NODE_ENV", "development");
        Config.HTTP_PROXY = Config.getEnv("HTTP_PROXY", "");
        Config.HTTPS_PROXY = Config.getEnv("HTTPS_PROXY", "");
        Config.NO_PROXY = Config.getEnv("NO_PROXY", "");

        Config.stripe_api_key = Config.getEnv("stripe_api_key", "");
        Config.stripe_api_secret = Config.getEnv("stripe_api_secret", "");
        Config.stripe_force_vat = Config.parseBoolean(Config.getEnv("stripe_force_vat", "false"));
        Config.stripe_force_checkout = Config.parseBoolean(Config.getEnv("stripe_force_checkout", "true"));

        Config.supports_watch = Config.parseBoolean(Config.getEnv("supports_watch", "false"));
        Config.ensure_indexes = Config.parseBoolean(Config.getEnv("ensure_indexes", "true"));

        Config.auto_create_users = Config.parseBoolean(Config.getEnv("auto_create_users", "false"));
        Config.auto_create_user_from_jwt = Config.parseBoolean(Config.getEnv("auto_create_user_from_jwt", "false"));
        Config.auto_create_domains = Config.parseArray(Config.getEnv("auto_create_domains", ""));
        Config.persist_user_impersonation = Config.parseBoolean(Config.getEnv("persist_user_impersonation", "true"));
        Config.ping_clients_interval = parseInt(Config.getEnv("ping_clients_interval", (10000).toString())); // 12 seconds
        Config.allow_personal_nodered = Config.parseBoolean(Config.getEnv("allow_personal_nodered", "false"));
        Config.use_ingress_beta1_syntax = Config.parseBoolean(Config.getEnv("use_ingress_beta1_syntax", "true"));
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
        Config.socket_rate_limit_points_disconnect = parseInt(Config.getEnv("socket_rate_limit_points_disconnect", "600"));
        Config.socket_rate_limit_duration = parseInt(Config.getEnv("socket_rate_limit_duration", "1"));
        Config.socket_error_rate_limit_points = parseInt(Config.getEnv("socket_error_rate_limit_points", "16"));
        Config.socket_error_rate_limit_duration = parseInt(Config.getEnv("socket_error_rate_limit_duration", "2"));

        Config.client_heartbeat_timeout = parseInt(Config.getEnv("client_heartbeat_timeout", "60"));

        Config.expected_max_roles = parseInt(Config.getEnv("expected_max_roles", "4000"));
        Config.decorate_roles_fetching_all_roles = Config.parseBoolean(Config.getEnv("decorate_roles_fetching_all_roles", "true"));
        Config.update_acl_based_on_groups = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups", "false"));
        Config.multi_tenant = Config.parseBoolean(Config.getEnv("multi_tenant", "false"));
        Config.api_bypass_perm_check = Config.parseBoolean(Config.getEnv("api_bypass_perm_check", "false"));
        Config.websocket_package_size = parseInt(Config.getEnv("websocket_package_size", "4096"), 10);
        Config.websocket_max_package_count = parseInt(Config.getEnv("websocket_max_package_count", "1024"), 10);
        Config.protocol = Config.getEnv("protocol", "http"); // used by personal nodered and baseurl()
        Config.port = parseInt(Config.getEnv("port", "3000"));
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

        Config.skip_history_collections = Config.getEnv("skip_history_collections", "");
        Config.history_delta_count = parseInt(Config.getEnv("history_delta_count", "1000"));
        Config.allow_skiphistory = Config.parseBoolean(Config.getEnv("allow_skiphistory", "true"));

        Config.saml_issuer = Config.getEnv("saml_issuer", "the-issuer"); // define uri of STS, also sent to personal nodereds
        Config.aes_secret = Config.getEnv("aes_secret", "");
        Config.signing_crt = Config.getEnv("signing_crt", "");
        Config.singing_key = Config.getEnv("singing_key", "");
        Config.shorttoken_expires_in = Config.getEnv("shorttoken_expires_in", "5m");
        Config.longtoken_expires_in = Config.getEnv("longtoken_expires_in", "365d");
        Config.downloadtoken_expires_in = Config.getEnv("downloadtoken_expires_in", "15m");
        Config.personalnoderedtoken_expires_in = Config.getEnv("personalnoderedtoken_expires_in", "365d");

        Config.nodered_images = JSON.parse(Config.getEnv("nodered_images", "[{\"name\":\"Latest Plain Nodered\", \"image\":\"openiap/nodered\"}]"));
        Config.saml_federation_metadata = Config.getEnv("saml_federation_metadata", "");
        Config.api_ws_url = Config.getEnv("api_ws_url", "");
        Config.nodered_ws_url = Config.getEnv("nodered_ws_url", "");
        Config.nodered_saml_entrypoint = Config.getEnv("nodered_saml_entrypoint", "");
        Config.nodered_docker_entrypoints = Config.getEnv("nodered_docker_entrypoints", "web");
        Config.nodered_docker_certresolver = Config.getEnv("nodered_docker_certresolver", "");
        Config.namespace = Config.getEnv("namespace", ""); // also sent to website 
        Config.nodered_domain_schema = Config.getEnv("nodered_domain_schema", ""); // also sent to website
        Config.nodered_initial_liveness_delay = parseInt(Config.getEnv("nodered_initial_liveness_delay", "60"));
        Config.nodered_allow_nodeselector = Config.parseBoolean(Config.getEnv("nodered_allow_nodeselector", "false"));
        Config.nodered_requests_memory = Config.getEnv("nodered_requests_memory", "");
        Config.nodered_requests_cpu = Config.getEnv("nodered_requests_cpu", ""); // 1000m = 1vCPU
        Config.nodered_limits_memory = Config.getEnv("nodered_limits_memory", "");
        Config.nodered_limits_cpu = Config.getEnv("nodered_limits_cpu", ""); // 1000m = 1vCPU

        Config.nodered_liveness_failurethreshold = parseInt(Config.getEnv("nodered_liveness_failurethreshold", "5"));
        Config.nodered_liveness_timeoutseconds = parseInt(Config.getEnv("nodered_liveness_timeoutseconds", "5"));
        Config.noderedcatalogues = Config.getEnv("noderedcatalogues", "");

        Config.prometheus_measure_nodeid = Config.parseBoolean(Config.getEnv("prometheus_measure_nodeid", "false"));
        Config.prometheus_measure_queued_messages = Config.parseBoolean(Config.getEnv("prometheus_measure_queued_messages", "false"));
        Config.prometheus_measure__mongodb_watch = Config.parseBoolean(Config.getEnv("prometheus_measure__mongodb_watch", "false"));
        Config.prometheus_measure_onlineuser = Config.parseBoolean(Config.getEnv("prometheus_measure_onlineuser", "false"));
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
        Config.otel_trace_include_query = Config.parseBoolean(Config.getEnv("otel_trace_include_query", "true"));
    
        Config.validate_user_form = Config.getEnv("validate_user_form", "");
    }
    public static unittesting: boolean = false;
    public static db: DatabaseConnection = null;
    public static license_key: string = Config.getEnv("license_key", "");
    public static version: string = Config.getversion();
    public static logpath: string = Config.getEnv("logpath", __dirname);
    public static log_with_colors: boolean = Config.parseBoolean(Config.getEnv("log_with_colors", "true"));
    public static log_cache: boolean = Config.parseBoolean(Config.getEnv("log_cache", "false"));
    public static log_amqp: boolean = Config.parseBoolean(Config.getEnv("log_amqp", "true"));
    public static log_login_provider: boolean = Config.parseBoolean(Config.getEnv("log_login_provider", "false"));
    public static log_with_trace: boolean = Config.parseBoolean(Config.getEnv("log_with_trace", "false"));
    public static log_websocket: boolean = Config.parseBoolean(Config.getEnv("log_websocket", "false"));
    public static log_oauth: boolean = Config.parseBoolean(Config.getEnv("log_oauth", "false"));
    public static log_webserver: boolean = Config.parseBoolean(Config.getEnv("log_webserver", "false"));
    public static log_database: boolean = Config.parseBoolean(Config.getEnv("log_database", "false"));
    public static log_grafana: boolean = Config.parseBoolean(Config.getEnv("log_grafana", "false"));
    public static log_otel: boolean = Config.parseBoolean(Config.getEnv("log_otel", "false"));
    public static log_information: boolean = Config.parseBoolean(Config.getEnv("log_information", "true"));
    public static log_debug: boolean = Config.parseBoolean(Config.getEnv("log_debug", "false"));
    public static log_verbose: boolean = Config.parseBoolean(Config.getEnv("log_verbose", "false"));
    public static log_silly: boolean = Config.parseBoolean(Config.getEnv("log_silly", "false"));

    public static amqp_allow_replyto_empty_queuename: boolean = Config.parseBoolean(Config.getEnv("amqp_allow_replyto_empty_queuename", "false"));

    public static openflow_uniqueid: string = Config.getEnv("openflow_uniqueid", "");
    public static enable_openflow_amqp: boolean = Config.parseBoolean(Config.getEnv("enable_openflow_amqp", "false"));
    public static openflow_amqp_expiration: number = parseInt(Config.getEnv("openflow_amqp_expiration", (60 * 1000 * 25).toString())); // 25 min
    public static amqp_prefetch: number = parseInt(Config.getEnv("amqp_prefetch", "50"));
    public static enable_entity_restriction: boolean = Config.parseBoolean(Config.getEnv("enable_entity_restriction", "false"));
    public static enable_web_tours: boolean = Config.parseBoolean(Config.getEnv("enable_web_tours", "true"));
    public static auto_hourly_housekeeping: boolean = Config.parseBoolean(Config.getEnv("auto_hourly_housekeeping", "true"));
    public static housekeeping_update_usage_hourly: boolean = Config.parseBoolean(Config.getEnv("housekeeping_update_usage_hourly", "false"));
    public static housekeeping_update_usersize_hourly: boolean = Config.parseBoolean(Config.getEnv("housekeeping_update_usersize_hourly", "true"));
    public static housekeeping_skip_collections: string = Config.getEnv("housekeeping_skip_collections", "");
    public static workitem_queue_monitoring_enabled: boolean = Config.parseBoolean(Config.getEnv("workitem_queue_monitoring_enabled", "true"));
    public static workitem_queue_monitoring_interval: number = parseInt(Config.getEnv("workitem_queue_monitoring_interval", (30 * 1000).toString())); // 30 sec

    public static upload_max_filesize_mb: number = parseInt(Config.getEnv("upload_max_filesize_mb", "25"));

    public static getting_started_url: string = Config.getEnv("getting_started_url", "");

    public static NODE_ENV: string = Config.getEnv("NODE_ENV", "development");
    public static HTTP_PROXY: string = Config.getEnv("HTTP_PROXY", "");
    public static HTTPS_PROXY: string = Config.getEnv("HTTPS_PROXY", "");
    public static NO_PROXY: string = Config.getEnv("NO_PROXY", "");

    public static stripe_api_key: string = Config.getEnv("stripe_api_key", "");
    public static stripe_api_secret: string = Config.getEnv("stripe_api_secret", "");
    public static stripe_force_vat: boolean = Config.parseBoolean(Config.getEnv("stripe_force_vat", "false"));
    public static stripe_force_checkout: boolean = Config.parseBoolean(Config.getEnv("stripe_force_checkout", "false"));

    public static supports_watch: boolean = Config.parseBoolean(Config.getEnv("supports_watch", "false"));
    public static ensure_indexes: boolean = Config.parseBoolean(Config.getEnv("ensure_indexes", "true"));

    public static auto_create_users: boolean = Config.parseBoolean(Config.getEnv("auto_create_users", "false"));
    public static auto_create_user_from_jwt: boolean = Config.parseBoolean(Config.getEnv("auto_create_user_from_jwt", "false"));
    public static auto_create_domains: string[] = Config.parseArray(Config.getEnv("auto_create_domains", ""));
    public static persist_user_impersonation: boolean = Config.parseBoolean(Config.getEnv("persist_user_impersonation", "true"));
    public static ping_clients_interval: number = parseInt(Config.getEnv("ping_clients_interval", (10000).toString())); // 12 seconds

    public static allow_personal_nodered: boolean = Config.parseBoolean(Config.getEnv("allow_personal_nodered", "false"));
    public static use_ingress_beta1_syntax: boolean = Config.parseBoolean(Config.getEnv("use_ingress_beta1_syntax", "true"));
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
    public static socket_rate_limit_points_disconnect: number = parseInt(Config.getEnv("socket_rate_limit_points_disconnect", "600"));
    public static socket_rate_limit_duration: number = parseInt(Config.getEnv("socket_rate_limit_duration", "1"));
    public static socket_error_rate_limit_points: number = parseInt(Config.getEnv("socket_error_rate_limit_points", "30"));
    public static socket_error_rate_limit_duration: number = parseInt(Config.getEnv("socket_error_rate_limit_duration", "1"));

    public static client_heartbeat_timeout: number = parseInt(Config.getEnv("client_heartbeat_timeout", "60"));

    public static expected_max_roles: number = parseInt(Config.getEnv("expected_max_roles", "20000"));
    public static decorate_roles_fetching_all_roles = Config.parseBoolean(Config.getEnv("decorate_roles_fetching_all_roles", "true"));
    public static max_recursive_group_depth: number = parseInt(Config.getEnv("max_recursive_group_depth", "2"));
    public static update_acl_based_on_groups: boolean = Config.parseBoolean(Config.getEnv("update_acl_based_on_groups", "false"));
    public static multi_tenant: boolean = Config.parseBoolean(Config.getEnv("multi_tenant", "false"));
    public static api_bypass_perm_check: boolean = Config.parseBoolean(Config.getEnv("api_bypass_perm_check", "false"));
    public static websocket_package_size: number = parseInt(Config.getEnv("websocket_package_size", "4096"), 10);
    public static websocket_max_package_count: number = parseInt(Config.getEnv("websocket_max_package_count", "1024"), 10);
    public static websocket_disconnect_out_of_sync: boolean = Config.parseBoolean(Config.getEnv("websocket_disconnect_out_of_sync", "false"));
    public static protocol: string = Config.getEnv("protocol", "http"); // used by personal nodered and baseurl()
    public static port: number = parseInt(Config.getEnv("port", "3000"));
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

    public static skip_history_collections: string = Config.getEnv("skip_history_collections", "");
    public static history_delta_count: number = parseInt(Config.getEnv("history_delta_count", "1000"));
    public static allow_skiphistory: boolean = Config.parseBoolean(Config.getEnv("allow_skiphistory", "true"));

    public static saml_issuer: string = Config.getEnv("saml_issuer", "the-issuer"); // define uri of STS, also sent to personal nodereds
    public static aes_secret: string = Config.getEnv("aes_secret", "");
    public static signing_crt: string = Config.getEnv("signing_crt", "");
    public static singing_key: string = Config.getEnv("singing_key", "");
    public static shorttoken_expires_in: string = Config.getEnv("shorttoken_expires_in", "5m");
    public static longtoken_expires_in: string = Config.getEnv("longtoken_expires_in", "365d");
    public static downloadtoken_expires_in: string = Config.getEnv("downloadtoken_expires_in", "15m");
    public static personalnoderedtoken_expires_in: string = Config.getEnv("personalnoderedtoken_expires_in", "365d");

    // public static nodered_image: string = Config.getEnv("nodered_image", "openiap/nodered");
    public static nodered_images: NoderedImage[] = JSON.parse(Config.getEnv("nodered_images", "[{\"name\":\"Latest Plain Nodered\", \"image\":\"openiap/nodered\"}]"));
    public static saml_federation_metadata: string = Config.getEnv("saml_federation_metadata", "");
    public static api_ws_url: string = Config.getEnv("api_ws_url", "");
    public static nodered_ws_url: string = Config.getEnv("nodered_ws_url", "");
    public static nodered_saml_entrypoint: string = Config.getEnv("nodered_saml_entrypoint", "");

    public static nodered_docker_entrypoints: string = Config.getEnv("nodered_docker_entrypoints", "web");
    public static nodered_docker_certresolver: string = Config.getEnv("nodered_docker_certresolver", "");

    public static namespace: string = Config.getEnv("namespace", ""); // also sent to website 
    public static nodered_domain_schema: string = Config.getEnv("nodered_domain_schema", ""); // also sent to website
    public static nodered_initial_liveness_delay: number = parseInt(Config.getEnv("nodered_initial_liveness_delay", "60"));
    public static nodered_allow_nodeselector: boolean = Config.parseBoolean(Config.getEnv("nodered_allow_nodeselector", "false"));
    public static nodered_requests_memory: string = Config.getEnv("nodered_requests_memory", "");
    public static nodered_requests_cpu: string = Config.getEnv("nodered_requests_cpu", ""); // 1000m = 1vCPU
    public static nodered_limits_memory: string = Config.getEnv("nodered_limits_memory", "");
    public static nodered_limits_cpu: string = Config.getEnv("nodered_limits_cpu", ""); // 1000m = 1vCPU
    public static nodered_liveness_failurethreshold: number = parseInt(Config.getEnv("nodered_liveness_failurethreshold", "5"));
    public static nodered_liveness_timeoutseconds: number = parseInt(Config.getEnv("nodered_liveness_timeoutseconds", "5"));
    public static noderedcatalogues: string = Config.getEnv("noderedcatalogues", "");

    public static prometheus_measure_nodeid: boolean = Config.parseBoolean(Config.getEnv("prometheus_measure_nodeid", "false"));
    public static prometheus_measure_queued_messages: boolean = Config.parseBoolean(Config.getEnv("prometheus_measure_queued_messages", "false"));
    public static prometheus_measure__mongodb_watch: boolean = Config.parseBoolean(Config.getEnv("prometheus_measure__mongodb_watch", "false"));
    public static prometheus_measure_onlineuser: boolean = Config.parseBoolean(Config.getEnv("prometheus_measure_onlineuser", "false"));
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
    

    public static validate_user_form: string = Config.getEnv("validate_user_form", "");

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
    public static async parse_federation_metadata(url: string): Promise<any> {
        // if anything throws, we retry
        return promiseRetry(async () => {
            const reader: any = await fetch({ url });
            if (NoderedUtil.IsNullUndefinded(reader)) { throw new Error("Failed getting result"); return; }
            const config: any = toPassportConfig(reader);
            // we need this, for Office 365 :-/
            if (reader.signingCerts && reader.signingCerts.length > 1) {
                config.cert = reader.signingCerts;
            }
            return config;
        }, 10, 1000);
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