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
            var cleanup1 = this.$rootScope.$on('socketopen', (event, data) => {
                if (event && data) { }
                this.gettoken();
                // cleanup();
            });
            //['log', 'warn', 'debug', 'error'].forEach((methodName) => {
            ['error2'].forEach((methodName) => {
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
                    initiator = (initiator.length > 100) ? initiator.substr(0, 100 - 1) : initiator;
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
        gettoken() {
            this.WebSocketClient.getJSON("/jwt", async (error: any, data: any) => {
                try {
                    if (data !== null && data !== undefined) {
                        if (data.jwt === null || data.jwt === undefined || data.jwt.trim() === "") { data.jwt = null; }
                        if (data.rawAssertion === null || data.rawAssertion === undefined || data.rawAssertion.trim() === "") { data.rawAssertion = null; }
                        if (data.jwt === null && data.rawAssertion === null) {
                            console.log("data.jwt and data.rawAssertion is null");
                            data = null;
                        }
                    }
                    if (data === null || data === undefined) {
                        if (this.$location.path() !== "/Login") {
                            var _url = this.$location.absUrl();
                            this.setCookie("url", _url, 365);
                            this.$location.path("/Login");
                            this.$rootScope.$apply();
                        }
                        return;
                    }
                    await this.SigninWithToken(data.jwt, data.rawAssertion, null);
                } catch (error) {
                    this.WebSocketClient.user = null;
                    console.error(error);
                    this.$location.path("/Login");
                    this.$rootScope.$apply();
                }
            });
        }
        async SigninWithToken(jwt: string, rawAssertion: string, impersonate: string): Promise<SigninMessage> {
            var q: SigninMessage = new SigninMessage();
            q.jwt = jwt;
            q.rawAssertion = rawAssertion;
            q.realm = "browser";
            if (this.WebSocketClient.usingCordova) {
                q.realm = "mobile";
            }
            q.impersonate = impersonate;
            q.onesignalid = this.WebSocketClient.oneSignalId;
            q.device = this.WebSocketClient.device;
            q.gpslocation = this.WebSocketClient.location;
            var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<SigninMessage>(msg);
            this.WebSocketClient.user = q.user;
            this.WebSocketClient.jwt = q.jwt;
            this.$rootScope.$broadcast("signin", q);
            return q;
        }
        async SigninWithUsername(username: string, password: string, impersonate: string): Promise<SigninMessage> {
            var q: SigninMessage = new SigninMessage();
            q.username = username;
            q.password = password;
            q.realm = "browser";
            if (this.WebSocketClient.usingCordova) {
                q.realm = "mobile";
            }
            q.impersonate = impersonate;
            q.onesignalid = this.WebSocketClient.oneSignalId;
            q.device = this.WebSocketClient.device;
            q.gpslocation = this.WebSocketClient.location;
            var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<SigninMessage>(msg);
            this.WebSocketClient.user = q.user;
            this.WebSocketClient.jwt = q.jwt;
            this.$rootScope.$broadcast("signin", q);
            return q;
        }
        async ListCollections(): Promise<any[]> {
            var q: ListCollectionsMessage = new ListCollectionsMessage();
            var msg: Message = new Message(); msg.command = "listcollections"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<ListCollectionsMessage>(msg);
            return q.result;
        }
        async DropCollection(collectionname: string): Promise<void> {
            var q: DropCollectionMessage = new DropCollectionMessage();
            q.collectionname = collectionname;
            var msg: Message = new Message(); msg.command = "dropcollection"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<DropCollectionMessage>(msg);
        }
        async Query(collection: string, query: any, projection: any = null, orderby: any = { _created: -1 }, top: number = 100, skip: number = 0): Promise<any[]> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = collection; q.query = query;
            q.query = JSON.stringify(query, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
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
                this.messageQueue[q.correlationId] = new messagequeue(q, (msgresult: QueueMessage) => {
                    resolve(msgresult);
                    delete this.messageQueue[q.correlationId];
                });
                var res = await this.WebSocketClient.Send(msg);
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
            return q.result;
        }
        async GetNoderedInstanceLog(): Promise<string> {
            var q: GetNoderedInstanceLogMessage = new GetNoderedInstanceLogMessage();
            var msg: Message = new Message(); msg.command = "getnoderedinstancelog"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<GetNoderedInstanceLogMessage>(msg);
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

        async GetFile(filename: string, id: string, status: QueuedMessageStatusCallback = null): Promise<GetFileMessage> {
            var q: GetFileMessage = new GetFileMessage(); q.filename = filename;
            q.id = id;
            var msg: Message = new Message(); msg.command = "getfile";
            msg.data = JSONfn.stringify(q);
            var result: GetFileMessage = await this.WebSocketClient.Send<GetFileMessage>(msg, status);
            return result;
        }
        async SaveFile(filename: string, mimeType: string, metadata: any, file: string, status: QueuedMessageStatusCallback = null): Promise<SaveFileMessage> {
            var q: SaveFileMessage = new SaveFileMessage();
            q.filename = filename;
            q.mimeType = mimeType; q.file = file;
            q.metadata = metadata;
            var msg: Message = new Message(); msg.command = "savefile";
            msg.data = JSONfn.stringify(q);
            var result: SaveFileMessage = await this.WebSocketClient.Send<SaveFileMessage>(msg, status);
            return result;
        }
        async UpdateFile(id: string, metadata: any): Promise<void> {
            var q: UpdateFileMessage = new UpdateFileMessage();
            q.metadata = metadata; q.id = id;
            var msg: Message = new Message(); msg.command = "updatefile";
            msg.data = JSONfn.stringify(q);
            var result: UpdateFileMessage = await this.WebSocketClient.Send<UpdateFileMessage>(msg);
            return;
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


    export class textarea implements ng.IDirective {
        // restrict = 'E';
        // require = 'ngModel';
        replace = true;
        constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService) {

        }

        link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
            if (!element.hasClass("autogrow")) {
                // no autogrow for you today
                return;
            }

            // get possible minimum height style
            var minHeight = parseInt(window.getComputedStyle(element[0]).getPropertyValue("min-height")) || 0;

            // prevent newlines in textbox
            // element.on("keydown", function (evt) {
            //     if (evt.which === 13) {
            //         evt.preventDefault();
            //     }
            // });

            element.on("input", function (evt) {
                var contentHeight2 = (this as any).scrollHeight;
                var firstrun = element.attr("firstrun");
                if (contentHeight2 > 1000) {
                    if (firstrun === null || firstrun === undefined) {
                        element.attr("firstrun", "false");
                    } else {
                        return;
                    }
                }
                var currentContentHeight = (this as any).scrollHeight;
                var currentBorderHeight = (this as any).offsetHeight;
                {
                    element.css({
                        paddingTop: 0,
                        height: 0,
                        minHeight: 0
                    });

                    var contentHeight = (this as any).scrollHeight;
                    var borderHeight = (this as any).offsetHeight;

                    console.log("before: " + currentContentHeight + currentBorderHeight);

                    element.css({
                        paddingTop: ~~Math.max(0, minHeight - contentHeight) / 2 + "px",
                        minHeight: null, // remove property
                        height: contentHeight + borderHeight + "px" // because we're using border-box
                    });

                    contentHeight = (this as any).scrollHeight;
                    borderHeight = (this as any).offsetHeight;
                    console.log("after: " + contentHeight + borderHeight);

                }
            });

            // watch model changes from the outside to adjust height
            scope.$watch(attr.ngModel, trigger);

            // set initial size
            trigger();

            function trigger() {
                setTimeout(element.triggerHandler.bind(element, "input"), 1);
            }
        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService) => new textarea($location, $timeout);
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
                try {
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
                } catch (error) {
                    console.error(error);
                    return "error";
                }
            };
            var lib = (attr.lib ? attr.lib : "common");
            this.locale.ready(lib).then(() => {
                var value: string = null;
                if (ngModelCtrl !== null) {
                    ngModelCtrl.$formatters.push(function (value) {
                        return calculateValue(value);
                    });
                } else {
                    var hashCode = (s: string) => {
                        return s.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
                    }
                    if (attr.value !== null && attr.value !== undefined && element[0].tagName !== "OPTION") {
                        value = calculateValue(attr.value);
                        attr.$set('value', value);
                    } else {
                        value = element.text();
                        if (value !== null || value !== undefined) {
                            var result = calculateValue(value);
                            element.text(result);
                        }
                    }
                }
            });
        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new translate($location, $timeout, locale);
            directive.$inject = ['$location', '$timeout', 'locale'];
            return directive;
        }
    }
    export class fileread implements ng.IDirective {
        restrict = 'A';
        require = '?ngModel';
        constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
        }
        link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
            if (!ngModelCtrl) return;

            ngModelCtrl.$render = function () { };

            element.bind('change', function (changeEvent) {
                var reader = new FileReader();
                reader.onload = function (loadEvent) {
                    scope.$apply(function () {
                        var base64result = ((loadEvent.target as any).result as string).split(',')[1];
                        ngModelCtrl.$setViewValue(base64result);
                        (scope as any).filename = (changeEvent.target as any).files[0].name;
                        (scope as any).type = (changeEvent.target as any).files[0].type;
                    });
                }
                if ((changeEvent.target as any).files != null && (changeEvent.target as any).files.length > 0) {
                    reader.readAsDataURL((changeEvent.target as any).files[0]);
                }
            }); //change

        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new fileread($location, $timeout, locale);
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
        public autorefresh: boolean = false;
        public autorefreshinterval: number = 30 * 1000;
        public autorefreshpromise: any = null;
        public preloadData: any = null;
        public postloadData: any = null;
        public searchstring: string = "";
        public searchfields: string[] = ["name"];

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "$interval",
            "WebSocketClient",
            "api"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
        }
        async loadData(): Promise<void> {
            if (this.loading == true) { console.log("allready loading data, exit"); return; }
            this.loading = true;
            if (this.preloadData != null) {
                this.preloadData();
            }
            var query = this.basequery;
            if (this.searchstring !== "") {
                var finalor = [];
                for (var i = 0; i < this.searchfields.length; i++) {
                    var newq: any = {};
                    // exact match case sensitive
                    // newq[this.searchfields[i]] = this.searchstring;
                    // exact match case insensitive
                    newq[this.searchfields[i]] = new RegExp(["^", this.searchstring, "$"].join(""), "i");

                    // exact match string contains
                    newq[this.searchfields[i]] = new RegExp([this.searchstring].join(""), "i");

                    finalor.push(newq);
                }
                if (Object.keys(query).length == 0) {
                    query = { $or: finalor.concat() };
                } else {
                    query = { $and: [query, { $or: finalor.concat() }] };
                }
            }
            this.models = await this.api.Query(this.collection, query, this.baseprojection, this.orderby);
            this.loading = false;
            if (this.autorefresh) {
                if (this.models.length >= 100) {
                    // console.warn("Disabling auto refresh, result has more than 100 entries");
                } else {
                    if (this.autorefreshpromise == null && this.searchstring === "") {
                        //if (this.autorefreshpromise == null) {
                        this.autorefreshpromise = this.$interval(() => {
                            this.loadData();
                        }, this.autorefreshinterval);
                        this.$scope.$on('$destroy', () => {
                            this.$interval.cancel(this.autorefreshpromise);
                        });
                    }
                }
            }
            if (this.postloadData != null) {
                this.postloadData();
            } else {
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
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
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Search() {
            await this.loadData();
        }
    }

    export function nestedassign(target, source) {
        if (source === null || source === undefined) return null;
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i++) {
            var sourcekey = keys[i];
            if (Object.keys(source).find(targetkey => targetkey === sourcekey) !== undefined &&
                Object.keys(source).find(targetkey => targetkey === sourcekey) !== null
                && typeof source === "object" && typeof source[sourcekey] === "object") {
                target[sourcekey] = nestedassign(target[sourcekey], source[sourcekey]);
            } else {
                target[sourcekey] = source[sourcekey];
            }
        }
        return target;
    }
    export class entityCtrl<T> {
        public loading: boolean = false;
        public basequery: any = {};
        public baseprojection: any = {};
        public collection: string = "entities";
        public model: T = null;
        public id: string = null;
        public keys: string[] = [];
        public autorefresh: boolean = false;
        public autorefreshinterval: number = 30 * 1000;
        public autorefreshpromise: any = null;
        public preloadData: any = null;
        public postloadData: any = null;

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "$interval",
            "WebSocketClient",
            "api"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            this.id = $routeParams.id;
            this.basequery = { _id: this.id };
        }
        async loadData(): Promise<void> {
            if (this.loading == true) { console.log("allready loading data, exit"); return; }
            var updated: boolean = false;
            this.loading = true;
            if (this.preloadData != null) {
                this.preloadData();
            }

            var result = await this.api.Query(this.collection, this.basequery, this.baseprojection, null, 1);
            if (result.length > 0) {
                if (this.model == null) {
                    this.model = result[0];
                    updated = true;
                } else {
                    if (!angular.equals(this.model, result[0])) {
                        this.model = result[0];
                        updated = true;
                    }
                }

            }
            if (updated) {
                this.keys = Object.keys(this.model);
                for (var i: number = this.keys.length - 1; i >= 0; i--) {
                    if (this.keys[i].startsWith('_')) this.keys.splice(i, 1);
                }
            }
            this.loading = false;
            if (this.postloadData != null) {
                this.postloadData();
            } else {
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
            if (this.autorefresh) {
                if (this.autorefreshpromise == null) {
                    this.autorefreshpromise = this.$interval(() => {
                        this.loadData();
                    }, this.autorefreshinterval);
                    this.$scope.$on('$destroy', () => {
                        this.$interval.cancel(this.autorefreshpromise);
                    });
                }
            }
        }
    }
}
