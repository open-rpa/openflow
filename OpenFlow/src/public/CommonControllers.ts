import angular = require("angular");
import { WebSocketClientService } from "./WebSocketClientService";
import { NoderedUtil } from "openflow-api";


export class api {
    static $inject = ["$rootScope", "$location", "WebSocketClientService"];
    constructor(public $rootScope: ng.IRootScopeService, public $location, public WebSocketClientService: WebSocketClientService) {
    }
}



function _timeSince(timeStamp) {
    const now: Date = new Date(),
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
            const timeStamp = ngModelCtrl.$viewValue;
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
        const minHeight = parseInt(window.getComputedStyle(element[0]).getPropertyValue("min-height")) || 0;

        // prevent newlines in textbox
        // element.on("keydown", function (evt) {
        //     if (evt.which === 13) {
        //         evt.preventDefault();
        //     }
        // });

        element.on("input", function (evt) {
            const contentHeight2 = (this as any).scrollHeight;
            const firstrun = element.attr("firstrun");
            if (contentHeight2 > 1000) {
                if (firstrun === null || firstrun === undefined) {
                    element.attr("firstrun", "false");
                } else {
                    return;
                }
            }
            {
                element.css({
                    paddingTop: 0,
                    height: 0,
                    minHeight: 0
                });
                const contentHeight = (this as any).scrollHeight;
                const borderHeight = (this as any).offsetHeight;
                element.css({
                    paddingTop: ~~Math.max(0, minHeight - contentHeight) / 2 + "px",
                    minHeight: null, // remove property
                    height: contentHeight + borderHeight + "px" // because we're using border-box
                });
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
                const value = locale.getString(lib + "." + key);
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
const global_translate_notfound: string[] = [];
export class translate implements ng.IDirective {
    require = '?ngModel';
    replace = true;

    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
    }
    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
        const calculateValue = (value: string): string => {
            try {
                if (value === null || value === undefined || value === "") return value;
                const lib = (attr.lib ? attr.lib : "common");
                if ((value.toString()).startsWith(lib + ".")) { return; }
                const key: string = (lib + "." + value).toLowerCase();
                let result = this.locale.getString(key);
                if (result.startsWith(lib + ".")) { result = result.slice((lib + ".").length); }
                // const result = await getString(this.locale, lib, value);
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
        const lib = (attr.lib ? attr.lib : "common");
        this.locale.ready(lib).then(() => {
            let value: string = null;
            if (ngModelCtrl !== null) {
                ngModelCtrl.$formatters.push(function (value) {
                    return calculateValue(value);
                });
            } else {
                const hashCode = (s: string) => {
                    return s.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
                }
                if (attr.value !== null && attr.value !== undefined && element[0].tagName !== "OPTION") {
                    value = calculateValue(attr.value);
                    attr.$set('value', value);
                } else {
                    value = element.text();
                    if (value !== null || value !== undefined) {
                        const result = calculateValue(value);
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
export class userdata {
    public data: any;
    constructor() {
        this.data = {};
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
            const reader = new FileReader();
            reader.onload = function (loadEvent) {
                scope.$apply(function () {
                    const base64result = ((loadEvent.target as any).result as string).split(',')[1];
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
    public orderby: any = { _id: -1 };
    public autorefresh: boolean = false;
    public autorefreshinterval: number = 30 * 1000;
    public pagesize: number = 100;
    public autorefreshpromise: any = null;
    public preloadData: any = null;
    public postloadData: any = null;
    public searchstring: string = "";
    public searchfields: string[] = ["name"];
    public basequeryas: string = null;
    public errormessage: string = "";

    public static $inject = [
        "$scope",
        "$location",
        "$routeParams",
        "$interval",
        "WebSocketClientService",
        "api",
        "userdata"
    ];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        if (this.userdata.data != null && this.userdata.data) {
            if (this.userdata.data.basequery != null) {
                this.basequery = this.userdata.data.basequery;
                delete this.userdata.data.basequery;
            }
            if (this.userdata.data.searchstring != null) {
                this.searchstring = this.userdata.data.searchstring;
                delete this.userdata.data.searchstring;
            }
            if (this.userdata.data.basequeryas != null) {
                this.basequeryas = this.userdata.data.basequeryas;
                delete this.userdata.data.basequeryas;
            }
        }
    }
    async loadData(): Promise<void> {
        try {
            if (this.loading == true) { console.log("allready loading data, exit"); return; }
            this.errormessage = "";
            this.loading = true;
            if (this.preloadData != null) {
                this.preloadData();
            }
            let query = this.basequery;
            if (this.searchstring !== "") {
                const finalor = [];
                for (let i = 0; i < this.searchfields.length; i++) {
                    const newq: any = {};
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
            this.models = await NoderedUtil.Query(this.collection, query, this.baseprojection, this.orderby, this.pagesize, 0, null, this.basequeryas);
            this.loading = false;
            if (this.autorefresh) {
                if (this.models.length >= this.pagesize) {
                    // console.warn("Disabling auto refresh, result has more than pagesize entries");
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
        } catch (error) {
            this.loading = false;
            this.errormessage = JSON.stringify(error);
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
        try {
            await NoderedUtil.DeleteOne(this.collection, model._id, null);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
        } catch (error) {
            this.errormessage = error;
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async Search() {
        await this.loadData();
    }
}

export function nestedassign(target, source) {
    if (source === null || source === undefined) return null;
    const keys = Object.keys(source);
    for (let i = 0; i < keys.length; i++) {
        const sourcekey = keys[i];
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
    public errormessage: string = "";

    public static $inject = [
        "$scope",
        "$location",
        "$routeParams",
        "$interval",
        "WebSocketClientService",
        "api"
    ];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        this.id = $routeParams.id;
        this.basequery = { _id: this.id };
    }
    async loadData(): Promise<void> {
        try {
            if (this.loading == true) { console.log("allready loading data, exit"); return; }
            this.errormessage = "";
            let updated: boolean = false;
            this.loading = true;
            if (this.preloadData != null) {
                this.preloadData();
            }

            const result = await NoderedUtil.Query(this.collection, this.basequery, this.baseprojection, null, 1, 0, null);
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
                for (let i: number = this.keys.length - 1; i >= 0; i--) {
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
        } catch (error) {
            this.loading = false;
            this.errormessage = JSON.stringify(error);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
}
