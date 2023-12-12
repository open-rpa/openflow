import { WebSocketClient, TokenUser, NoderedUtil, Customer } from "@openiap/openflow-api";

interface IHashTable<T> {
    [key: string]: T;
}
declare type onSignedinCallback = (user: TokenUser) => void;
export class WebSocketClientService {
    static $inject = ["$rootScope", "$location", "$window"];
    constructor(
        public $rootScope: ng.IRootScopeService,
        public $location,
        public $window: any
    ) {
        this.load();
    }
    load() {
        this.getJSON("/config", async (error: any, data: any) => {
            if (NoderedUtil.IsNullUndefinded(data)) {
                return;
            }
            try {
                const wsurl: string = data.wsurl;
                this.wsurl = data.wsurl;
                this.version = data.version;
                this.domain = data.domain;
                this.version = data.version;
                this.allow_user_registration = data.allow_user_registration;

                this.auto_create_personal_nodered_group = data.auto_create_personal_nodered_group;
                this.namespace = data.namespace;
                this.agent_domain_schema = data.agent_domain_schema;
                
                this.websocket_package_size = data.websocket_package_size;
                this.stripe_api_key = data.stripe_api_key;
                this.validate_user_form = data.validate_user_form;
                this.validate_emails = data.validate_emails;
                this.forgot_pass_emails = data.forgot_pass_emails;
                this.multi_tenant = data.multi_tenant;

                this.agent_images = data.agent_images;
                this.enable_entity_restriction = data.enable_entity_restriction;
                this.enable_web_tours = data.enable_web_tours;
                this.enable_nodered_tours = data.enable_nodered_tours;

                this.forceddomains = data.forceddomains;

                if (data.collections_with_text_index) this.collections_with_text_index = data.collections_with_text_index;
                if (data.timeseries_collections) this.timeseries_collections = data.timeseries_collections;

                this.ping_clients_interval = data.ping_clients_interval;
                this.validlicense = data.validlicense;
                this.grafana_url = data.grafana_url
                this.llmchat_queue = data.llmchat_queue


                if (NoderedUtil.IsNullUndefinded(WebSocketClient.instance)) {
                    const cli: WebSocketClient = new WebSocketClient(this.logger, wsurl);
                    cli.agent = "webapp";
                    cli.version = data.version;
                    cli.events.on('connect', () => {
                        this.logger.info('connected to ' + wsurl);
                        this.loadToken();
                    });
                    cli.events.on('refreshtoken', (user) => {
                        this.$rootScope.$broadcast("refreshtoken", user);
                    });
                    cli.connect();
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
    loadToken() {
        WebSocketClient.instance.getJSON("/jwt", async (error: any, data: any) => {
            if (!NoderedUtil.IsNullUndefinded(data)) {
                if (NoderedUtil.IsNullUndefinded(data.jwt) || data.jwt.trim() === "") { data.jwt = null; }
                if (NoderedUtil.IsNullUndefinded(data.rawAssertion) || data.rawAssertion.trim() === "") { data.rawAssertion = null; }
                if (NoderedUtil.IsNullUndefinded(data.jwt)) {
                    data = null;
                }
            }
            const _url = this.$location.absUrl();
            if (NoderedUtil.IsNullUndefinded(data)) {
                if (this.$location.path() !== "/Login" && this.$location.path() !== "/Signup") {
                    // const _url = this.$location.absUrl();
                    // this.setCookie("weburl", _url, 365);
                    this.setCookie("weburl", this.$location.path(), 365);
                    this.$location.path("/Login");
                    this.$rootScope.$apply();
                }
                return;
            }
            try {
                const result = await NoderedUtil.SigninWithToken({ jwt: data.jwt, rawAssertion: data.rawAssertion });
                // @ts-ignore
                if(result == null || (result.message && result.message.includes("not validated")) || result.user == null) {
                    this.setCookie("validateurl", this.$location.path(), 365);
                    setTimeout(() => {
                        top.location.href = '/login';
                        document.write('<script>top.location = "/login";</script>')
                    }, 500);
                    try {
                        document.write(error);
                        document.write("<br/><a href=\"/Signout\">Signout</a>");
                    } catch (error) {
    
                    }
                    return;
                }

                this.customer = null;
                if (!NoderedUtil.IsNullUndefinded(WebSocketClient.instance.user) && !NoderedUtil.IsNullEmpty(WebSocketClient.instance.user.selectedcustomerid)) {
                    const customers = await NoderedUtil.Query({ collectionname: "users", query: { _type: "customer", "$or": [{ "_id": WebSocketClient.instance.user.selectedcustomerid }, { "_id": WebSocketClient.instance.user.customerid }] } });
                    if (customers && customers.length > 0 && (WebSocketClient.instance.user.selectedcustomerid != null)) {
                        if (WebSocketClient.instance.user.selectedcustomerid != null) {
                            for (let cust of customers)
                                if (cust._id == WebSocketClient.instance.user.selectedcustomerid) this.customer = cust;
                        }
                    }
                }

                this.$rootScope.$broadcast("signin", result.user);
                const redirecturl = this.getCookie("weburl");
                if (!NoderedUtil.IsNullEmpty(redirecturl)) {
                    this.deleteCookie("weburl");
                    this.$location.path(redirecturl);
                }
            } catch (error) {
                if (error == "User not validated, please login again") {
                    this.setCookie("validateurl", this.$location.path(), 365);
                    setTimeout(() => {
                        top.location.href = '/login';
                        document.write('<script>top.location = "/login";</script>')
                    }, 500);
                }
                console.error(error);
                try {
                    document.write(error);
                    document.write("<br/><a href=\"/Signout\">Signout</a>");
                } catch (error) {

                }
            }
        });
    }
    async impersonate(userid: string) {
        try {
            const result = await NoderedUtil.SigninWithToken({ jwt: WebSocketClient.instance.jwt, impersonate: userid });
            this.$rootScope.$broadcast("signin", result.user);
        } catch (error) {
            console.error(error);
        }
    }
    setCookie(cname, cvalue, exdays) {
        const d = new Date();
        d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
        const expires = "expires=" + d.toUTCString();
        document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
    }
    getCookie(cname) {
        const name = cname + "=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length, c.length);
            }
        }
        return "";
    }
    deleteCookie(cname) {
        document.cookie = cname + "=;Thu, 01 Jan 1970 00:00:00 UTC;path=/";
    }
    private logger: any = {
        info(msg) { console.log(msg); },
        verbose(msg) { console.debug(msg); },
        error(msg) { console.error(msg); },
        debug(msg) { console.debug(msg); },
        silly(msg) { console.debug(msg); }
    }
    public customer: Customer = null;
    // public user: TokenUser = null;
    // public jwt: string = null;
    public version: string = "";
    public wsurl: string = "";
    public messageQueue: IHashTable<QueuedMessage> = {};
    public usingCordova: boolean = false;
    public connected: boolean = false;
    public domain: string = "";
    public allow_user_registration: boolean = false;
    public auto_create_personal_nodered_group: boolean = false;
    public namespace: string = "";
    public agent_domain_schema: string = "";
    public websocket_package_size: number = 25000;
    public stripe_api_key: string = "";
    public validate_user_form: string = "";
    public validate_emails: boolean = false;
    public forgot_pass_emails: boolean = false;
    public agent_images: nodered_image[];
    public multi_tenant: boolean;
    public enable_entity_restriction: boolean;
    public enable_web_tours: boolean;
    public enable_nodered_tours: boolean;
    public forceddomains: string[] = [];
    public collections_with_text_index: string[] = [];
    public timeseries_collections: string[] = [];
    public ping_clients_interval: number = 10000;
    public validlicense: boolean = false;
    public grafana_url: string = "";
    public llmchat_queue: string = "";

    getJSON(url: string, callback: any): void {
        const xhr: XMLHttpRequest = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "json";
        xhr.onload = function (): void {
            const status: number = xhr.status;
            if (status === 200) {
                callback(null, xhr.response);
            } else {
                callback(status, xhr.response);
            }
        };
        xhr.send();
    }
    public onSignedin(callback: onSignedinCallback) {
        if (!NoderedUtil.IsNullUndefinded(WebSocketClient.instance) && !NoderedUtil.IsNullUndefinded(WebSocketClient.instance.user)) {
            callback(WebSocketClient.instance.user);
            return;
        }
        const cleanup = this.$rootScope.$on('signin', (event, data) => {
            if (event && data) { }
            cleanup();
            callback(WebSocketClient.instance.user);
        });
    }
    onConnected(callback) {
        if (this.connected) {
            callback();
            return;
        }
        const cleanup = this.$rootScope.$on('socketopen', (event, data) => {
            if (event && data) { }
            cleanup();
            callback();
        });
    }

}
export type QueuedMessageCallback = (msg: any) => any;
export type QueuedMessageStatusCallback = (msg: any, index: number, count: number) => any;
export class QueuedMessage {
    constructor(message: any, cb: QueuedMessageCallback, status: QueuedMessageStatusCallback) {
        this.id = message.id;
        this.message = message;
        this.cb = cb;
        this.status = status;
    }
    public cb: QueuedMessageCallback;
    public status: QueuedMessageStatusCallback;
    public id: string;
    public message: any;
}
export class nodered_image {
    public name: string;
    public image: string;
}
