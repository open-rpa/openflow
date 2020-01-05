/// <reference path='ReconnectingWebSocket.ts' />
module openflow {
    // "use strict";
    interface IHashTable<T> {
        [key: string]: T;
    }
    declare var cordova: any;
    declare var device: any;
    declare var diagnostic: any;

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
    export class WebSocketClient {
        private _socketObject: ReconnectingWebSocket = null;

        public domain: string = null;
        public allow_personal_nodered: boolean = false;
        public allow_user_registration: boolean = false;

        public namespace: string = null;
        public version: string = null;
        public nodered_domain_schema: string = null;

        private _url: string = null;
        private static instance: WebSocketClient = null;
        private _receiveQueue: SocketMessage[] = [];
        private _sendQueue: SocketMessage[] = [];
        public user: TokenUser = null;
        public jwt: string = null;
        public device: any = null;
        public usingCordova: boolean = false;
        public plugins: any = null;
        public scanCount: number = 0;
        public oneSignalId: string = null;
        public location: any;
        public websocket_package_size: number = 500;
        static $inject = ["$rootScope", "$location", "$window"];
        public messageQueue: IHashTable<QueuedMessage> = {};
        constructor(public $rootScope: ng.IRootScopeService, public $location, public $window: any) {
            try {
                var path = this.$location.absUrl().split('#')[0];
                // this.usingCordova = (path.indexOf("/android/") > -1 || path.indexOf("/ios/") > -1);
            } catch (error) {
            }
            this.init();
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
                    console.log("oneSignal.getIds: " + ids.userId);
                    resolve(ids.userId);
                });
            });
        }
        getLocation(): Promise<any> {
            return new Promise<any>(async (resolve, reject) => {
                var onSuccess = function (position) {
                    var result = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        altitude: position.coords.altitude,
                        accuracy: position.coords.accuracy,
                        altitudeAccuracy: position.coords.altitudeAccuracy,
                        heading: position.coords.heading,
                        speed: position.coords.speed,
                        timestamp: position.coords.timestamp
                    }
                    console.log('Latitude: ' + result.latitude + '\n' +
                        'Longitude: ' + result.longitude + '\n' +
                        'Altitude: ' + result.altitude + '\n' +
                        'Accuracy: ' + result.accuracy + '\n' +
                        'Altitude Accuracy: ' + result.altitudeAccuracy + '\n' +
                        'Heading: ' + result.heading + '\n' +
                        'Speed: ' + result.speed + '\n' +
                        'Timestamp: ' + result.timestamp + '\n');
                    resolve(result);
                };

                // onError Callback receives a PositionError object
                //
                function onError(error) {
                    reject(error);
                    console.error('code: ' + error.code + '\n' +
                        'message: ' + error.message + '\n');
                }
                var options = {
                    enableHighAccuracy: true,
                    timeout: 2000,
                    maximumAge: 0
                };
                try {
                    if (navigator && navigator.geolocation) {
                        console.log("getCurrentPosition");
                        navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
                    } else {
                        console.log("geolocation not installed");
                        reject(new Error("geolocation not installed!"));
                    }
                } catch (error) {
                    reject(error);
                }
            });
        }
        isLocationAvailable(): Promise<boolean> {
            return new Promise<boolean>(async (resolve, reject) => {
                cordova.plugins.diagnostic.isLocationAvailable((isAvailable) => {
                    resolve(isAvailable);
                }, (error) => {
                    reject(error);
                });
            });
        }
        isLocationAuthorized(): Promise<boolean> {
            return new Promise<boolean>(async (resolve, reject) => {
                cordova.plugins.diagnostic.isLocationAuthorized((authorized) => {
                    resolve(authorized);
                }, (error) => {
                    reject(error);
                });
            });
        }
        requestLocationAuthorization(): Promise<void> {
            return new Promise<void>(async (resolve, reject) => {
                cordova.plugins.diagnostic.requestLocationAuthorization(() => {
                    resolve();
                }, (error) => {
                    reject(error);
                });
            });
        }
        scanForCordova() {
            if (this.usingCordova == true) return;
            try {
                if (cordova !== undefined) {
                    console.log("Found cordova");
                    this.usingCordova = true;
                    document.addEventListener("deviceready", async () => {
                        console.log("deviceready");
                        if ((window as any).plugins) {
                            this.plugins = (window as any).plugins;
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
                                    console.log("oneSignalId: " + this.oneSignalId);

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
                                this.device = device;
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


                        if (cordova.plugins && cordova.plugins.diagnostic) {
                            console.debug("Check if authorized for location");
                            var isAuthorized = await this.isLocationAuthorized();
                            if (!isAuthorized) {
                                console.debug("Not authorized for location is not , request authorization");
                                await this.requestLocationAuthorization();
                            }

                            var isAvailable = await this.isLocationAvailable();
                            if (!isAvailable) {
                                console.debug("Location is not available");
                            } else {
                                console.debug("Location is available, get current location");
                                this.location = await this.getLocation();
                            }
                        } else {
                            console.debug("diagnostic is missing");
                        }
                        this.$rootScope.$broadcast("cordovadetected");
                    });
                } else {
                    console.debug("cordova not definded");
                    if (this.scanCount < (5 * 4)) {
                        this.scanCount++;
                        setTimeout(this.scanForCordova, 200);
                    }
                }
            } catch (error) {
                console.debug("Failed locating cordova. " + error);
            }
        }
        init() {
            this.getJSON("/config", async (error: any, data: any) => {
                var parser = document.createElement('a');
                parser.href = data.wshost;
                parser.protocol; // => "http:"
                parser.hostname; // => "example.com"
                parser.port;     // => "3000"
                parser.pathname; // => "/pathname/"
                parser.search;   // => "?search=test"
                parser.hash;     // => "#hash"
                parser.host;     // => "example.com:3000"
                if (location.protocol == 'https:' && parser.protocol == "ws:") {
                    data.wshost = "wss://" + parser.hostname;
                    console.log("new wshost: " + data.wshost);
                    if (parser.port != "80") {
                        data.wshost = "wss://" + parser.hostname + parser.port;
                    }
                }
                if (location.protocol == 'http:' && parser.protocol == "wss:") {
                    data.wshost = "ws://" + parser.hostname;
                    if (parser.port != "443") {
                        data.wshost = "ws://" + parser.hostname + parser.port;
                    }
                }
                console.debug("WebSocketClient::onopen: connecting to " + data.wshost);
                this.domain = data.domain;
                this.allow_personal_nodered = data.allow_personal_nodered;
                this.allow_user_registration = data.allow_user_registration;
                this.namespace = data.namespace;
                this.nodered_domain_schema = data.nodered_domain_schema;
                this.websocket_package_size = data.websocket_package_size;
                this.version = data.version;
                this._socketObject = new ReconnectingWebSocket(data.wshost);
                this._socketObject.onopen = (this.onopen).bind(this);
                this._socketObject.onmessage = (this.onmessage).bind(this);
                this._socketObject.onclose = (this.onclose).bind(this);
                this._socketObject.onerror = (this.onerror).bind(this);
                WebSocketClient.instance = this;
            });
        }
        notificationOpenedCallback(notification) {
            console.log("notificationOpenedCallback");
            var state = notification.notification;
            console.debug(JSON.stringify(state));
            try {
                //if (state.isAppInFocus) {
                if (state.payload.additionalData.URL != undefined && state.payload.additionalData.URL != null && state.payload.additionalData.URL != "") {
                    console.log("set window.location.href:" + state.payload.additionalData.URL);
                    window.location.href = state.payload.additionalData.URL;
                }
                if (state.payload.additionalData.customurl != undefined && state.payload.additionalData.customurl != null && state.payload.additionalData.customurl != "") {
                    console.log("set window.location.href:" + state.payload.additionalData.customurl);
                    window.location.href = state.payload.additionalData.customurl;
                }
                return;
                //}
                // {"isAppInFocus":true,"shown":true,"androidNotificationId":-1616162934,"displayType":0,"payload":{"notificationID":"aee1f7a2-2108-489d-a401-86dba6a1ad99","body":"Android 2019-06-02T20:58:25.876Z","additionalData":{"URL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8"},"launchURL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8","lockScreenVisibility":1,"fromProjectNumber":"906036108091","priority":0,"rawPayload":"{\"google.delivered_priority\":\"normal\",\"google.sent_time\":1559509106669,\"google.ttl\":259200,\"google.original_priority\":\"normal\",\"custom\":\"{\\\"a\\\":{\\\"URL\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\"},\\\"u\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\",\\\"i\\\":\\\"aee1f7a2-2108-489d-a401-86dba6a1ad99\\\"}\",\"from\":\"906036108091\",\"alert\":\"Android 2019-06-02T20:58:25.876Z\",\"google.message_id\":\"0:1559509106674108%6c875f80f9fd7ecd\",\"notificationId\":-1616162934}"}}
                //console.log(state);
            } catch (error) {
                console.log(error);
            }

        }
        notificationReceivedCallback(state) {
            // console.log("notificationReceivedCallback");
            // console.debug(JSON.stringify(state));
            // try {
            //     //if (state.isAppInFocus) {
            //     if (state.payload.additionalData.URL != undefined && state.payload.additionalData.URL != null && state.payload.additionalData.URL != "") {
            //         console.log("set window.location.href:" + state.payload.additionalData.URL);
            //         window.location.href = state.payload.additionalData.URL;
            //     }
            //     if (state.payload.additionalData.customurl != undefined && state.payload.additionalData.customurl != null && state.payload.additionalData.customurl != "") {
            //         console.log("set window.location.href:" + state.payload.additionalData.customurl);
            //         window.location.href = state.payload.additionalData.customurl;
            //     }
            //     return;
            //     //}
            //     // {"isAppInFocus":true,"shown":true,"androidNotificationId":-1616162934,"displayType":0,"payload":{"notificationID":"aee1f7a2-2108-489d-a401-86dba6a1ad99","body":"Android 2019-06-02T20:58:25.876Z","additionalData":{"URL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8"},"launchURL":"https://aiotdev-frontend.openrpa.dk/#/Alert/5cf25ad801530ae6396519b8","lockScreenVisibility":1,"fromProjectNumber":"906036108091","priority":0,"rawPayload":"{\"google.delivered_priority\":\"normal\",\"google.sent_time\":1559509106669,\"google.ttl\":259200,\"google.original_priority\":\"normal\",\"custom\":\"{\\\"a\\\":{\\\"URL\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\"},\\\"u\\\":\\\"https:\\\\\\/\\\\\\/aiotdev-frontend.openrpa.dk\\\\\\/#\\\\\\/Alert\\\\\\/5cf25ad801530ae6396519b8\\\",\\\"i\\\":\\\"aee1f7a2-2108-489d-a401-86dba6a1ad99\\\"}\",\"from\":\"906036108091\",\"alert\":\"Android 2019-06-02T20:58:25.876Z\",\"google.message_id\":\"0:1559509106674108%6c875f80f9fd7ecd\",\"notificationId\":-1616162934}"}}
            //     //console.log(state);
            // } catch (error) {
            //     console.log(error);
            // }
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
        timeout(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        private onopen(evt: Event) {
            // console.debug("WebSocketClient::onopen: connected");
            this.$rootScope.$broadcast("socketopen");
            setTimeout(this.scanForCordova.bind(this), 200);
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
        public async Send<T>(message: Message, status: QueuedMessageStatusCallback = null): Promise<T> {
            return new Promise<T>(async (resolve, reject) => {
                this._Send(message, ((msg) => {
                    if (msg.error !== null && msg.error !== undefined) { console.error(message); return reject(msg.error); }
                    resolve(msg);
                }).bind(this), status);
            });
        }
        private _Send(message: Message, cb: QueuedMessageCallback, status: QueuedMessageStatusCallback): void {
            var messages: string[] = this.chunkString(message.data, this.websocket_package_size);
            if (messages === null || messages === undefined || messages.length === 0) {
                var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
                if (message.replyto === null || message.replyto === undefined) {
                    this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb, status);
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
                this.messageQueue[message.id] = new QueuedMessage(message, cb, status);
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
                } else {
                    // console.log(msgs.length + " out of " + first.count);
                    var qm: QueuedMessage = this.messageQueue[first.replyto];
                    // console.log(first);
                    if (qm != null && qm != undefined) {
                        if (qm.status != null && qm.status != undefined) {
                            qm.status(first, msgs.length, first.count);
                        }
                    }

                }
            });
            if (this._socketObject !== null && this._socketObject.readyState !== 1) {
                this.connect();
                setTimeout(() => {
                    this.ProcessQueue();
                }, 1500);
                return;
            }
            var sendcounter: number = 0;
            while (this._sendQueue.length > 0 && sendcounter < 100) {
                var msg = this._sendQueue[0];
                try {
                    if (this._socketObject !== null && this._socketObject.readyState === 1) {
                        let id: string = msg.id;
                        this._socketObject.send(JSON.stringify(msg));

                        var qm: QueuedMessage = this.messageQueue[id];
                        if (qm != null && qm != undefined) {
                            if (qm.status != null && qm.status != undefined) {
                                qm.status(msg, msg.index, msg.count);
                            }
                        }
                        this._sendQueue.splice(0, 1);
                        // this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                        sendcounter++;
                    }
                } catch (error) {
                    console.error(error);
                }
            }
            if (this._sendQueue.length > 0) {
                setTimeout(() => {
                    this.ProcessQueue();
                }, 100);
            }
        }
    }

}