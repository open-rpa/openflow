module openflow {
    "use strict";
    class messagequeue {
        constructor(
            public msg: QueueMessage,
            public callback: any) { }
    }
    interface IHashTable<T> {
        [key: string]: T;
    }
    export type mapFunc = () => void;
    export type reduceFunc = (key: string, values: any[]) => any;
    export type finalizeFunc = (key: string, value: any) => any;
    const getCircularReplacer = () => {
        const seen = new WeakSet();
        return (key, value) => {
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) {
                    return;
                }
                seen.add(value);
            }
            return value;
        };
    };
    export class api {
        static $inject = ["$rootScope", "$location", "WebSocketClient"];
        public messageQueue: IHashTable<messagequeue> = {};
        constructor(public $rootScope: ng.IRootScopeService, public $location, public WebSocketClient: WebSocketClient) {
            var isChrome = navigator.userAgent.indexOf("Chrome") !== -1;
            var formerlog = console.log.bind(console);
            var formerwarn = console.warn.bind(console);
            var formerdebug = console.debug.bind(console);
            var me = this;

            ['log', 'warn', 'debug', 'error'].forEach((methodName) => {
                //['error'].forEach((methodName) => {
                const originalMethod = console[methodName];
                console[methodName] = (...args) => {
                    let initiator = 'unknown place';
                    try {
                        throw new Error();
                    } catch (e) {
                        if (typeof e.stack === 'string') {
                            let isFirst = true;
                            for (const line of e.stack.split('\n')) {
                                const matches = line.match(/^\s+at\s+(.*)/);
                                if (matches) {
                                    if (!isFirst) { // first line - current function
                                        // second line - caller (what we are looking for)
                                        initiator = matches[1];
                                        break;
                                    }
                                    isFirst = false;
                                }
                            }
                        }
                    }
                    var _type = "message";
                    if (methodName == "warn") _type = "warning";
                    if (methodName == "debug") _type = "debug";
                    if (methodName == "error") _type = "error";
                    var a = args[0];
                    try {
                        if (a == "[object Object]") {
                            a = JSON.stringify(args[0]);
                        }
                    } catch (error) {
                    }
                    var log = { message: a, _type: _type, host: window.location.hostname, initiator: initiator };
                    this.Insert("jslog", log).catch(() => { });
                    //originalMethod.apply(console, [...args, `\n  at ${initiator}`]);
                    originalMethod.apply(console, [...args]);
                };
            });

            // console.log = (msg) => {
            //     var log = { message: msg, _type: "message", host: window.location.hostname };
            //     this.Insert("jslog", log).catch(() => { });
            // }

            // (function () {
            //     var oldLog = console.log;
            //     console.log = function (msg) {
            //         var log = { message: msg, _type: "message", host: window.location.hostname };
            //         me.Insert("jslog", log).catch(() => { });
            //         // oldLog.apply(console, arguments);
            //         console.trace.apply(console, arguments);
            //     };
            // })();
            // console.log = function (test) {
            //     // var log = { message: arguments, _type: "message", host: window.location.hostname };
            //     // me.Insert("jslog", log).catch(() => { });
            //     console.warn(test)
            //     return Function.prototype.bind.call(console.log, console, "test");
            // }();
            // console.warn = (msg) => {
            //     var log = { message: msg, _type: "warning", host: window.location.hostname };
            //     this.Insert("jslog", log).catch(() => { });
            // }
            // console.debug = (msg) => {
            //     formerdebug.apply(console, { arguments: arguments });
            //     // formerdebug(msg);
            //     var log = { message: msg, _type: "debug", host: window.location.hostname };
            //     this.Insert("jslog", log).catch(() => { });
            // }
            window.onerror = (message, url, linenumber) => {
                var log = { message: message, url: url, linenumber: linenumber, _type: "error", host: window.location.hostname };
                this.Insert("jslog", log).catch(() => { });
            }
            var cleanup = $rootScope.$on('queuemessage', (event, data: QueueMessage) => {
                if (event && data) { }
                if (this.messageQueue[data.correlationId] !== undefined) {
                    this.messageQueue[data.correlationId].callback(data);
                    delete this.messageQueue[data.correlationId];
                }
            });
        }
        async Query(collection: string, query: any, projection: any = null, orderby: any = { _created: -1 }, top: number = 500, skip: number = 0): Promise<any[]> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = collection; q.query = query;
            q.projection = projection; q.orderby = orderby; q.top = top; q.skip = skip;
            var msg: Message = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<QueryMessage>(msg);
            return q.result;
        }
        async MapReduce(collection: string, map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, scope: any): Promise<any> {
            var q: MapReduceMessage = new MapReduceMessage(map, reduce, finalize, query, out);
            q.collectionname = collection; q.scope = scope;
            var msg: Message = new Message(); msg.command = "mapreduce"; q.out = out;

            // msg.data = JSON.stringify(q);
            msg.data = JSONfn.stringify(q);
            q = await this.WebSocketClient.Send<MapReduceMessage>(msg);
            return q.result;
        }
        async Insert(collection: string, model: any): Promise<any> {
            var q: InsertOneMessage = new InsertOneMessage();
            q.collectionname = collection; q.item = model;
            var msg: Message = new Message(); msg.command = "insertone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<InsertOneMessage>(msg);
            return q.result;
        }
        async Update(collection: string, model: any): Promise<any> {
            var q: UpdateOneMessage = new UpdateOneMessage();
            q.collectionname = collection; q.item = model;
            var msg: Message = new Message(); msg.command = "updateone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<UpdateOneMessage>(msg);
            return q.result;
        }
        async Delete(collection: string, model: any): Promise<void> {
            var q: DeleteOneMessage = new DeleteOneMessage();
            q.collectionname = collection; q._id = model._id;
            var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<DeleteOneMessage>(msg);
        }
        async RegisterQueue(queuename: string = undefined): Promise<void> {
            var q: RegisterQueueMessage = new RegisterQueueMessage();
            q.queuename = queuename;
            var msg: Message = new Message(); msg.command = "registerqueue"; msg.data = JSON.stringify(q);
            await this.WebSocketClient.Send(msg);
        }
        async _QueueMessage(queuename: string, data: any): Promise<QueueMessage> {
            return new Promise<QueueMessage>(async (resolve, reject) => {
                var q: QueueMessage = new QueueMessage();
                q.correlationId = Math.random().toString(36).substr(2, 9);
                q.queuename = queuename; q.data = JSON.stringify(data);
                var msg: Message = new Message(); msg.command = "queuemessage"; msg.data = JSON.stringify(q);
                console.log("_QueueMessage: correlationId " + q.correlationId);
                this.messageQueue[q.correlationId] = new messagequeue(q, (msgresult: QueueMessage) => {
                    resolve(msgresult);
                    delete this.messageQueue[q.correlationId];
                });
                var res = await this.WebSocketClient.Send(msg);
                console.log("_QueueMessage");
                console.log(res);
            });
        }
        async QueueMessage(queuename: string, data: any): Promise<any> {
            var result: any = await this._QueueMessage(queuename, data);
            var msg = result.data;
            try {
                result.data = JSON.parse(result.data);
            } catch (error) {
            }
            return msg;
        }
        async GetNoderedInstance(): Promise<any> {
            var q: GetNoderedInstanceMessage = new GetNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "getnoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<GetNoderedInstanceMessage>(msg);
            console.log(q);
            return q.result;
        }
        async EnsureNoderedInstance(): Promise<void> {
            var q: EnsureNoderedInstanceMessage = new EnsureNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "ensurenoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<EnsureNoderedInstanceMessage>(msg);
        }
        async DeleteNoderedInstance(): Promise<void> {
            var q: DeleteNoderedInstanceMessage = new DeleteNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "deletenoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<DeleteNoderedInstanceMessage>(msg);
        }
        async RestartNoderedInstance(): Promise<void> {
            var q: RestartNoderedInstanceMessage = new RestartNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "restartnoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<RestartNoderedInstanceMessage>(msg);
        }
        async StartNoderedInstance(): Promise<void> {
            var q: StartNoderedInstanceMessage = new StartNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "startnoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<StartNoderedInstanceMessage>(msg);
        }
        async StopNoderedInstance(): Promise<void> {
            var q: StopNoderedInstanceMessage = new StopNoderedInstanceMessage();
            var msg: Message = new Message(); msg.command = "stopnoderedinstance"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<StopNoderedInstanceMessage>(msg);
        }

    }
    export class JSONfn {
        public static stringify(obj) {
            return JSON.stringify(obj, function (key, value) {
                return (typeof value === 'function') ? value.toString() : value;
            });
        }
        public static parse(str) {
            return JSON.parse(str, function (key, value) {
                if (typeof value != 'string') return value;
                return (value.substring(0, 8) == 'function') ? eval('(' + value + ')') : value;
            });
        }
    }
    function _timeSince(timeStamp) {
        var now: Date = new Date(),
            secondsPast: number = (now.getTime() - timeStamp.getTime()) / 1000;
        if (secondsPast < 60) {
            return parseInt(secondsPast.toString()) + 's';
        }
        if (secondsPast < 3600) {
            return parseInt((secondsPast / 60).toString()) + 'm';
        }
        if (secondsPast <= 86400) {
            return parseInt((secondsPast / 3600).toString()) + 'h';
        }
        if (secondsPast > 86400) {
            let day = timeStamp.getDate();
            let month = timeStamp.toDateString().match(/ [a-zA-Z]*/)[0].replace(" ", "");
            let year = timeStamp.getFullYear() == now.getFullYear() ? "" : " " + timeStamp.getFullYear();
            return day + " " + month + year;
        }
    }

    export class timesince implements ng.IDirective {
        // restrict = 'E';
        require = 'ngModel';
        replace = true;

        constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService) {

        }

        link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
            scope.$watch(() => {
                if (ngModelCtrl.$viewValue === null || ngModelCtrl.$viewValue === undefined) { return; }
                var timeStamp = ngModelCtrl.$viewValue;
                element.text(_timeSince(new Date(timeStamp)));
            });
        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService) => new timesince($location, $timeout);
            directive.$inject = ['$location', '$timeout'];
            return directive;
        }
    }

    async function getString(locale: any, lib: string, key: string): Promise<any> {
        return new Promise((resolve) => {
            try {
                if (locale === null || locale === undefined) { return resolve(); }
                locale.ready(lib).then(function () {
                    var value = locale.getString(lib + "." + key);
                    if (value !== null && value !== undefined && value !== "") {
                        resolve(value);
                    } else {
                        resolve(key);
                    }
                });
            } catch (error) {
            }
        });
    }
    var global_translate_notfound: string[] = [];
    export class translate implements ng.IDirective {
        require = '?ngModel';
        replace = true;

        constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
        }
        link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
            var calculateValue = (value: string): string => {
                if (value === null || value === undefined || value === "") return value;
                var lib = (attr.lib ? attr.lib : "common");
                if ((value.toString()).startsWith(lib + ".")) { return; }
                var key: string = (lib + "." + value).toLowerCase();
                var result = this.locale.getString(key);
                if (result.startsWith(lib + ".")) { result = result.slice((lib + ".").length); }
                // var result = await getString(this.locale, lib, value);
                if (result == "%%KEY_NOT_FOUND%%" || result == "") {
                    if (global_translate_notfound.indexOf(lib + "." + value) === -1) {
                        global_translate_notfound.push(lib + "." + value);
                        console.log("KEY_NOT_FOUND " + lib + "." + value);
                    }
                    result = value;
                }

                return result;
            };
            var lib = (attr.lib ? attr.lib : "common");
            this.locale.ready(lib).then(() => {
                var value: string = null;
                if (ngModelCtrl !== null) {
                    ngModelCtrl.$formatters.push(function (value) {
                        return calculateValue(value);
                    });
                    // value = calculateValue(ngModelCtrl.$viewValue);
                    // ngModelCtrl.$setViewValue(this.result);
                    // ngModelCtrl.$render();
                } else {
                    var hashCode = (s: string) => {
                        return s.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
                    }
                    var watchFunction = () => {
                        if (attr.value !== null && attr.value !== undefined) {
                            return hashCode(attr.value);
                        } else {
                            var value = element.text();
                            if (value !== null || value !== undefined) {
                                return hashCode(value);
                            }
                            return value;
                        }
                    };
                    // attrs.$observe('i18n', function (newVal, oldVal) {
                    // });
                    //scope.$watch(watchFunction, () => {
                    if (attr.value !== null && attr.value !== undefined) {
                        value = calculateValue(attr.value);
                        attr.$set('value', value);
                    } else {
                        value = element.text();
                        if (value !== null || value !== undefined) {
                            var result = calculateValue(value);
                            // console.log(value + "=" + result);
                            element.text(result);
                        }
                    }
                    //});
                }
            });
        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new translate($location, $timeout, locale);
            directive.$inject = ['$location', '$timeout', 'locale'];
            return directive;
        }
    }

    export class entitiesCtrl<T> {
        public loading: boolean = false;
        public basequery: any = {};
        public baseprojection: any = {};
        public collection: string = "entities";
        public models: T[] = [];
        public orderby: any = { _created: -1 };

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient",
            "api"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
        }
        async loadData(): Promise<void> {
            this.loading = true;
            this.models = await this.api.Query(this.collection, this.basequery, this.baseprojection, this.orderby);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }

        ToggleOrder(field: string) {
            if (this.orderby[field] == undefined) {
                this.orderby = {};
            }
            if (this.orderby[field] == -1) {
                this.orderby[field] = 1;
            } else {
                this.orderby[field] = -1;
            }
            if (field === '_type') {
                this.orderby["type"] = this.orderby[field];
            }
            this.loadData();
        }
    }


    export class entityCtrl<T> {
        public loading: boolean = false;
        public basequery: any = {};
        public baseprojection: any = {};
        public collection: string = "entities";
        public model: T = null;
        public id: string = null;
        public keys: string[] = [];

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient",
            "api"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            this.id = $routeParams.id;
            this.basequery = { _id: this.id };
        }
        async loadData(): Promise<void> {
            this.loading = true;
            var result = await this.api.Query(this.collection, this.basequery, this.baseprojection, null, 1);
            if (result.length > 0) { this.model = result[0]; }
            this.keys = Object.keys(this.model);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
}
