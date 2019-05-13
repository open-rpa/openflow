/// <reference path='ReconnectingWebSocket.ts' />
module openflow {
    "use strict";
    interface IHashTable<T> {
        [key: string]: T;
    }
    interface WebAppInterface {
        getFirebaseToken() : any;
        getOneSignalRegisteredId() : any;
        isProductPurchased() : any;
        showLoader() : void;
        hideLoader() : void;
        rateApp() : void;
        playSound(file:string) : void;
        createNotification(displayname:string, message:string):void;

    }
    declare var android: WebAppInterface;

    type QueuedMessageCallback = (msg: any) => any;
    export class QueuedMessage {
        constructor(message:any, cb: QueuedMessageCallback) {
            this.id = message.id;
            this.message = message;
            this.cb = cb;
        }
        public cb: QueuedMessageCallback;
        public id:string;
        public message:any;
    }
    export class WebSocketClient {
        private _socketObject:ReconnectingWebSocket = null;
        private _url:string = null;
        private static instance:WebSocketClient = null;
        private _receiveQueue: SocketMessage[] = [];
        private _sendQueue: SocketMessage[] = [];
        public user:TokenUser = null;
        public jwt:string = null;
        static $inject = ["$rootScope", "$location"];
        public messageQueue: IHashTable<QueuedMessage> = {};
        constructor(public $rootScope:ng.IRootScopeService, public $location) {
            this.getJSON("/config", async (error:any, data:any) => {
                console.debug("WebSocketClient::onopen: connecting to " + data.wshost);
                this._socketObject = new ReconnectingWebSocket(data.wshost);
                this._socketObject.onopen = (this.onopen).bind(this);
                this._socketObject.onmessage = (this.onmessage).bind(this);
                this._socketObject.onclose = (this.onclose).bind(this);
                this._socketObject.onerror = (this.onerror).bind(this);
                WebSocketClient.instance = this;
            });
            // var url:string = window.location.href;
            // var arr:string[] = url.split("/");
            // var result:string = arr[0] + "//" + arr[2];
            // if(arr[0] === "http:") {
            //     result = "ws://" + arr[2];
            // } else {
            //     result = "wss://" + arr[2];
            // }
            // this._url = result;
            // console.log("WebSocketClient::onopen: connecting to " + result);
            // this._socketObject = new ReconnectingWebSocket(result);
            // this._socketObject.onopen = (this.onopen).bind(this);
            // this._socketObject.onmessage = (this.onmessage).bind(this);
            // this._socketObject.onclose = (this.onclose).bind(this);
            // this._socketObject.onerror = (this.onerror).bind(this);
            // WebSocketClient.instance = this;
        }
        public connect():void {
        }
        getJSON(url:string, callback:any): void {
            var xhr: XMLHttpRequest = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "json";
            xhr.onload = function ():void {
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
            if (this.user!==null) {
                callback(this.user);
                return;
            }
            var cleanup = this.$rootScope.$on('signin', (event, data) => {
                if (event && data) { }
                cleanup();
                callback(this.user);
            });
        }
        private async onopen(evt: Event):Promise<void> {
            console.log("WebSocketClient::onopen: connected");
            var me:WebSocketClient = WebSocketClient.instance;
            // me.communication = "Conenction opened, signing in" + "<br/>" + me.communication;
            // var message:any = { command: "signin", data: {username: "az", password: "az"}};
            // me._socketObject.send(JSON.stringify(message));
            var q:SigninMessage = new SigninMessage();
            this.getJSON("/jwt", async (error:any, data:any) => {
                try {
                    if(data===null || data ===undefined || data.jwt === "") {
                        if(this.$location.path() !=="/Login") {
                            console.log("path: " + this.$location.path());
                            console.log("WebSocketClient::onopen: Not signed in, redirect /Login");
                            // var url:string = window.location.href;
                            // var arr:string[] = url.split("/");
                            // var result:string = arr[0] + "//" + arr[2];
                            // top.location.href = result + "/#Login";
                            this.$location.path("/Login");
                            this.$rootScope.$apply();
                        }
                        return;
                    }
                    var _android:WebAppInterface = null;
                    try {
                        _android = android;
                    } catch (error) {                        
                    }
                    q.jwt = data.jwt;
                    q.rawAssertion = data.rawAssertion;
                    q.realm = "browser";
                    console.log("WebSocketClient::onopen: Validate jwt");
                    if(_android!=null) {
                        q.realm = "android";
                        try {
                            q.firebasetoken = _android.getFirebaseToken();
                        } catch (error) {
                            console.log(error);
                        }
                        try {
                            q.onesignalid = _android.getOneSignalRegisteredId();
                        } catch (error) {
                            console.log(error);
                        }
                    }
                    var msg:Message  = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                    var a:any = await this.Send(msg);
                    var result:SigninMessage = a;
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
        private onclose(evt: CloseEvent):void {
            var me:WebSocketClient = WebSocketClient.instance;
            // me.communication = "Conenction Closed " + evt.code + "  " + evt.type + "<br/>" + me.communication;
        }
        private onerror(evt: ErrorEvent):void {
            var me:WebSocketClient = WebSocketClient.instance;
            // me.communication = "Error Occured " + evt.message + "<br/>" + me.communication;
        }
        private onmessage(evt: MessageEvent):void {
            var me:WebSocketClient = WebSocketClient.instance;
            let msg:SocketMessage = SocketMessage.fromjson(evt.data);
            me._receiveQueue.push(msg);
            me.ProcessQueue.bind(me)();
        }
        public async Send<T>(message: Message):Promise<T> {
            return new Promise<T>(async (resolve, reject) => {
                this._Send(message, ((msg)=> {
                    if(msg.error!==null && msg.error !== undefined) { console.log(message); return reject(msg.error); }
                    resolve(msg);
                }).bind(this));
            });
        }
        private _Send(message: Message, cb: QueuedMessageCallback):void {
            var messages: string[] = this.chunkString(message.data, 500);
            if(messages===null || messages===undefined || messages.length === 0) {
                var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
                if(message.replyto === null || message.replyto === undefined) {
                    this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
                }
                this._sendQueue.push(singlemessage);
                return;
            }
            if(message.id === null || message.id === undefined) { message.id = Math.random().toString(36).substr(2, 9); }
            for(let i: number = 0; i < messages.length; i++) {
                var _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
                this._sendQueue.push(_message);
            }
            if(message.replyto === null || message.replyto === undefined) {
                this.messageQueue[message.id] = new QueuedMessage(message, cb);
            }
            // setTimeout(() => {
            //     this.ProcessQueue();
            // }, 500);
            this.ProcessQueue();
        }
        public chunkString(str: string, length: number): string[] {
            if(str === null || str === undefined) {
                return [];
            }
            // tslint:disable-next-line: quotemark
            return str.match(new RegExp('.{1,' + length + '}', 'g'));
        }
        private ProcessQueue():void {
            let ids: string[] = [];
            this._receiveQueue.forEach(msg => {
                if(ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
            });
            ids.forEach(id => {
                var msgs: SocketMessage[] = this._receiveQueue.filter(function (msg:SocketMessage):boolean { return msg.id===id; });
                msgs.sort((a, b) => a.index - b.index);
                var first: SocketMessage = msgs[0];
                if(first.count === msgs.length) {
                    if(msgs.length === 1) {
                        var singleresult: Message = Message.frommessage(first, first.data);
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
                        singleresult.Process(this);
                    } else {
                        var buffer: string = "";
                        msgs.forEach(msg => {
                            if(msg.data!==null && msg.data !== undefined) { buffer += msg.data; }
                        });
                        var result: Message = Message.frommessage(first, buffer);
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
                        result.Process(this);
                    }
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
                }
            });
            if(this._socketObject !== null && this._socketObject.readyState!==1) {
                this.connect();
                setTimeout(() => {
                    this.ProcessQueue();
                }, 1500);
                return;
            }
            this._sendQueue.forEach(msg => {
                try {
                    if(this._socketObject !== null && this._socketObject.readyState===1) {
                        let id: string = msg.id;
                        this._socketObject.send(JSON.stringify(msg));
                        this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
                    }
                } catch (error) {
                    console.error(error);
                }
            });
        }
    }

}