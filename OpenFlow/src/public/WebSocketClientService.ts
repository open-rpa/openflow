import { WebSocketClient, TokenUser, NoderedUtil } from "openflow-api";

interface IHashTable<T> {
    [key: string]: T;
}
export class WebSocketClientService {
    static $inject = ["$rootScope", "$location", "$window"];
    constructor(
        public $rootScope: ng.IRootScopeService,
        public $location,
        public $window: any
    ) {
        console.debug("WebSocketClientService::constructor");
        this.load();
    }
    load() {
        this.getJSON("/config", async (error: any, data: any) => {
            if (NoderedUtil.IsNullUndefinded(data)) {
                console.error("/config return null");
                return;
            }
            try {
                var wsurl: string = data.wsurl;
                this.version = data.version;
                this.domain = data.domain;
                this.version = data.version;
                this.allow_user_registration = data.allow_user_registration;

                this.allow_personal_nodered = data.allow_personal_nodered;
                this.auto_create_personal_nodered_group = data.auto_create_personal_nodered_group;
                this.namespace = data.namespace;
                this.nodered_domain_schema = data.nodered_domain_schema;
                this.websocket_package_size = data.websocket_package_size;
                this.stripe_api_key = data.stripe_api_key;

                if (WebSocketClient.instance == null) {
                    var cli: WebSocketClient;
                    cli = new WebSocketClient(this.logger, wsurl);
                    WebSocketClient.instance.version = data.version;
                }
                cli.events.on('connect', () => {
                    this.logger.info('connected to ' + wsurl);
                    this.loadToken();
                });
                cli.connect();
            } catch (error) {
                console.error(error);
            }
        });
    }
    loadToken() {
        WebSocketClient.instance.getJSON("/jwt", async (error: any, data: any) => {
            if (data !== null && data !== undefined) {
                if (data.jwt === null || data.jwt === undefined || data.jwt.trim() === "") { data.jwt = null; }
                if (data.rawAssertion === null || data.rawAssertion === undefined || data.rawAssertion.trim() === "") { data.rawAssertion = null; }
                if (data.jwt === null && data.rawAssertion === null) {
                    console.debug("data.jwt and data.rawAssertion is null");
                    data = null;
                }
            }
            var _url = this.$location.absUrl();
            if (data === null || data === undefined) {
                if (this.$location.path() !== "/Login" && this.$location.path() !== "/Signup") {
                    // var _url = this.$location.absUrl();
                    // this.setCookie("weburl", _url, 365);
                    console.log('weburl', this.$location.path());
                    this.setCookie("weburl", this.$location.path(), 365);
                    this.$location.path("/Login");
                    this.$rootScope.$apply();
                }
                return;
            }
            var result = await NoderedUtil.SigninWithToken(data.jwt, data.rawAssertion, null);
            this.user = result.user;
            this.jwt = result.jwt;
            this.$rootScope.$broadcast("signin", result.user);
            var redirecturl = this.getCookie("weburl");
            if (!NoderedUtil.IsNullEmpty(redirecturl)) {
                console.log('redirecturl', redirecturl);
                this.deleteCookie("weburl");
                this.$location.path(redirecturl);
            }
        });
    }
    async impersonate(userid: string) {
        var result = await NoderedUtil.SigninWithToken(this.jwt, null, userid);
        this.user = result.user;
        this.jwt = result.jwt;
        this.$rootScope.$broadcast("signin", result.user);
    }
    setCookie(cname, cvalue, exdays) {
        var d = new Date();
        d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
        var expires = "expires=" + d.toUTCString();
        document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
    }
    getCookie(cname) {
        var name = cname + "=";
        var decodedCookie = decodeURIComponent(document.cookie);
        var ca = decodedCookie.split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
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
        debug(msg) { console.debug(msg); }
    }
    public user: TokenUser = null;
    public jwt: string = null;
    public version: string = "";
    public messageQueue: IHashTable<QueuedMessage> = {};
    public usingCordova: boolean = false;
    public connected: boolean = false;
    public domain: string = "";
    public allow_user_registration: boolean = false;
    public allow_personal_nodered: boolean = false;
    public auto_create_personal_nodered_group: boolean = false;
    public namespace: string = "";
    public nodered_domain_schema: string = "";
    public websocket_package_size: number = 4096;
    public stripe_api_key: string = "";

    getJSON(url: string, callback: any): void {
        var xhr: XMLHttpRequest = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "json";
        xhr.onload = function (): void {
            var status: number = xhr.status;
            if (status === 200) {
                callback(null, xhr.response);
            } else {
                callback(status, xhr.response);
            }
        };
        xhr.send();
    }

    onSignedin(callback) {
        if (this.user !== null) {
            callback(this.user);
            return;
        }
        var cleanup = this.$rootScope.$on('signin', (event, data) => {
            if (event && data) { }
            cleanup();
            callback(this.user);
        });
    }
    onConnected(callback) {
        if (this.connected) {
            callback();
            return;
        }
        var cleanup = this.$rootScope.$on('socketopen', (event, data) => {
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

