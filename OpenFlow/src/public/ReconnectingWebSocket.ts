// mit license:
//
// copyright (c) 2010-2012, joe walnes
//
// permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "software"), to deal
// in the software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the software, and to permit persons to whom the software is
// furnished to do so, subject to the following conditions:
//
// the above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the software.
//
// the software is provided "as is", without warranty of any kind, express or
// implied, including but not limited to the warranties of merchantability,
// fitness for a particular purpose and noninfringement. in no event shall the
// authors or copyright holders be liable for any claim, damages or other
// liability, whether in an action of contract, tort or otherwise, arising from,
// out of or in connection with the software or the use or other dealings in
// the software.

/**
 * this behaves like a websocket in every way, except if it fails to connect,
 * or it gets disconnected, it will repeatedly poll until it succesfully connects
 * again.
 *
 * it is api compatible, so when you have:
 *   ws = new websocket("ws://....");
 * you can replace with:
 *   ws = new reconnectingwebsocket("ws://....");
 *
 * the event stream will typically look like:
 *  onconnecting
 *  onopen
 *  onmessage
 *  onmessage
 *  onclose // lost connection
 *  onconnecting
 *  onopen  // sometime later...
 *  onmessage
 *  onmessage
 *  etc...
 *
 * it is api compatible with the standard websocket api.
 *
 * latest version: https://github.com/joewalnes/reconnecting-websocket/
 * - joe walnes
 *
 * latest typescript version: https://github.com/daviddoran/typescript-reconnecting-websocket/
 * - david doran
 */
module openflow {
    "use strict";
    export class ReconnectingWebSocket {
        // these can be altered by calling code
        public debug:boolean = false;

        // time to wait before attempting reconnect (after close)
        public reconnectInterval:number = 1000;
        // time to wait for WebSocket to open (before aborting and retrying)
        public timeoutInterval:number = 2000;

        // should only be used to read WebSocket readyState
        public readyState:number;

        // whether WebSocket was forced to close by this client
        private forcedClose:boolean = false;
        // whether WebSocket opening timed out
        private timedOut:boolean = false;

        // list of WebSocket sub-protocols
        private protocols:string[] = [];

        // the underlying WebSocket
        private ws:WebSocket;
        private url:string;

        /**
         * Setting this to true is the equivalent of setting all instances of ReconnectingWebSocket.debug to true.
         */
        public static debugAll = false;

        // set up the default "noop" event handlers
// tslint:disable-next-line: typedef
// tslint:disable-next-line: no-empty
public onopen:(ev:Event) => void = function (event:Event):void {};
// tslint:disable-next-line: typedef
// tslint:disable-next-line: no-empty
public onclose:(ev:CloseEvent) => void = function (event:CloseEvent):void {};
// tslint:disable-next-line: typedef
// tslint:disable-next-line: no-empty
public onconnecting:() => void = function ():void {};
// tslint:disable-next-line: typedef
// tslint:disable-next-line: no-empty
public onmessage:(ev:MessageEvent) => void = function (event:MessageEvent):void {};
// tslint:disable-next-line: typedef
// tslint:disable-next-line: no-empty
        public onerror:(ev:ErrorEvent) => void = function (event:ErrorEvent):void {};

        constructor(url:string, protocols:string[] = []) {
            this.url = url;
            this.protocols = protocols;
            this.readyState = WebSocket.CONNECTING;
            this.connect(false);
        }

        public connect(reconnectAttempt:boolean):void {
            this.ws = new WebSocket(this.url, this.protocols);

            this.onconnecting();
            this.log("ReconnectingWebSocket", "attempt-connect", this.url);

            var localWs:WebSocket = this.ws;
            var timeout:any = setTimeout(() => {
                this.log("ReconnectingWebSocket", "connection-timeout", this.url);
                this.timedOut = true;
                localWs.close();
                this.timedOut = false;
            }, this.timeoutInterval);

            this.ws.onopen = (event:Event) => {
                clearTimeout(timeout);
                this.log("ReconnectingWebSocket", "onopen", this.url);
                this.readyState = WebSocket.OPEN;
                reconnectAttempt = false;
                this.onopen(event);
            };

            this.ws.onclose = (event:CloseEvent) => {
                clearTimeout(timeout);
                this.ws = null;
                if (this.forcedClose) {
                    this.readyState = WebSocket.CLOSED;
                    this.onclose(event);
                } else {
                    this.readyState = WebSocket.CONNECTING;
                    this.onconnecting();
                    if (!reconnectAttempt && !this.timedOut) {
                        this.log("ReconnectingWebSocket", "onclose", this.url);
                        this.onclose(event);
                    }
                    setTimeout(() => {
                        this.connect(true);
                    }, this.reconnectInterval);
                }
            };
            this.ws.onmessage = (event) => {
                this.log("ReconnectingWebSocket", "onmessage", this.url, event.data);
                this.onmessage(event);
            };
            this.ws.onerror = (event) => {
                this.log("ReconnectingWebSocket", "onerror", this.url, event);
                this.onerror((event as ErrorEvent));
            };
        }

        public send(data:any):void {
            if (this.ws) {
                this.log("ReconnectingWebSocket", "send", this.url, data);
                return this.ws.send(data);
            } else {
                throw "INVALID_STATE_ERR : Pausing to reconnect websocket";
            }
        }

        /**
         * Returns boolean, whether websocket was FORCEFULLY closed.
         */
        public close():boolean {
            if (this.ws) {
                this.forcedClose = true;
                this.ws.close();
                return true;
            }
            return false;
        }

        /**
         * Additional public API method to refresh the connection if still open (close, re-open).
         * For example, if the app suspects bad data / missed heart beats, it can try to refresh.
         *
         * Returns boolean, whether websocket was closed.
         */
        public refresh():boolean {
            if (this.ws) {
                this.ws.close();
                return true;
            }
            return false;
        }

        private log(...args: any[]):void {
            if (this.debug || ReconnectingWebSocket.debugAll) {
                console.log.apply(console, args);
                // console.debug.apply(console, args);
            }
        }
    }
}