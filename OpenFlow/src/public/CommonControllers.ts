// import angular from "angular";
// angular.isArray([]);
require('angular');
import angular from "angular";
import { WebSocketClientService } from "./WebSocketClientService";
import { NoderedUtil } from "@openiap/openflow-api";


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
function _timeToo(timeStamp) {
    const now: Date = new Date();
    let secondsPast: number = (now.getTime() - timeStamp.getTime()) / 1000;
    var suffix = "";
    if (secondsPast > 0) suffix = " ago";
    if (secondsPast < 0) secondsPast *= -1

    if (secondsPast < 60) {
        return parseInt(secondsPast.toString()) + 's' + suffix;
    }
    if (secondsPast < 3600) {
        return parseInt((secondsPast / 60).toString()) + 'm' + suffix;
    }
    if (secondsPast <= 86400) {
        return parseInt((secondsPast / 3600).toString()) + 'h' + suffix;
    }
    if (secondsPast > 86400) {
        let day = timeStamp.getDate();
        let month = timeStamp.toDateString().match(/ [a-zA-Z]*/)[0].replace(" ", "");
        let year = timeStamp.getFullYear() == now.getFullYear() ? "" : " " + timeStamp.getFullYear();
        return day + " " + month + year;
    }
}
// @ts-ignore
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
// @ts-ignore
export class timetoo implements ng.IDirective {
    // restrict = 'E';
    require = 'ngModel';
    replace = true;

    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService) {

    }

    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
        scope.$watch(() => {
            if (ngModelCtrl.$viewValue === null || ngModelCtrl.$viewValue === undefined) { return; }
            const timeStamp = ngModelCtrl.$viewValue;
            element.text(_timeToo(new Date(timeStamp)));
        });
    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService) => new timetoo($location, $timeout);
        directive.$inject = ['$location', '$timeout'];
        return directive;
    }
}
// @ts-ignore
export class formatBytes implements ng.IDirective {
    // restrict = 'E';
    require = 'ngModel';
    replace = true;

    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService) {

    }
    formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
        scope.$watch(() => {
            if (ngModelCtrl.$viewValue === null || ngModelCtrl.$viewValue === undefined) { return; }
            const size = ngModelCtrl.$viewValue;
            const decimal = parseInt(attr.decimal || 1);
            try {
                element.text(this.formatBytes(size, decimal));
            } catch (error) {
                console.error(error);
            }
        });
    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService) => new formatBytes($location, $timeout);
        directive.$inject = ['$location', '$timeout'];
        return directive;
    }
}
// @ts-ignore
export class whenScrolled implements ng.IDirective {
    constructor(public $rootScope: ng.IRootScopeService, public $window: ng.IWindowService, public $timeout: ng.ITimeoutService) {
    }
    link: ng.IDirectiveLinkFn = (scope: ng.IScope, elem: ng.IAugmentedJQuery, attrs: ng.IAttributes, ngModelCtrl: any) => {
        var checkWhenEnabled, handler, scrollDistance, scrollEnabled;
        // var $window = angular.element(this.$window);
        scrollDistance = 1;
        if (attrs.whenScrolledDistance != null) {
            scope.$watch(attrs.whenScrolledDistance, (value: any) => {
                return scrollDistance = parseInt(value, 10);
            });
        }
        scrollEnabled = true;
        checkWhenEnabled = false;
        if (attrs.whenScrolledDisabled != null) {
            scope.$watch(attrs.whenScrolledDisabled, (value) => {
                scrollEnabled = !value;
                if (scrollEnabled && checkWhenEnabled) {
                    checkWhenEnabled = false;
                    return handler();
                }
            });
        }
        handler = (e) => {
            var ele = elem[0].getBoundingClientRect();
            var scrollTop = window.scrollY || window.pageYOffset || document.body.scrollTop + (document.documentElement && document.documentElement.scrollTop || 0)



            var elementBottom, remaining, shouldScroll, windowBottom;
            windowBottom = window.innerHeight + scrollTop;
            elementBottom = ele.top + ele.height;
            remaining = elementBottom - windowBottom;
            shouldScroll = remaining <= this.$window.innerHeight * scrollDistance;
            if (shouldScroll && scrollEnabled && ele.height > 300) {
                if (this.$rootScope.$$phase) {
                    return scope.$eval(attrs.whenScrolled);
                } else {
                    return scope.$apply(attrs.whenScrolled);
                }
            } else if (shouldScroll) {
                return checkWhenEnabled = true;
            }
        };
        var mousewheelevt = (/Firefox/i.test(navigator.userAgent)) ? "DOMMouseScroll" : "mousewheel" //FF doesn't recognize mousewheel as of FF3.x

        var doc = document as any;
        if (doc.attachEvent)
            doc.attachEvent("on" + mousewheelevt, handler)
        else if (document.addEventListener) //WC3 browsers
            document.addEventListener(mousewheelevt, handler, false)

        // angular.element(this.$window).on('scroll', handler);
        scope.$on('$destroy', () => {
            var doc = document as any;
            if (doc.detachEvent)
                doc.detachEvent("on" + mousewheelevt, handler)
            else if (document.removeEventListener) //WC3 browsers
                document.removeEventListener(mousewheelevt, handler, false)
            // return this.$window.off('scroll', handler);
        });
        return this.$timeout((() => {
            if (attrs.whenScrolledImmediateCheck) {
                if (scope.$eval(attrs.whenScrolledImmediateCheck)) {
                    return handler();
                }
            } else {
                return handler();
            }
        }))
    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($rootScope: ng.IRootScopeService, $window: ng.IWindowService, $timeout: ng.ITimeoutService) => new whenScrolled($rootScope, $window, $timeout);
        directive.$inject = ['$rootScope', '$window', '$timeout'];
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

export class ngtype  { // implements ng.IDirective
    restrict = 'A';
    require = '?ngModel';
    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService) {
    }
    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
        if (NoderedUtil.IsNullUndefinded(ngModelCtrl)) { return; }
        var mytype = "";
        scope.$watch((newValue) => {
            if (ngModelCtrl.$viewValue === null || ngModelCtrl.$viewValue === undefined) { return; }
            if(mytype != "") return;;
            if (typeof ngModelCtrl.$modelValue === 'number') {
                mytype = "number";
                element.attr("type", "number");
            } else if (typeof ngModelCtrl.$modelValue === 'boolean') {
                mytype = "boolean";
                element.attr("type", "checkbox");
            } else {
                mytype = "text";
                element.attr("type", "text");
            }
            
        });

        var toModelb = function (value) {
            if (mytype == "boolean") {
                if (String(value).toLowerCase() == "true") { value = true; }
                else { value = false; }
            } else if (mytype == "number") {
                if(!NoderedUtil.IsNullEmpty(value)) {
                    if(value.toString().indexOf(".")>=0) { value = parseFloat(value); } 
                        else { value = parseInt(value); }
                }
            }
            return value;
        }
        var toViewb = function (value) {
            if (mytype == "") {
                if (typeof value === 'number') {
                    mytype = "number";
                    element.attr("type", "number");
                } else if (typeof value === 'boolean') {
                    mytype = "boolean";
                    element.attr("type", "checkbox");
                } else if (value != null && value != undefined && typeof value === 'string') {
                    mytype = "text";
                    element.attr("type", "text");
                }
            }
            if (mytype == "boolean") {
                if (String(value).toLowerCase() == "true") { value = true; }
                else { value = false; }
            } else if (mytype == "number") {
                if(NoderedUtil.IsNullEmpty(value)) {
                    if(value.toString().indexOf(".")>=0) { value = parseFloat(value); } 
                        else { value = parseInt(value); }
                }
            }
            return value;
        }
        ngModelCtrl.$formatters.push(toViewb);
        ngModelCtrl.$parsers.push(toModelb);
    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService) => new ngtype($location, $timeout);
        directive.$inject = ['$location', '$timeout'];
        return directive;
    }
}


async function getString(locale: any, lib: string, key: string): Promise<any> {
    return new Promise((resolve) => {
        try {
            if (locale === null || locale === undefined) { return }
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
export class translate   { // implements ng.IDirective
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
                        console.debug("KEY_NOT_FOUND " + lib + "." + value);
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
// implements ng.IDirective
export class copytext {
    restrict = 'A';
    require = '?ngModel';
    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
    }
    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {
        console.debug("copytext", element);
        if (!ngModelCtrl) return;
        element.attr('unselectable', 'on');
        element.on('mousedown', function (e, eventData) {
            /* istanbul ignore else: this is for catching the jqLite testing*/
            if (eventData) angular.extend(e, eventData);
            // this prevents focusout from firing on the editor when clicking toolbar buttons
            e.preventDefault();
            console.debug("Prevent mousedown");
            return false;
        });
    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new copytext($location, $timeout, locale);
        directive.$inject = ['$location', '$timeout', 'locale'];
        return directive;
    }
}
// implements ng.IDirective
export class jsonText {
    restrict = 'A';
    require = '?ngModel';
    constructor(public $location: ng.ILocationService, public $timeout: ng.ITimeoutService, public locale) {
    }
    link: ng.IDirectiveLinkFn = (scope: ng.IScope, element: ng.IAugmentedJQuery, attr: ng.IAttributes, ngModelCtrl: any) => {

        function into(input) {
            return JSON.parse(input);
        }
        function out(data) {
            return JSON.stringify(data, null, 2);
        }
        ngModelCtrl.$parsers.push(into);
        ngModelCtrl.$formatters.push(out);

    }
    static factory(): ng.IDirectiveFactory {
        const directive = ($location: ng.ILocationService, $timeout: ng.ITimeoutService, locale) => new jsonText($location, $timeout, locale);
        directive.$inject = ['$location', '$timeout', 'locale'];
        return directive;
    }
}
// implements ng.IDirective
export class fileread {
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
    public orderby: any = {};
    public autorefresh: boolean = false;
    public autorefreshinterval: number = 30 * 1000;
    public pagesize: number = 50;
    public autorefreshpromise: any = null;
    public preloadData: any = null;
    public postloadData: any = null;
    public searchstring: string = "";
    public lastsearchstring: string = "";
    public searchfields: string[] = ["name"];
    public basequeryas: string = null;
    public errormessage: string = "";
    public skipcustomerfilter: boolean = false;
    public page: number = 0;
    public _onKeyDown: any;
    public _onKeyUp: any;

    public static $inject = [
        "$rootScope",
        "$scope",
        "$location",
        "$routeParams",
        "$interval",
        "WebSocketClientService",
        "api",
        "userdata"
    ];
    constructor(
        public $rootScope: ng.IRootScopeService,
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        this._onKeyDown = this.onKeyDown.bind(this);
        this._onKeyUp = this.onKeyUp.bind(this);
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        $scope.$on('$destroy', () => {
            document.removeEventListener('keydown', this._onKeyDown);
            document.removeEventListener('keyup', this._onKeyUp);
        })
        if (this.userdata.data != null && this.userdata.data) {
            if (this.userdata.data.basequery != null) {
                this.basequery = this.userdata.data.basequery;
                delete this.userdata.data.basequery;
            }
            if (this.userdata.data.searchstring != null) {
                this.searchstring = this.userdata.data.searchstring;
                this.$rootScope.$broadcast("setsearch", this.searchstring);
                delete this.userdata.data.searchstring;
            }
            if (this.userdata.data.basequeryas != null) {
                this.basequeryas = this.userdata.data.basequeryas;
                delete this.userdata.data.basequeryas;
            }
        }
        this.$scope.$on('search', (event, data) => {
            this.searchstring = data;
            this.loadData();
        });

    }
    public controldown: boolean = false;
    public shiftdown: boolean = false;
    public onKeyDown(e) {
        if ((e.code == 'ControlLeft' || e.code == 'ControlRight') && !this.controldown) {
            this.controldown = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        if ((e.code == 'ShiftLeft' || e.code == 'ShiftRight') && !this.shiftdown) {
            this.shiftdown = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    public onKeyUp(e) {
        if ((e.code == 'ControlLeft' || e.code == 'ControlRight') && this.controldown) {
            this.controldown = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        if ((e.code == 'ShiftLeft' || e.code == 'ShiftRight') && this.shiftdown) {
            this.shiftdown = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    public static parseJson(txt, reviver, context) {
        context = context || 20
        try {
            return JSON.parse(txt, reviver)
        } catch (e) {
            if (typeof txt !== "string") {
                const isEmptyArray = Array.isArray(txt) && txt.length === 0
                const errorMessage = "Cannot parse " +
                    (isEmptyArray ? "an empty array" : String(txt))
                throw new TypeError(errorMessage)
            }
            const syntaxErr = e.message.match(/^Unexpected token.*position\s+(\d+)/i)
            const errIdx = syntaxErr
                ? +syntaxErr[1]
                : e.message.match(/^Unexpected end of JSON.*/i)
                    ? txt.length - 1
                    : null
            if (errIdx != null) {
                const start = errIdx <= context
                    ? 0
                    : errIdx - context
                const end = errIdx + context >= txt.length
                    ? txt.length
                    : errIdx + context
                e.message += ` while parsing near "${start === 0 ? "" : "..."
                    }${txt.slice(start, end)}${end === txt.length ? "" : "..."
                    }"`
            } else {
                e.message += ` while parsing "${txt.slice(0, context * 2)}"`
            }
            throw e
        }
    }
    async loadData(): Promise<void> {
        try {
            if (this.loading == true) { console.debug("allready loading data, exit"); return; }
            this.$rootScope.$broadcast("setsearch", this.searchstring);
            this.errormessage = "";
            this.loading = true;
            if (this.preloadData != null) {
                await this.preloadData();
            }
            let query: object = Object.assign({}, this.basequery);
            let exactquery: object = null;
            let basequeryas = this.basequeryas;
            // if (this.collection == "users" && (this.basequery._type == "user" || this.basequery._type == "role") && !this.skipcustomerfilter && this.WebSocketClientService.multi_tenant) {
            //     // if (!NoderedUtil.IsNullUndefinded(this.WebSocketClientService.customer) && !this.skipcustomerfilter) {
            //     //     basequeryas = this.WebSocketClientService.customer._id;
            //     // }
            //     if (this.WebSocketClientService.customer && !NoderedUtil.IsNullEmpty(this.WebSocketClientService.customer._id)) {
            //         query["customerid"] = this.WebSocketClientService.customer._id;
            //     }
            // }
            if (this.WebSocketClientService.multi_tenant && !NoderedUtil.IsNullUndefinded(this.WebSocketClientService.customer) && !this.skipcustomerfilter) {
                basequeryas = this.WebSocketClientService.customer._id;
            }

            let orderby = this.orderby;
            if (this.lastsearchstring !== this.searchstring) {
                this.models = [];
                this.orderby = null;
            }

            this.lastsearchstring = this.searchstring;
            if (this.searchstring !== "" && this.searchstring != null) {
                if ((this.searchstring as string).indexOf("{") == 0) {
                    if ((this.searchstring as string).lastIndexOf("}") == ((this.searchstring as string).length - 1)) {
                        try {
                            query = entitiesCtrl.parseJson(this.searchstring, null, null);
                        } catch (error) {
                            this.errormessage = error.message ? error.message : error;
                        }
                    }
                } else {
                    let finalor = [];
                    const finalexactor = [];
                    for (let i = 0; i < this.searchfields.length; i++) {
                        let newq: any = {};
                        const newexactq: any = {};
                        // exact match case sensitive
                        // newq[this.searchfields[i]] = this.searchstring;
                        // exact match case insensitive
                        newexactq[this.searchfields[i]] = new RegExp(["^", this.searchstring, "$"].join(""), "i");
                        // newexactq[this.searchfields[i]] = new RegExp(["^", this.searchstring].join(""), "i");

                        // exact match string contains
                        newq[this.searchfields[i]] = new RegExp([this.searchstring.substring(1)].join(""), "i");

                        finalor.push(newq);
                        finalexactor.push(newexactq);
                    }
                    finalexactor.push({ "_id": this.searchstring });
                    var hastextindex = false;
                    if (this.WebSocketClientService.collections_with_text_index.indexOf(this.collection) > -1) {
                        hastextindex = true;
                    }
                    if (!this.searchstring.startsWith(".") && hastextindex) {
                        finalor = [{ $text: { $search: this.searchstring.toLowerCase() } }]
                        console.debug("text search using ", this.searchstring.toLowerCase());
                    }
                    if (Object.keys(query).length == 0) {
                        query = { $or: finalor.concat() };
                        exactquery = { $or: finalexactor.concat() };
                    } else {
                        query = { $and: [query, { $or: finalor.concat() }] };
                        exactquery = { $and: [query, { $or: finalexactor.concat() }] };
                    }
                    if (!this.searchstring.startsWith(".") && hastextindex) {
                        exactquery = { "_searchnames": this.searchstring.toLowerCase() };
                    }

                }
            }
            if (this.WebSocketClientService.timeseries_collections.indexOf(this.collection) == -1 &&
                this.WebSocketClientService.collections_with_text_index.indexOf(this.collection) == -1) {
                if (NoderedUtil.IsNullUndefinded(this.orderby) || Object.keys(this.orderby).length == 0) {
                    orderby = { _created: -1 };
                }
            } else {
                if (NoderedUtil.IsNullUndefinded(this.orderby) || Object.keys(this.orderby).length == 0) {
                    if(this.collection == "audit" || this.collection == "dbusage") {
                        orderby = { _created: -1 };
                    }
                }
                if (!NoderedUtil.IsNullEmpty(this.searchstring) && !this.searchstring.startsWith(".")) {
                    // Remove order by when using text index
                    orderby = null;
                }
            }
            if (this.page == 0) {
                this.models = await NoderedUtil.Query({ collectionname: this.collection, query, projection: this.baseprojection, orderby, top: this.pagesize, queryas: basequeryas });
            } else {
                var temp = await NoderedUtil.Query({ collectionname: this.collection, query, projection: this.baseprojection, orderby, top: this.pagesize, skip: this.pagesize * this.page, queryas: basequeryas });
                this.models = this.models.concat(temp);
            }
            var hastext = this.WebSocketClientService.collections_with_text_index.indexOf(this.collection);
            var ists = this.WebSocketClientService.timeseries_collections.indexOf(this.collection);
            if (exactquery != null && this.page == 0 && hastext == -1 && ists == -1) {
                var temp = await NoderedUtil.Query({ collectionname: this.collection, query: exactquery, projection: this.baseprojection, orderby, top: 1, queryas: basequeryas });
                if (temp.length > 0) {
                    this.models = this.models.filter(x => (x as any)._id != temp[0]._id);
                    this.models = temp.concat(this.models);
                }
            }
            this.loading = false;
            if (this.autorefresh) {
                if (this.models.length >= this.pagesize || this.page > 0) {
                    // Disabling auto refresh, result has more than pagesize entries
                } else {
                    if (this.autorefreshpromise == null && this.searchstring === "") {
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
    more() {
        if (this.loading == true) { console.debug("allready loading data, exit"); return; }
        if (this.models.length < (this.pagesize - 15)) { console.debug("Seems there are no more data, exit"); return; }
        this.page++;
        this.loadData();
    }
    ToggleOrder(field: string) {
        if (this.orderby == null) this.orderby = {};
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
        this.page = 0;
        this.loadData();
    }
    async DeleteOne(model: any): Promise<any> {
        this.loading = true;
        this.errormessage = "";
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        try {
            let recursive: boolean = false;
            if (this.collection == "users" && (model._type == "user" || model._type == "customer")) {
                if (this.shiftdown == true) {
                    if (confirm("Confirm you want to HARD delete " + model.name + "\nWill delete all associated data") == true) {
                        recursive = true;
                    } else {
                        event.preventDefault();
                        return;
                    }
                }
            }
            await NoderedUtil.DeleteOne({ collectionname: this.collection, id: model._id, recursive });
            var oldcount = this.models.length;
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            if (this.models.length < oldcount && oldcount < 5) {
                this.loading = false;
                this.loadData();
            }
        } catch (error) {
            this.errormessage = error.message ? error.message : error;
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
    public weburl: string = "";

    public static $inject = [
        "$rootScope",
        "$scope",
        "$location",
        "$routeParams",
        "$sce",
        "$interval",
        "WebSocketClientService",
        "api",
        "userdata"
    ];
    constructor(
        public $rootScope: ng.IRootScopeService,
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $sce: ng.ISCEService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata,
    ) {
        this.id = $routeParams.id;
        this.basequery = { _id: this.id };
    }
    async loadData(): Promise<void> {
        try {
            if (this.loading == true) { console.debug("allready loading data, exit"); return; }
            this.errormessage = "";
            let updated: boolean = false;
            this.loading = true;
            if (this.preloadData != null) {
                this.preloadData();
            }

            const result = await NoderedUtil.Query({ collectionname: this.collection, query: this.basequery, projection: this.baseprojection, top: 1 });
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
            // @ts-ignore
            this.weburl = "//" + this.WebSocketClientService.agent_domain_schema.replace("$slug$", this.model.slug)
        } catch (error) {
            this.loading = false;
            this.errormessage = JSON.stringify(error);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
}
