import { WebSocketClient, TokenUser, NoderedUtil } from "@openiap/openflow-api";

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
                const wsurl: string = data.wsurl;
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
                    const cli: WebSocketClient = new WebSocketClient(this.logger, wsurl);
                    cli.agent = "webapp";
                    cli.version = data.version;
                    cli.events.on('connect', () => {
                        this.logger.info('connected to ' + wsurl);
                        this.loadToken();
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
            if (data !== null && data !== undefined) {
                if (data.jwt === null || data.jwt === undefined || data.jwt.trim() === "") { data.jwt = null; }
                if (data.rawAssertion === null || data.rawAssertion === undefined || data.rawAssertion.trim() === "") { data.rawAssertion = null; }
                if (data.jwt === null && data.rawAssertion === null) {
                    console.debug("data.jwt and data.rawAssertion is null");
                    data = null;
                }
            }
            const _url = this.$location.absUrl();
            if (data === null || data === undefined) {
                if (this.$location.path() !== "/Login" && this.$location.path() !== "/Signup") {
                    // const _url = this.$location.absUrl();
                    // this.setCookie("weburl", _url, 365);
                    console.log('weburl', this.$location.path());
                    this.setCookie("weburl", this.$location.path(), 365);
                    this.$location.path("/Login");
                    this.$rootScope.$apply();
                }
                return;
            }
            try {
                const result = await NoderedUtil.SigninWithToken(data.jwt, data.rawAssertion, null);
                this.user = result.user;
                this.jwt = result.jwt;
                this.$rootScope.$broadcast("signin", result.user);
                const redirecturl = this.getCookie("weburl");
                if (!NoderedUtil.IsNullEmpty(redirecturl)) {
                    console.log('redirecturl', redirecturl);
                    this.deleteCookie("weburl");
                    this.$location.path(redirecturl);
                }
            } catch (error) {
                if (error == "User not validated, please login again") {
                    console.log('validateurl', this.$location.path());
                    this.setCookie("validateurl", this.$location.path(), 365);
                    setTimeout(() => {
                        top.location.href = '/login';
                        document.write('<script>top.location = "/login";</script>')
                    }, 500);
                }
                console.log(error);
                try {
                    document.write(error);
                    document.write("<br/><a href=\"/Signout\">Signout</a>");
                } catch (error) {

                }
            }
        });
    }
    async impersonate(userid: string) {
        const result = await NoderedUtil.SigninWithToken(this.jwt, null, userid);
        this.user = result.user;
        this.jwt = result.jwt;
        this.$rootScope.$broadcast("signin", result.user);
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

    onSignedin(callback) {
        if (this.user !== null) {
            callback(this.user);
            return;
        }
        const cleanup = this.$rootScope.$on('signin', (event, data) => {
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

