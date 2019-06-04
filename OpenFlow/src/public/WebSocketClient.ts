/// <reference path='ReconnectingWebSocket.ts' />
module openflow {
    "use strict";
    interface IHashTable<T> {
        [key: string]: T;
    }
    // export interface WebAppInterface {
    //     getFirebaseToken(): any;
    //     getOneSignalRegisteredId(): any;
    //     isProductPurchased(): any;
    //     showLoader(): void;
    //     hideLoader(): void;
    //     rateApp(): void;
    //     playSound(file: string): void;
    //     createNotification(displayname: string, message: string): void;

    // }
    // export declare var android: WebAppInterface;
    declare var cordova: any;
    declare var device: any;

    type QueuedMessageCallback = (msg: any) => any;
    export class QueuedMessage {
        constructor(message: any, cb: QueuedMessageCallback) {
            this.id = message.id;
            this.message = message;
            this.cb = cb;
        }
        public cb: QueuedMessageCallback;
        public id: string;
        public message: any;
    }
    export class WebSocketClient {
        private _socketObject: ReconnectingWebSocket = null;
        private _url: string = null;
        private static instance: WebSocketClient = null;
        private _receiveQueue: SocketMessage[] = [];
        private _sendQueue: SocketMessage[] = [];
        public user: TokenUser = null;
        public jwt: string = null;
        public device: any = null;
        public usingCordova: boolean = false;
        public oneSignalId: string = null;
        static $inject = ["$rootScope", "$location", "$window"];
        public messageQueue: IHashTable<QueuedMessage> = {};
        constructor(public $rootScope: ng.IRootScopeService, public $location, public $window: any) {
            try {
                var path = this.$location.absUrl().split('#')[0];
                this.usingCordova = (path.indexOf("/android/") > -1 || path.indexOf("/ios/") > -1);
            } catch (error) {
            }
            this.init();
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
        onbackbutton() {
            console.log("Handle the onbackbutton event");
        }

        onPause() {
            console.log("Handle the pause event");
        }

        onResume() {
            console.log("Handle the resume event");
        }

        onMenuKeyDown() {
            console.log("Handle the menubutton event");
        }
        getids(oneSignal: any): Promise<string> {
            return new Promise<string>(async (resolve, reject) => {
                oneSignal.getIds(function (ids) {
                    resolve(ids.userId);
                    console.log(ids.userId);
                });
            });
        }
        init() {
            this.getJSON("/config", async (error: any, data: any) => {
                console.debug("WebSocketClient::onopen: connecting to " + data.wshost);
                this._socketObject = new ReconnectingWebSocket(data.wshost);
                this._socketObject.onopen = (this.onopen).bind(this);
                this._socketObject.onmessage = (this.onmessage).bind(this);
                this._socketObject.onclose = (this.onclose).bind(this);
                this._socketObject.onerror = (this.onerror).bind(this);
                WebSocketClient.instance = this;
            });
        }
        notificationOpenedCallback(state) {
            console.debug("notificationOpenedCallback");
            console.debug(JSON.stringify(state));
            //console.log(state);
        }
        notificationReceivedCallback(state) {
            console.debug("notificationReceivedCallback");
            console.debug(JSON.stringify(state));
            if (state.isAppInFocus) {
                window.location.href = state.payload.additionalData.URL;
                return;
            }
            // {"isAppInFocus":true,"shown":true,"androidNotificationId":-1616162934,"displayType":0,"payload":{"notificationID":"aee1f7a2-2108-489d-a401-86dba6a1ad99","body":"Android 2019-06-02T20:58:25.876Z","additionalData":{"URL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8"},"launchURL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8","lockScreenVisibility":1,"fromProjectNumber":"906036108091","priority":0,"rawPayload":"{\"google.delivered_priority\":\"normal\",\"google.sent_time\":1559509106669,\"google.ttl\":259200,\"google.original_priority\":\"normal\",\"custom\":\"{\\\"a\\\":{\\\"URL\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\"},\\\"u\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\",\\\"i\\\":\\\"aee1f7a2-2108-489d-a401-86dba6a1ad99\\\"}\",\"from\":\"906036108091\",\"alert\":\"Android 2019-06-02T20:58:25.876Z\",\"google.message_id\":\"0:1559509106674108%6c875f80f9fd7ecd\",\"notificationId\":-1616162934}"}}
            //console.log(state);
        }

        public connect(): void {
        }
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
        private async onopen(evt: Event): Promise<void> {
            console.log("WebSocketClient::onopen: connected");
            console.log("this.usingCordova: " + this.usingCordova);
            if (!this.usingCordova) {
                var win: any = window;
                this.usingCordova = !!win.cordova;
            }
            if (this.usingCordova) {
                document.addEventListener("deviceready", async () => {
                    console.log("deviceready");
                    if ((window as any).plugins) {
                        var oneSignal = (window as any).plugins.OneSignal;
                        if (oneSignal) {
                            try {
                                console.debug("window.plugins.OneSignal exists");

                                const sender_id = "906036108091";  // google_project_number
                                const oneSignalAppId = "cfdefd08-d4ad-4593-8173-4ba4ebf4d67a";  // onesignal_app_id
                                var iosSettings = {};
                                iosSettings["kOSSettingsKeyAutoPrompt"] = true;
                                iosSettings["kOSSettingsKeyInAppLaunchURL"] = true;

                                console.debug("oneSignal.startInit");
                                oneSignal.startInit(oneSignalAppId, sender_id).
                                    iOSSettings(iosSettings).
                                    inFocusDisplaying(oneSignal.OSInFocusDisplayOption.Notification).
                                    handleNotificationOpened(this.notificationOpenedCallback).
                                    handleNotificationReceived(this.notificationReceivedCallback).
                                    endInit();
                                this.oneSignalId = await this.getids(oneSignal);

                            } catch (error) {
                                console.error(error);
                            }
                        } else {
                            console.log("Missing oneSignal plugin");
                        }
                    }
                    try {
                        if (device) {
                            console.debug("device exists");
                            console.debug(JSON.stringify(device));
                        } else {
                            console.debug("device does NOT exists");
                        }
                    } catch (error) {
                        console.error(error);
                    }
                    document.addEventListener("pause", this.onPause, false);
                    document.addEventListener("resume", this.onResume, false);
                    document.addEventListener("menubutton", this.onMenuKeyDown, false);
                    document.addEventListener("backbutton", this.onbackbutton, false);
                    this.gettoken();
                });
            } else {
                this.gettoken();
            }
        }
        gettoken() {
            var me: WebSocketClient = WebSocketClient.instance;
            var q: SigninMessage = new SigninMessage();
            this.getJSON("/jwt", async (error: any, data: any) => {
                try {
                    if (data !== null && data !== undefined) {
                        if ((data.jwt === null || data.jwt === undefined || data.jwt.trim() === "") ||
                            (data.rawAssertion === null || data.rawAssertion === undefined || data.rawAssertion.trim() === "")) {
                            // console.log("data.jwt or data.rawAssertion is null");
                            // data = null;
                        }
                    }
                    if (data === null || data === undefined) {
                        if (this.$location.path() !== "/Login") {
                            console.log("path: " + this.$location.path());
                            console.log("WebSocketClient::onopen: Not signed in, redirect /Login");
                            var _url = this.$location.absUrl();
                            this.setCookie("url", _url, 365);
                            this.$location.path("/Login");
                            this.$rootScope.$apply();
                        }
                        return;
                    }
                    q.jwt = data.jwt;
                    q.rawAssertion = data.rawAssertion;
                    q.realm = "browser";
                    console.log("WebSocketClient::onopen: Validate jwt");
                    console.debug("signing in with token");
                    var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                    var a: any = await this.Send(msg);
                    var result: SigninMessage = a;
                    this.user = result.user;
                    this.$rootScope.$broadcast(msg.command, result);
                } catch (error) {
                    this.user = null;
                    console.error(error);
                    this.$location.path("/Login");
                    this.$rootScope.$apply();
                }
            });
        }
        private onclose(evt: CloseEvent): void {
            var me: WebSocketClient = WebSocketClient.instance;
        }
        private onerror(evt: ErrorEvent): void {
            var me: WebSocketClient = WebSocketClient.instance;
        }
        private onmessage(evt: MessageEvent): void {
            var me: WebSocketClient = WebSocketClient.instance;
            let msg: SocketMessage = SocketMessage.fromjson(evt.data);
            me._receiveQueue.push(msg);
            me.ProcessQueue.bind(me)();
        }
        public async Send<T>(message: Message): Promise<T> {
            return new Promise<T>(async (resolve, reject) => {
                this._Send(message, ((msg) => {
                    if (msg.error !== null && msg.error !== undefined) { console.error(message); return reject(msg.error); }
                    resolve(msg);
                }).bind(this));
            });
        }
        private _Send(message: Message, cb: QueuedMessageCallback): void {
            var messages: string[] = this.chunkString(message.data, 500);
            if (messages === null || messages === undefined || messages.length === 0) {
                var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
                if (message.replyto === null || message.replyto === undefined) {
                    this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
                }
                this._sendQueue.push(singlemessage);
                return;
            }
            if (message.id === null || message.id === undefined) { message.id = Math.random().toString(36).substr(2, 9); }
            for (let i: number = 0; i < messages.length; i++) {
                var _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
                this._sendQueue.push(_message);
            }
            if (message.replyto === null || message.replyto === undefined) {
                this.messageQueue[message.id] = new QueuedMessage(message, cb);
            }
            this.ProcessQueue();
        }
        public chunkString(str: string, length: number): string[] {
            if (str === null || str === undefined) {
                return [];
            }
            // tslint:disable-next-line: quotemark
            return str.match(new RegExp('.{1,' + length + '}', 'g'));
        }
        private ProcessQueue(): void {
            let ids: string[] = [];
            this._receiveQueue.forEach(msg => {
                if (ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
            });
            ids.forEach(id => {
                var msgs: SocketMessage[] = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id === id; });
                msgs.sort((a, b) => a.index - b.index);
                var first: SocketMessage = msgs[0];
                if (first.count === msgs.length) {
                    if (msgs.length === 1) {
                        var singleresult: Message = Message.frommessage(first, first.data);
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                        singleresult.Process(this);
                    } else {
                        var buffer: string = "";
                        msgs.forEach(msg => {
                            if (msg.data !== null && msg.data !== undefined) { buffer += msg.data; }
                        });
                        var result: Message = Message.frommessage(first, buffer);
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                        result.Process(this);
                    }
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                }
            });
            if (this._socketObject !== null && this._socketObject.readyState !== 1) {
                this.connect();
                setTimeout(() => {
                    this.ProcessQueue();
                }, 1500);
                return;
            }
            this._sendQueue.forEach(msg => {
                try {
                    if (this._socketObject !== null && this._socketObject.readyState === 1) {
                        let id: string = msg.id;
                        this._socketObject.send(JSON.stringify(msg));
                        this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    }
                } catch (error) {
                    console.error(error);
                }
            });
        }
    }

}