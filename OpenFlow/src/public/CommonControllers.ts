module openflow {
    "use strict";
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

    async function getString(locale: any, lib:string, key:string):Promise<string> {
        return new Promise((resolve) => {
            try {
                if(locale===null || locale === undefined) { return resolve();}
                locale.ready(lib).then(function () {
                    var value = locale.getString(lib + "." + key);
                    if(value!==null && value!==undefined && value!== "") {
                        resolve(value);
                    } else {
                        resolve(key);
                    }
                });
            } catch (error) {
            }
        });
    }

    export class translate implements ng.IDirective {
        require = '?ngModel';
        replace = true;
        value: string = "";
        result: string = "";
        constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
        }
        link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
            var calculateValue = async (value) => {
                var lib = (attr.lib?attr.lib:"common");
                if (value.startsWith(lib + ".")) { return; }
                var key: string = (lib + "." + value).toLowerCase();
                this.result = await getString(this.locale, lib, value);
                // this.result = this.locale.getString(key);
                // console.log(key + "=" + this.result);

                if (this.result == "%%KEY_NOT_FOUND%%" || this.result == "") {
                    this.result = value;
                }
                element.text(this.result);
                if(value == attr.value) {
                    attr.$set('value', this.result);
                }
            };
            scope.$watch("name", () => {
                this.value = attr.value;
                if (ngModelCtrl !== null) { this.value = ngModelCtrl.$viewValue; }
                if (this.value === null || this.value === undefined) { this.value = ""; }
                this.value = this.value.trim();
                if (this.value === "") { this.value = element.text(); }
                if (this.value === null || this.value === undefined) { this.value = ""; }
                this.value = this.value.trim();
                if(this.value!=="") { calculateValue(this.value); }
                return this.value.trim();
            });
        }
        static factory(): ng.IDirectiveFactory {
            const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new translate($location, $timeout, locale);
            directive.$inject = ['$location', '$timeout', 'locale'];
            return directive;
        }
    }

    export class entitiesCtrl {
        public basequery: any = {};
        public baseprojection: any = {};
        public collection: string = "entities";
        public models: any[] = [];
        public orderby: any = { _created: -1 };

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient
        ) {
        }
        async loadData(): Promise<void> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = this.collection; q.query = this.basequery;
            q.projection = this.baseprojection; q.orderby = this.orderby;
            var msg: Message = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<QueryMessage>(msg);
            this.models = q.result;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Insert(model: any): Promise<any> {
            var q: InsertOneMessage = new InsertOneMessage();
            // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            q.collectionname = this.collection; q.item = model;
            var msg: Message = new Message(); msg.command = "insertone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<InsertOneMessage>(msg);
            return q.result;
        }
        async Update(model: any): Promise<any> {
            var q: UpdateOneMessage = new UpdateOneMessage();
            // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            q.collectionname = this.collection; q.item = model;
            var msg: Message = new Message(); msg.command = "updateone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<UpdateOneMessage>(msg);
            return q.result;
        }
        async Delete(model: any): Promise<void> {
            var q: DeleteOneMessage = new DeleteOneMessage();
            q.collectionname = this.collection; q._id = model._id;
            var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<DeleteOneMessage>(msg);
            // this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            // if (!this.$scope.$$phase) { this.$scope.$apply(); }
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


    export class entityCtrl {
        public basequery: any = {};
        public baseprojection: any = {};
        public collection: string = "entities";
        public model: any = null;
        public id: string = null;
        public keys: string[] = [];

        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient"
        ];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient
        ) {
            this.id = $routeParams.id;
            this.basequery = { _id: this.id };
        }
        async loadData(): Promise<void> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = this.collection; q.query = this.basequery;
            q.projection = this.baseprojection; q.top = 1;
            var msg: Message = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<QueryMessage>(msg);
            if (q.result.length > 0) { this.model = q.result[0]; }
            this.keys = Object.keys(this.model);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Insert(model: any): Promise<any> {
            var q: InsertOneMessage = new InsertOneMessage();
            // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            q.collectionname = this.collection; q.item = model;
            var msg: Message = new Message(); msg.command = "insertone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<InsertOneMessage>(msg);
            return q.result;
        }
        async Update(model: any): Promise<any> {
            var q: UpdateOneMessage = new UpdateOneMessage();
            // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            q.collectionname = this.collection; q.item = model;
            var msg: Message = new Message(); msg.command = "updateone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<UpdateOneMessage>(msg);
            return q.result;
        }
        async Delete(model: any): Promise<void> {
            var q: DeleteOneMessage = new DeleteOneMessage();
            q.collectionname = this.collection; q._id = model._id;
            var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<DeleteOneMessage>(msg);
        }
    }
}
