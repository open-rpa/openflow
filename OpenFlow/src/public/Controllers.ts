module openflow {
    // "use strict";



    function treatAsUTC(date): number {
        var result = new Date(date);
        result.setMinutes(result.getMinutes() - result.getTimezoneOffset());
        return result as any;
    }

    function daysBetween(startDate, endDate): number {
        var millisecondsPerDay = 24 * 60 * 60 * 1000;
        return (treatAsUTC(endDate) - treatAsUTC(startDate)) / millisecondsPerDay;
    }
    declare var jsondiffpatch: any;
    declare var Formio: any;

    export class RPAWorkflowCtrl extends entityCtrl<openflow.RPAWorkflow> {
        public arguments: any;
        public users: TokenUser[];
        public user: TokenUser;
        public messages: string;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("RPAWorkflowCtrl");
            this.collection = "openrpa";
            this.messages = "";
            WebSocketClient.onSignedin(async (_user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    await api.RegisterQueue();
                    await this.loadData();
                    await this.loadUsers();
                    $scope.$on('queuemessage', (event, data: QueueMessage) => {
                        if (event && data) { }
                        console.debug(data);
                        this.messages += data.data.command + "\n";
                        if (data.data.command == "invokecompleted") {
                            this.arguments = data.data.data;
                        }
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    });

                } else {
                    console.error("Missing id");
                }
            });
        }
        async loadUsers(): Promise<void> {
            this.users = await this.api.Query("users", { $or: [{ _type: "user" }, { _type: "role", rparole: true }] }, null, null);
            this.users.forEach(user => {
                if (user._id == this.model._createdbyid || user._id == this.model._createdbyid) {
                    this.user = user;
                }
            });
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async submit(): Promise<void> {
            var rpacommand = {
                command: "invoke",
                workflowid: this.model._id,
                data: this.arguments
            }
            if (this.arguments === null || this.arguments === undefined) { this.arguments = {}; }
            // var message = {
            //     jwt: this.WebSocketClient.jwt,
            //     payload: rpacommand
            // }
            var result: any = await this.api.QueueMessage(this.user._id, rpacommand);
            try {
                // result = JSON.parse(result);
            } catch (error) {
            }
        }
    }

    export class RPAWorkflowsCtrl extends entitiesCtrl<openflow.Base> {
        public message: string = "";
        public charts: chartset[] = [];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("RPAWorkflowsCtrl");
            this.collection = "openrpa";
            this.basequery = { _type: "workflow" };
            this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
            this.postloadData = this.processdata;
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async processdata() {
            this.loading = true;
            this.charts = [];
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            var chart: chartset = null;
            for (var i = 0; i < this.models.length; i++) {
                var workflow = this.models[i] as any;
                var d = new Date();
                //d.setMonth(d.getMonth() - 1);
                d.setDate(d.getDate() - 7);
                console.debug("get mapreduce of instances");
                var stats = await this.api.MapReduce("openrpa_instances",
                    function map() {
                        var startDate = new Date(this._created);
                        this.count = 1;
                        emit(startDate.toISOString().split('T')[0], this);
                    }, function reduce(key, values) {
                        var reducedObject = { count: 0, value: 0, avg: 0, minrun: 0, maxrun: 0, run: 0, _acl: [] };
                        values.forEach(function (value) {
                            var startDate = new Date(value._created);
                            var endDate = new Date(value._modified);
                            var seconds = (endDate.getTime() - startDate.getTime()) / 1000;
                            if (reducedObject.minrun == 0 && seconds > 0) reducedObject.minrun = seconds;
                            if (reducedObject.minrun > seconds) reducedObject.minrun = seconds;
                            if (reducedObject.maxrun < seconds) reducedObject.maxrun = seconds;
                            reducedObject.run += seconds;
                            reducedObject.count += value.count;
                            reducedObject._acl = value._acl;
                        });
                        return reducedObject;
                    }, function finalize(key, reducedValue) {
                        if (reducedValue.count > 0) {
                            reducedValue.avg = reducedValue.value / reducedValue.count;
                            reducedValue.run = reducedValue.run / reducedValue.count;
                        }
                        return reducedValue;
                    }, { _type: "workflowinstance", WorkflowId: workflow._id, "_created": { "$gte": new Date(d.toISOString()) } }, { inline: 1 }, null);

                chart = new chartset();
                chart.charttype = "line"
                chart.data = [];
                var lastdate = "";
                var days = daysBetween(d, new Date());
                for (var y = 0; y < days; y++) {
                    var startDate = new Date(d);
                    startDate.setDate(d.getDate() + y);
                    var datestring = startDate.toISOString().split('T')[0];
                    var exists = stats.filter(m => m._id == datestring);
                    if (exists.length > 0) {
                        chart.data.push(exists[0].value.count);
                    } else {
                        chart.data.push(0);
                    }
                    if ((y % 2) == 0 || (days == 30 && y == 30)) {
                        chart.labels.push(startDate.getDate().toString());
                    } else {
                        chart.labels.push("");
                    }
                }
                workflow.chart = chart;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }


    export class WorkflowsCtrl extends entitiesCtrl<openflow.Base> {
        public message: string = "";
        public charts: chartset[] = [];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.collection = "workflow";
            this.basequery = { _type: "workflow", web: true };
            console.debug("WorkflowsCtrl");
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
    }


    export class chartset {
        options: any = {
            legend: { display: true }
        };
        baseColors: string[] = ['#F7464A', '#97BBCD', '#FDB45C', '#46BFBD', '#949FB1', '#4D5360'];
        colors: string[] = this.baseColors;
        type: string = 'bar';
        heading: string = "";
        labels: string[] = [];
        series: string[] = [];
        data: any[] = [];
        charttype: string = "bar";

    }
    export declare function emit(k, v);
    export class ReportsCtrl extends entitiesCtrl<openflow.Base> {
        public message: string = "";
        public charts: chartset[] = [];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("ReportsCtrl");
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.processData();
            });
        }
        async processData(): Promise<void> {
            this.loading = true;
            this.charts = [];
            var chart: chartset = null;

            console.debug("get mapreduce of instances");
            var stats = await this.api.MapReduce("openrpa_instances",
                function map() {
                    this.count = 1;
                    emit(this.WorkflowId, this);
                }, function reduce(key, values) {
                    var reducedObject = { count: 0, value: 0, avg: 0, minrun: 0, maxrun: 0, run: 0, _acl: [] };
                    values.forEach(function (value) {
                        var startDate = new Date(value._created);
                        var endDate = new Date(value._modified);
                        var seconds = (endDate.getTime() - startDate.getTime()) / 1000;
                        if (reducedObject.minrun == 0 && seconds > 0) reducedObject.minrun = seconds;
                        if (reducedObject.minrun > seconds) reducedObject.minrun = seconds;
                        if (reducedObject.maxrun < seconds) reducedObject.maxrun = seconds;
                        reducedObject.run += seconds;
                        reducedObject.count += value.count;
                        reducedObject._acl = value._acl;
                    });
                    return reducedObject;
                }, function finalize(key, reducedValue) {
                    if (reducedValue.count > 0) {
                        reducedValue.avg = reducedValue.value / reducedValue.count;
                        reducedValue.run = reducedValue.run / reducedValue.count;
                    }
                    return reducedValue;
                }, {}, { inline: 1 }, null);


            var workflows = await this.api.Query("openrpa", { _type: "workflow" }, null, null);
            var workflowids = [];
            workflows.forEach(workflow => {
                workflowids.push(workflow._id);
            });
            var q = { WorkflowId: { $in: workflowids } }
            var instances = await this.api.Query("openrpa_instances", q, null, null);



            chart = new chartset();
            chart.heading = "compare run times";
            chart.series = ['minrun', 'avgrun', 'maxrun'];
            // chart.labels = ['ok', 'warning', 'alarm'];
            chart.data = [[], [], []];
            for (var x = 0; x < stats.length; x++) {
                var model = stats[x].value;
                var _id = stats[x]._id;
                var workflow = workflows.filter(y => y._id == _id)[0];
                if (workflow !== undefined) {
                    chart.data[0].push(model.minrun);
                    chart.data[1].push(model.run);
                    chart.data[2].push(model.maxrun);
                    var id = stats[x]._id;
                    var workflow = workflows.filter(x => x._id == id)[0];
                    if (workflow == undefined) { chart.labels.push("unknown"); } else { chart.labels.push(workflow.name); }
                }
            }
            this.charts.push(chart);



            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }



        async InsertNew(): Promise<void> {
            // this.loading = true;
            var model = { name: "Find me " + Math.random().toString(36).substr(2, 9), "temp": "hi mom" };
            var result = await this.api.Insert(this.collection, model);
            this.models.push(result);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async UpdateOne(model: any): Promise<any> {
            var index = this.models.indexOf(model);
            this.loading = true;
            model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            var newmodel = await this.api.Update(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.models.splice(index, 0, newmodel);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async InsertMany(): Promise<void> {
            this.loading = true;
            var Promises: Promise<InsertOneMessage>[] = [];
            var q: InsertOneMessage = new InsertOneMessage();
            for (var i: number = (this.models.length); i < (this.models.length + 50); i++) {
                q.collectionname = "entities"; q.item = { name: "findme " + i.toString(), "temp": "hi mom" };
                var msg: Message = new Message(); msg.command = "insertone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            }
            const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values: InsertOneMessage[] = results.filter(result => !(result instanceof Error));
            // this.models.push(...values);
            values.forEach(element => {
                this.models.push(element.result);
            });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteMany(): Promise<void> {
            this.loading = true;
            var Promises: Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = "entities"; q._id = (model as any)._id;
                var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values: DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids: string[] = [];
            values.forEach((x: DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any): boolean { return ids.indexOf(m._id) === -1; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }

    export class MainCtrl extends entitiesCtrl<openflow.Base> {
        searchFilteredList: string[] = [];
        countryList: string[] = [];
        searchtext: string = "";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api,
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("MainCtrl");
            this.collection = "workflow_instances"
            this.basequery = { state: { $ne: "completed" }, form: { $exists: true } };

            ($scope as any).selected = undefined;
            ($scope as any).states = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois'];
            ($scope as any).names = ["john", "bill", "charlie", "robert", "alban", "oscar", "marie", "celine", "brad", "drew", "rebecca", "michel", "francis", "jean", "paul", "pierre", "nicolas", "alfred", "gerard", "louis", "albert", "edouard", "benoit", "guillaume", "nicolas", "joseph"];
            this.countryList = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Anguilla", "Antigua &amp; Barbuda", "Argentina", "Armenia", "Aruba", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bermuda", "Bhutan", "Bolivia", "Bosnia &amp; Herzegovina", "Botswana", "Brazil", "British Virgin Islands", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Cape Verde", "Cayman Islands", "Chad", "Chile", "China", "Colombia", "Congo", "Cook Islands", "Costa Rica", "Cote D Ivoire", "Croatia", "Cruise Ship", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Estonia", "Ethiopia", "Falkland Islands", "Faroe Islands", "Fiji", "Finland", "France", "French Polynesia", "French West Indies", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Grenada", "Guam", "Guatemala", "Guernsey", "Guinea", "Guinea Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Isle of Man", "Israel", "Italy", "Jamaica", "Japan", "Jersey", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Kyrgyz Republic", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau", "Macedonia", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Montserrat", "Morocco", "Mozambique", "Namibia", "Nepal", "Netherlands", "Netherlands Antilles", "New Caledonia", "New Zealand", "Nicaragua", "Niger", "Nigeria", "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico", "Qatar", "Reunion", "Romania", "Russia", "Rwanda", "Saint Pierre &amp; Miquelon", "Samoa", "San Marino", "Satellite", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "St Kitts &amp; Nevis", "St Lucia", "St Vincent", "St. Lucia", "Sudan", "Suriname", "Swaziland", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor L'Este", "Togo", "Tonga", "Trinidad &amp; Tobago", "Tunisia", "Turkey", "Turkmenistan", "Turks &amp; Caicos", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Virgin Islands (US)", "Yemen", "Zambia", "Zimbabwe"];
            WebSocketClient.onSignedin((_user: TokenUser) => {
                this.loadData();
            });


            // Formio.createForm(document.getElementById('formio'), 'https://examples.form.io/example');

            // $scope.$watch('searchtext', (newValue) => {
            //     this.complete(newValue);
            // });
        }

        localSearch() {
            return [];
        }
        e: any = null;
        setkey(e) {
            this.e = e;
            this.handlekeys();
        }
        handlekeys() {
            if (this.searchFilteredList.length > 0) {
                var lowerCaseNames = this.searchFilteredList.map(function (value) {
                    return value.toLowerCase();
                });
                var idx: number = lowerCaseNames.indexOf(this.searchtext.toLowerCase());
                if (this.e.keyCode == 38) { // up
                    if (idx <= 0) {
                        idx = 0;
                    } else { idx--; }
                    this.searchtext = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 40) { // down
                    if (idx >= this.searchFilteredList.length) {
                        idx = this.searchFilteredList.length - 1;
                    } else { idx++; }
                    this.searchtext = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 13) { // enter
                    if (idx >= 0) {
                        this.searchtext = this.searchFilteredList[idx];
                        this.searchFilteredList = [];
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    }
                }
            }
        }
        handlefilter(e) {
            this.e = e;
            var output = [];
            angular.forEach(this.countryList, (country) => {
                if (country.toLowerCase().indexOf(this.searchtext.toLowerCase()) >= 0) {
                    output.push(country);
                }
            });
            this.searchFilteredList = output;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        fillTextbox(searchtext) {
            var lowerCaseNames = this.searchFilteredList.map(function (value) {
                return value.toLowerCase();
            });
            var idx: number = lowerCaseNames.indexOf(searchtext.toLowerCase());
            if (idx >= 0) {
                this.searchtext = this.searchFilteredList[idx];
                this.searchFilteredList = [];
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
        }
    }
    declare var QRScanner: any;
    export class LoginCtrl {
        public localenabled: boolean = false;
        public scanning: boolean = false;
        public qrcodescan: boolean = false;
        public providers: any = false;
        public username: string = "";
        public password: string = "";
        public message: string = "";
        public domain: string = "";
        public allow_user_registration: boolean = false;
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
            console.debug("LoginCtrl::constructor");
            this.domain = window.location.hostname;
            WebSocketClient.getJSON("/loginproviders", async (error: any, data: any) => {
                this.providers = data;
                this.allow_user_registration = WebSocketClient.allow_user_registration;
                for (var i: number = this.providers.length - 1; i >= 0; i--) {
                    if (this.providers[i].provider == "local") {
                        this.providers.splice(i, 1);
                        this.localenabled = true;
                    }
                }
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                setTimeout(this.scanForQRScanner.bind(this), 200);
            });
        }
        readfile(filename: string) {
            return new Promise<string>(async (resolve, reject) => {
                var win: any = window;
                //var type = win.TEMPORARY;
                var type = win.PERSISTENT;
                var size = 5 * 1024 * 1024;
                win.requestFileSystem(type, size, successCallback, errorCallback)
                function successCallback(fs) {
                    fs.root.getFile(filename, {}, function (fileEntry) {

                        fileEntry.file(function (file) {
                            var reader = new FileReader();
                            reader.onloadend = function (e) {
                                resolve(this.result as string);
                            };
                            reader.readAsText(file);
                        }, errorCallback);
                    }, errorCallback);
                }
                function errorCallback(error) {
                    console.debug(error);
                    resolve();
                }
            });
        }
        writefile(filename: string, content: string) {
            return new Promise<string>(async (resolve, reject) => {
                var win: any = window;
                //var type = win.TEMPORARY;
                var type = win.PERSISTENT;
                var size = 5 * 1024 * 1024;
                win.requestFileSystem(type, size, successCallback, errorCallback)
                function successCallback(fs) {
                    fs.root.getFile(filename, { create: true }, function (fileEntry) {
                        fileEntry.createWriter(function (fileWriter) {
                            fileWriter.onwriteend = function (e) {
                                console.debug('Write completed.');
                                resolve();
                            };
                            fileWriter.onerror = function (e) {
                                console.error('Write failed: ' + e.toString());
                                resolve();
                            };
                            var blob = new Blob([content], { type: 'text/plain' });
                            fileWriter.write(blob);
                        }, errorCallback);
                    }, errorCallback);
                }
                function errorCallback(error) {
                    console.error(error);
                    resolve();
                }
            });
        }
        scanForQRScanner() {
            try {
                if (QRScanner !== undefined) {
                    console.debug("Found QRScanner!!!!");
                    this.qrcodescan = true;
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                } else {
                    console.debug("QRScanner not definded");
                    setTimeout(this.scanForQRScanner, 200);
                }
            } catch (error) {
                console.debug("Failed locating QRScanner");
                setTimeout(this.scanForQRScanner, 200);
            }
        }
        Scan() {
            try {
                console.debug("Scan");
                if (this.scanning) {
                    this.scanning = false;
                    QRScanner.destroy();
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    return;
                }
                this.scanning = true;
                QRScanner.scan(this.QRScannerHit.bind(this));
                QRScanner.show();
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            } catch (error) {
                console.error("Error Scan");
                console.error(error);
            }
        }
        async QRScannerHit(err, value) {
            try {
                console.debug("QRScannerHit");
                if (err) {
                    // console.error(err._message);
                    console.error(err);
                    return;
                }
                console.debug(value);
                QRScanner.hide();
                QRScanner.destroy();

                this.scanning = false;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                if (value === null || value === undefined || value === "") {
                    console.debug("QRCode had null value"); return;
                }
                console.debug("QRCode value: " + value);
                var config = JSON.parse(value);
                if (config.url !== null || config.url !== undefined || config.url !== "" || config.loginurl !== null || config.loginurl !== undefined || config.loginurl !== "") {
                    console.debug("set mobiledomain to " + value);
                    await this.writefile("mobiledomain.txt", value);
                    window.location.replace(config.url);
                }
            } catch (error) {
                console.error("Error QRScannerHit");
                console.error(error);

            }
        }
        async submit(): Promise<void> {
            this.message = "";
            try {
                console.debug("signing in with username/password");
                var result: SigninMessage = await this.api.SigninWithUsername(this.username, this.password, null);
                if (result.user == null) { return; }
                this.$location.path("/");
            } catch (error) {
                this.message = error;
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class MenuCtrl {
        public user: TokenUser;
        public signedin: boolean = false;
        public path: string = "";
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
            console.debug("MenuCtrl::constructor");
            $scope.$root.$on('$routeChangeStart', (...args) => { this.routeChangeStart.apply(this, args); });
            this.path = this.$location.path();
            var cleanup = this.$scope.$on('signin', (event, data) => {
                if (event && data) { }
                this.user = data.user;
                this.signedin = true;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                // cleanup();
            });
        }
        routeChangeStart(event: any, next: any, current: any) {
            this.path = this.$location.path();
        }
        hasrole(role: string) {
            if (this.WebSocketClient.user === null || this.WebSocketClient.user === undefined) return false;
            var hits = this.WebSocketClient.user.roles.filter(member => member.name == role);
            return (hits.length == 1)
        }
        hascordova() {
            return this.WebSocketClient.usingCordova;
        }
    }

    export class ProvidersCtrl extends entitiesCtrl<openflow.Provider> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("ProvidersCtrl");
            this.basequery = { _type: "provider" };
            this.collection = "config";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }

    }
    export class ProviderCtrl extends entityCtrl<openflow.Provider> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("ProviderCtrl");
            this.collection = "config";
            WebSocketClient.onSignedin((user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    this.loadData();
                } else {
                    this.model = new Provider("", "", "", "uri:" + this.WebSocketClient.domain,
                        "")
                }

            });
        }
        async submit(): Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Providers");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }



    export class UsersCtrl extends entitiesCtrl<openflow.TokenUser> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.autorefresh = true;
            console.debug("UsersCtrl");
            this.basequery = { _type: "user" };
            this.collection = "users";
            this.searchfields = ["name", "username"];
            this.postloadData = this.processData;
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async processData(): Promise<void> {
            var chart: chartset = null;
            // for (var i = 0; i < this.models.length; i++) {
            //     var user = this.models[i] as any;
            //     var d = new Date();
            //     // d.setMonth(d.getMonth() - 1);
            //     d.setDate(d.getDate() - 7);
            //     console.debug("get mapreduce for " + user.name);
            //     var stats = await this.api.MapReduce("audit",
            //         function map() {
            //             var startDate = new Date(this._created);
            //             this.count = 1;
            //             emit(startDate.toISOString().split('T')[0], this);
            //         }, function reduce(key, values) {
            //             var reducedObject = { count: 0, value: 0, avg: 0, minrun: 0, maxrun: 0, run: 0, _acl: [] };
            //             values.forEach(function (value) {
            //                 reducedObject.count += value.count;
            //                 reducedObject._acl = value._acl;
            //             });
            //             return reducedObject;
            //         }, function finalize(key, reducedValue) {
            //             if (reducedValue.count > 0) {
            //                 reducedValue.avg = reducedValue.value / reducedValue.count;
            //             }
            //             return reducedValue;
            //         }, { userid: user._id, "_created": { "$gte": new Date(d.toISOString()) } }, { inline: 1 }, null);

            //     chart = new chartset();
            //     chart.charttype = "line"
            //     chart.data = [];
            //     var days = daysBetween(d, new Date());
            //     for (var y = 0; y < days; y++) {
            //         var startDate = new Date(d);
            //         startDate.setDate(d.getDate() + y);
            //         var datestring = startDate.toISOString().split('T')[0];
            //         var exists = stats.filter(m => m._id == datestring);
            //         if (exists.length > 0) {
            //             chart.data.push(exists[0].value.count);
            //         } else {
            //             chart.data.push(0);
            //         }
            //         //chart.labels.push(datestring);
            //         if ((y % 2) == 0 || (days == 30 && y == 30)) {
            //             chart.labels.push(startDate.getDate().toString());
            //         } else {
            //             chart.labels.push("");
            //         }
            //     }
            //     user.chart = chart;

            // }
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Impersonate(model: openflow.TokenUser): Promise<any> {
            this.loading = true;
            var result = await this.api.SigninWithToken(this.WebSocketClient.jwt, null, model._id);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteOneUser(model: openflow.TokenUser): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            var name = model.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            var list = await this.api.Query("users", { _type: "role", name: name + "noderedadmins" });
            if (list.length == 1) {
                console.log("Deleting " + name + "noderedadmins")
                await this.api.Delete("users", list[0]);
            }

            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class UserCtrl extends entityCtrl<openflow.TokenUser> {
        public newid: string;
        public memberof: openflow.Role[];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("UserCtrl");
            this.collection = "users";
            this.postloadData = this.processdata;
            this.memberof = [];
            WebSocketClient.onSignedin((user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    this.loadData();
                } else {
                    this.model = new openflow.TokenUser("", "");
                    this.model._type = "user";
                    this.model.name = "";
                    this.model.username = "";
                    this.model.newpassword = "";
                    this.model.sid = "";
                    this.model.federationids = [];
                    this.processdata();
                }

            });
        }
        async processdata() {
            if (this.model != null && (this.model._id != null && this.model._id != "")) {
                this.memberof = await this.api.Query("users",
                    {
                        $and: [
                            { _type: "role" },
                            { members: { $elemMatch: { _id: this.model._id } } }
                        ]
                    }, null, { _type: -1, name: 1 }, 5);
            } else {
                this.memberof = [];
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        deleteid(id) {
            if (this.model.federationids === null || this.model.federationids === undefined) {
                this.model.federationids = [];
            }
            this.model.federationids = this.model.federationids.filter(function (m: any): boolean { return m !== id; });
        }
        addid() {
            if (this.model.federationids === null || this.model.federationids === undefined) {
                this.model.federationids = [];
            }
            this.model.federationids.push(this.newid);
        }
        RemoveMember(model: openflow.Role) {
            this.memberof = this.memberof.filter(x => x._id != model._id);
        }
        async submit(): Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Users");

            var currentmemberof = await this.api.Query("users",
                {
                    $and: [
                        { _type: "role" },
                        { members: { $elemMatch: { _id: this.model._id } } }
                    ]
                }, null, { _type: -1, name: 1 }, 5);
            for (var i = 0; i < currentmemberof.length; i++) {
                var memberof = currentmemberof[i];
                if (this.memberof == null || this.memberof == undefined) this.memberof = [];
                var exists = this.memberof.filter(x => x._id == memberof._id);
                if (exists.length == 0) {
                    console.log("Updating members of " + memberof.name + " " + memberof._id);
                    console.log("members: " + memberof.members.length);
                    memberof.members = memberof.members.filter(x => x._id != this.model._id);
                    console.log("members: " + memberof.members.length);
                    await this.api.Update("users", memberof);
                }
            }

            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }





    export class RolesCtrl extends entitiesCtrl<openflow.Role> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.autorefresh = true;
            console.debug("RolesCtrl");
            this.basequery = { _type: "role" };
            this.collection = "users";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class RoleCtrl extends entityCtrl<openflow.Role> {
        searchFilteredList: openflow.Role[] = [];
        searchSelectedItem: openflow.Role = null;
        searchtext: string = "";
        e: any = null;

        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("RoleCtrl");
            this.collection = "users";
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    await this.loadData();
                } else {
                    this.model = new openflow.Role("");
                }
            });
        }
        async submit(): Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Roles");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        RemoveMember(model: any) {
            if (this.model.members === undefined) { this.model.members = []; }
            for (var i: number = 0; i < this.model.members.length; i++) {
                if (this.model.members[i]._id === model._id) {
                    this.model.members.splice(i, 1);
                }
            }
        }
        AddMember(model: any) {
            if (this.model.members === undefined) { this.model.members = []; }
            var user: any = null;
            user = this.searchSelectedItem;
            this.model.members.push({ name: user.name, _id: user._id });
            this.searchSelectedItem = null;
            this.searchtext = "";
        }


        restrictInput(e) {
            if (e.keyCode == 13) {
                e.preventDefault();
                return false;
            }
        }
        setkey(e) {
            this.e = e;
            this.handlekeys();
        }
        handlekeys() {
            if (this.searchFilteredList.length > 0) {
                var idx: number = -1;
                for (var i = 0; i < this.searchFilteredList.length; i++) {
                    if (this.searchSelectedItem != null) {
                        if (this.searchFilteredList[i]._id == this.searchSelectedItem._id) {
                            idx = i;
                        }
                    }
                }
                if (this.e.keyCode == 38) { // up
                    if (idx <= 0) {
                        idx = 0;
                    } else { idx--; }
                    // this.searchtext = this.searchFilteredList[idx].name;
                    this.searchSelectedItem = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 40) { // down
                    if (idx >= this.searchFilteredList.length) {
                        idx = this.searchFilteredList.length - 1;
                    } else { idx++; }
                    // this.searchtext = this.searchFilteredList[idx].name;
                    this.searchSelectedItem = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 13) { // enter
                    if (idx >= 0) {
                        this.searchtext = this.searchFilteredList[idx].name;
                        this.searchSelectedItem = this.searchFilteredList[idx];
                        this.searchFilteredList = [];
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    }
                    return;
                }
            } else {
                if (this.e.keyCode == 13 && this.searchSelectedItem != null) {
                    this.AddMember(this.searchSelectedItem);
                }
            }
        }
        async handlefilter(e) {
            this.e = e;
            var ids: string[] = this.model.members.map(item => item._id);
            this.searchFilteredList = await this.api.Query("users",
                {
                    $and: [
                        { $or: [{ _type: "user" }, { _type: "role" }] },
                        { name: new RegExp([this.searchtext].join(""), "i") },
                        { _id: { $nin: ids } }
                    ]
                }
                , null, { _type: -1, name: 1 }, 5);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        fillTextbox(searchtext) {
            this.searchFilteredList.forEach((item: any) => {
                if (item.name.toLowerCase() == searchtext.toLowerCase()) {
                    this.searchtext = item.name;
                    this.searchSelectedItem = item;
                    this.searchFilteredList = [];
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                }
            });
        }
    }



    export class SocketCtrl {
        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient",
            "api"
        ];
        public messages: string = "";
        public queuename: string = "webtest";
        public message: string = "Hi mom";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            console.debug("SocketCtrl");
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                await api.RegisterQueue();
            });
        }

        async EnsureNoderedInstance() {
            try {
                await this.api.EnsureNoderedInstance();
                this.messages += "EnsureNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteNoderedInstance() {
            try {
                await this.api.DeleteNoderedInstance();
                this.messages += "DeleteNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async RestartNoderedInstance() {
            try {
                await this.api.RestartNoderedInstance();
                this.messages += "RestartNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async StartNoderedInstance() {
            try {
                await this.api.StartNoderedInstance();
                this.messages += "StartNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async StopNoderedInstance() {
            try {
                await this.api.StopNoderedInstance();
                this.messages += "StopNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }

        async submit() {
            await this.SendOne(this.queuename, this.message);
        }
        async SendOne(queuename: string, message: any): Promise<void> {
            var result: any = await this.api.QueueMessage(queuename, message);
            try {
                // result = JSON.parse(result);
            } catch (error) {
            }
            this.messages += result + "\n";
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }



    export class FilesCtrl extends entitiesCtrl<openflow.Base> {
        public file: string;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("EntitiesCtrl");
            this.autorefresh = true;
            this.basequery = {};
            this.searchfields = ["metadata.name", "metadata.path"];
            this.collection = "files";
            this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
            var elem = document.getElementById("myBar");
            elem.style.width = '0%';
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Download(id: string) {
            var lastp: number = 0;
            var fileinfo = await this.api.GetFile(null, id, (msg, index, count) => {
                var p: number = ((index + 1) / count * 100) | 0;
                if (p > lastp || (index + 1) == count) {
                    console.log(index + "/" + count + " " + p + "%");
                    lastp = p;
                }
                var elem = document.getElementById("myBar");
                elem.style.width = p + '%';
                elem.innerText = p + '%';
                if (p == 100) {
                    elem.innerText = 'Processing ...';
                }
            });
            var elem = document.getElementById("myBar");
            elem.style.width = '0%';
            elem.innerText = '';
            const blob = this.b64toBlob(fileinfo.file, fileinfo.mimeType);
            // const blobUrl = URL.createObjectURL(blob);
            // (window.location as any) = blobUrl;
            var anchor = document.createElement('a');
            anchor.download = fileinfo.metadata.name;
            anchor.href = ((window as any).webkitURL || window.URL).createObjectURL(blob);
            anchor.dataset.downloadurl = [fileinfo.mimeType, anchor.download, anchor.href].join(':');
            anchor.click();
        }
        b64toBlob(b64Data: string, contentType: string, sliceSize: number = 512) {
            contentType = contentType || '';
            sliceSize = sliceSize || 512;
            var byteCharacters = atob(b64Data);
            var byteArrays = [];
            for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
                var slice = byteCharacters.slice(offset, offset + sliceSize);
                var byteNumbers = new Array(slice.length);
                for (var i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                var byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            var blob = new Blob(byteArrays, { type: contentType });
            return blob;
        }
        async Upload() {
            // const e: any = document.querySelector('input[type="file"]');
            var e: any = document.getElementById('fileupload')
            const fd = new FormData();
            for (var i = 0; i < e.files.length; i++) {
                var file = e.files[i];
                fd.append(e.name, file, file.name);
            };
            const xhr = new XMLHttpRequest();
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    console.log("upload complete");
                    // we done!
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    this.loadData();

                }
            };
            console.log("open");
            xhr.open('POST', '/upload', true);
            console.log("send");
            xhr.send(fd);
        }
        async Upload_usingapi() {
            var filename = (this.$scope as any).filename;
            var type = (this.$scope as any).type;
            console.log("filename: " + filename + " type: " + type);
            this.loading = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            var lastp: number = 0;
            await this.api.SaveFile(filename, type, null, this.file, (msg, index, count) => {
                var p: number = ((index + 1) / count * 100) | 0;
                if (p > lastp || (index + 1) == count) {
                    console.log(index + "/" + count + " " + p + "%");
                    lastp = p;
                }
                var elem = document.getElementById("myBar");
                elem.style.width = p + '%';
                elem.innerText = p + '%';
                if (p == 100) {
                    elem.innerText = 'Processing ...';
                }
            });
            var elem = document.getElementById("myBar");
            elem.style.width = '0%';
            elem.innerText = '';
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            this.loadData();
        }
    }
    export class EntitiesCtrl extends entitiesCtrl<openflow.Base> {
        public collections: any;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("EntitiesCtrl");
            this.autorefresh = true;
            this.basequery = {};
            this.collection = $routeParams.collection;
            this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                this.collections = await api.ListCollections();
                this.loadData();
            });
        }
        SelectCollection() {
            this.$location.path("/Entities/" + this.collection);
            //this.$location.hash("#/Entities/" + this.collection);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            // this.loadData();
        }
        async DropCollection() {
            await this.api.DropCollection(this.collection);
            this.collections = await this.api.ListCollections();
            this.collection = "entities";
            this.loadData();
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteMany(): Promise<void> {
            this.loading = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            var Promises: Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = this.collection; q._id = (model as any)._id;
                var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values: DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids: string[] = [];
            values.forEach((x: DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any): boolean { return ids.indexOf(m._id) === -1; });
            this.loading = false;
            this.loadData();
            // if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }

    export class FormsCtrl extends entitiesCtrl<openflow.Base> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("FormsCtrl");
            this.autorefresh = true;
            this.collection = "forms";
            this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteMany(): Promise<void> {
            this.loading = true;
            var Promises: Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = this.collection; q._id = (model as any)._id;
                var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values: DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids: string[] = [];
            values.forEach((x: DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any): boolean { return ids.indexOf(m._id) === -1; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class EditFormCtrl extends entityCtrl<openflow.Form> {
        public message: string = "";
        public charts: chartset[] = [];
        public formBuilder: any;
        public Formiobuilder: any;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("EditFormCtrl");
            this.collection = "forms";
            this.basequery = {};
            this.id = $routeParams.id;
            this.basequery = { _id: this.id };
            this.postloadData = this.renderform;
            this.
                WebSocketClient.onSignedin(async (user: TokenUser) => {
                    if (this.id !== null && this.id !== undefined && this.id !== "") {
                        this.basequery = { _id: this.id };
                        this.loadData();
                    } else {
                        this.model = new openflow.Form();
                        this.model.fbeditor = false;
                        this.renderform();
                    }

                });
        }
        async Save() {
            if (this.model.fbeditor == true) {
                this.model.formData = this.formBuilder.actions.getData(this.model.dataType);
            } else {
                // allready there
            }
            if (this.model._id) {
                this.model = await this.api.Update(this.collection, this.model);
            } else {
                this.model = await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Forms");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async renderform() {
            if (this.model.fbeditor == null || this.model.fbeditor == undefined) this.model.fbeditor = true;
            if ((this.model.fbeditor as any) == "true") this.model.fbeditor = true;
            if ((this.model.fbeditor as any) == "false") this.model.fbeditor = false;
            if (this.model.fbeditor == true) {
                // https://www.npmjs.com/package/angular2-json-schema-form
                // http://www.alpacajs.org/demos/form-builder/form-builder.html
                // https://github.com/kevinchappell/formBuilder - https://formbuilder.online/ - https://kevinchappell.github.io/formBuilder/
                var ele: any;
                var roles: any = {};
                this.WebSocketClient.user.roles.forEach(role => {
                    roles[role._id] = role.name;
                });

                var fbOptions = {
                    formData: this.model.formData,
                    dataType: this.model.dataType,
                    roles: roles,
                    disabledActionButtons: ['data', 'clear'],
                    onSave: this.Save.bind(this),
                };
                ele = $(document.getElementById('fb-editor'));
                if (this.formBuilder == null || this.formBuilder == undefined) {
                    this.formBuilder = await ele.formBuilder(fbOptions).promise;
                }
            } else {
                if (this.model.formData == null || this.model.formData == undefined) { this.model.formData = {}; }
                // "https://examples.form.io/wizard"
                if (this.model.wizard == true) {
                    this.model.formData.display = "wizard";
                } else {
                    this.model.formData.display = "form";
                }
                this.Formiobuilder = await Formio.builder(document.getElementById('builder'), this.model.formData,
                    {
                        noAlerts: false,
                        breadcrumbSettings: { clickable: false },
                        buttonSettings: { showCancel: false },
                        builder: {
                            data: false,
                            premium: false
                        }
                    });
                this.Formiobuilder.on('change', form => {
                    this.model.schema = form;
                })
                this.Formiobuilder.on('submit', submission => {
                })
                this.Formiobuilder.on('error', (errors) => {
                    console.error(errors);
                })
            }
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class FormCtrl extends entityCtrl<openflow.WorkflowInstance> {
        public message: string = "";
        public formRender: any;
        public formioRender: any;
        public workflow: openflow.Workflow;
        public form: openflow.Form;
        public instanceid: string;
        public myid: string;
        public submitbutton: string;

        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.myid = new Date().toISOString();
            console.debug("FormCtrl");
            this.collection = "workflow";
            this.basequery = {};
            this.id = $routeParams.id;
            this.instanceid = $routeParams.instance;

            this.basequery = { _id: this.id };
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                await api.RegisterQueue();
                if (this.id !== null && this.id !== undefined && this.id !== "") {
                    this.basequery = { _id: this.id };
                    this.loadData();
                } else {
                    console.error("missing id");
                }
            });
        }
        async loadData(): Promise<void> {
            this.loading = true;
            var res = await this.api.Query(this.collection, this.basequery, null, { _created: -1 }, 1);
            if (res.length > 0) { this.workflow = res[0]; } else { console.error(this.id + " workflow not found!"); return; }
            if (this.instanceid !== null && this.instanceid !== undefined && this.instanceid !== "") {
                var res = await this.api.Query("workflow_instances", { _id: this.instanceid }, null, { _created: -1 }, 1);
                if (res.length > 0) { this.model = res[0]; } else { console.error(this.id + " workflow instances not found!"); return; }
                if (this.model.form !== "") {
                    var res = await this.api.Query("forms", { _id: this.model.form }, null, { _created: -1 }, 1);
                    if (res.length > 0) { this.form = res[0]; } else {
                        if (this.model.state == "completed") {
                            this.$location.path("/main");
                            if (!this.$scope.$$phase) { this.$scope.$apply(); }
                            return;
                        } else {
                            console.error(this.id + " form not found! " + this.model.state); return;
                        }
                    }
                } else {
                    console.debug("Model contains no form");
                }
                this.renderform();
            } else {
                console.debug("No instance id found, send empty message");
                console.debug("SendOne: " + this.workflow._id + " / " + this.workflow.queue);
                await this.SendOne(this.workflow.queue, {});
                this.loadData();
            }
        }
        async SendOne(queuename: string, message: any): Promise<void> {
            // console.debug("SendOne: queuename " + queuename + " / " + this.myid);
            var result: any = await this.api.QueueMessage(queuename, message);
            try {
                result = JSON.parse(result);
            } catch (error) {
            }
            // console.debug(result);
            if ((this.instanceid === undefined || this.instanceid === null) && (result !== null && result !== unescape)) {
                this.instanceid = result._id;
                this.$location.path("/Form/" + this.id + "/" + this.instanceid);
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
        }
        async Save() {
            if (this.form.fbeditor === true) {
                var userData: any[] = this.formRender.userData;
                if (this.model.payload === null || this.model.payload === undefined) { this.model.payload = {}; }
                for (var i = 0; i < userData.length; i++) {
                    this.model.payload[userData[i].name] = "";
                    var val = userData[i].userData;
                    if (val !== undefined && val !== null) {
                        if (userData[i].type == "checkbox-group") {
                            this.model.payload[userData[i].name] = val;
                        } else if (Array.isArray(val)) {
                            this.model.payload[userData[i].name] = val[0];
                        } else {
                            this.model.payload[userData[i].name] = val;
                        }
                    }
                }
                this.model.payload.submitbutton = this.submitbutton;
                var ele = $('.render-wrap');
                ele.hide();
            } else {

            }
            // console.debug("SendOne: " + this.workflow._id + " / " + this.workflow.queue);
            await this.SendOne(this.workflow.queue, this.model);
            this.loadData();
        }
        traversecomponentsPostProcess(components: any[], data: any) {
            for (var i = 0; i < components.length; i++) {
                var item = components[i];
                if (item.type == "button" && item.action == "submit") {
                    if (data[item.key] == true) {
                        this.submitbutton = item.key;
                        this.model.payload.submitbutton = item.key;
                    }
                }
            }

            for (var i = 0; i < components.length; i++) {
                var item = components[i];
                if (item.type == "table") {
                    for (var x = 0; x < item.rows.length; x++) {
                        for (var y = 0; y < item.rows[x].length; y++) {
                            var subcomponents = item.rows[x][y].components;
                            this.traversecomponentsPostProcess(subcomponents, data);
                        }

                    }
                }
            }

        }
        traversecomponentsMakeDefaults(components: any[]) {
            for (var y = 0; y < components.length; y++) {
                var item = components[y];
                if (item.type == "datagrid") {
                    if (this.model.payload[item.key] === null || this.model.payload[item.key] === undefined) {
                        var obj: any = {};
                        for (var x = 0; x < item.components.length; x++) {
                            obj[item.components[x].key] = "";
                        }
                        console.log("add default array for " + item.key, obj);
                        this.model.payload[item.key] = [obj];
                    } else {
                        console.log("payload already have values for " + item.key);
                        console.log("isArray: " + Array.isArray(this.model.payload[item.key]))
                        if (Array.isArray(this.model.payload[item.key])) {
                            // console.log("convert payload for " + item.key + " from array to object");
                            // var obj2: any = {};
                            // for (var x = 0; x < values.length; x++) {
                            //     obj2[x] = values[x];
                            // }
                            // this.model.payload[item.key] = obj2;
                        } else {
                            console.log("convert payload for " + item.key + " from object to array");
                            var keys = Object.keys(this.model.payload[item.key]);
                            var arr: any[] = [];
                            for (var x = 0; x < keys.length; x++) {
                                arr.push(this.model.payload[item.key][keys[x]]);
                            }
                            this.model.payload[item.key] = arr;
                        }
                    }
                }
                if (item.type == "button" && item.action == "submit") {
                    this.model.payload[item.key] = false;
                }
            }
            if (this.model.payload != null && this.model.payload != undefined) {
                if (this.model.payload.values != null && this.model.payload.values != undefined) {
                    var keys = Object.keys(this.model.payload.values);
                }
            }
            if (this.model.payload != null && this.model.payload != undefined) {
                if (this.model.payload.values != null && this.model.payload.values != undefined) {
                    var keys = Object.keys(this.model.payload.values);
                    for (var i = 0; i < keys.length; i++) {
                        var values = this.model.payload.values[keys[i]];
                        for (var y = 0; y < components.length; y++) {
                            var item = components[y];
                            // console.log(item);
                            if (item.key == keys[i]) {
                                if (Array.isArray(values)) {
                                    console.log("handle " + item.key + " as array");
                                    var obj2: any = {};
                                    for (var x = 0; x < values.length; x++) {
                                        obj2[x] = values[x];
                                    }
                                    if (item.data != null && item.data != undefined) {
                                        item.data.values = obj2;
                                        item.data.json = JSON.stringify(values);
                                        // console.log("Setting values for " + keys[i], JSON.stringify(obj));
                                    } else {
                                        item.values = values;
                                    }
                                } else {
                                    console.log("handle " + item.key + " as an object");
                                    if (item.data != null && item.data != undefined) {
                                        item.data.values = values;
                                        item.data.json = JSON.stringify(values);
                                        // console.log("Setting values for " + keys[i], JSON.stringify(values));
                                    } else {
                                        item.values = values;
                                    }
                                }
                                // if (item.data != null && item.data != undefined) {
                                //     console.log(keys[i], item.data);
                                // } else {
                                //     console.log(keys[i], item);
                                // }
                            }
                        }

                    }
                }
            }

            for (var i = 0; i < components.length; i++) {
                var item = components[i];
                if (item.type == "table") {
                    for (var x = 0; x < item.rows.length; x++) {
                        for (var y = 0; y < item.rows[x].length; y++) {
                            var subcomponents = item.rows[x][y].components;
                            this.traversecomponentsMakeDefaults(subcomponents);
                        }

                    }
                }
            }

            // rows
        }
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        async beforeSubmit(submission, next) {
            // console.log('beforeSubmit', submission);
            //next('go away!');
            next();
        }
        async renderform() {
            if (this.form.fbeditor == null || this.form.fbeditor == undefined) this.form.fbeditor = true;
            if ((this.form.fbeditor as any) == "true") this.form.fbeditor = true;
            if ((this.form.fbeditor as any) == "false") this.form.fbeditor = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            if (this.form.fbeditor === true) {
                console.debug("renderform");
                var ele: any;
                var roles: any = {};
                this.WebSocketClient.user.roles.forEach(role => {
                    roles[role._id] = role.name;
                });
                if (typeof this.form.formData === 'string' || this.form.formData instanceof String) {
                    this.form.formData = JSON.parse((this.form.formData as any));
                }
                for (var i = 0; i < this.form.formData.length; i++) {
                    var value = this.model.payload[this.form.formData[i].name];
                    if (value == undefined || value == null) { value = ""; }
                    if (value != "" || this.form.formData[i].type != "button") {
                        // console.log("0:" + this.form.formData[i].label + " -> " + value);
                        this.form.formData[i].userData = [value];
                    }
                    if (Array.isArray(value)) {
                        // console.log("1:" + this.form.formData[i].userData + " -> " + value);
                        this.form.formData[i].userData = value;
                    }
                    if (this.model.payload[this.form.formData[i].label] !== null && this.model.payload[this.form.formData[i].label] !== undefined) {
                        value = this.model.payload[this.form.formData[i].label];
                        if (value == undefined || value == null) { value = ""; }
                        if (this.form.formData[i].type != "button") {
                            // console.log("2:" + this.form.formData[i].label + " -> " + value);
                            this.form.formData[i].label = value;
                        } else if (value != "") {
                            // console.log("2button:" + this.form.formData[i].label + " -> " + value);
                            this.form.formData[i].label = value;
                        } else {
                            // console.log("skip " + this.form.formData[i].label);
                        }
                    }
                    if (this.model.values !== null && this.model.values !== undefined) {
                        if (this.model.values[this.form.formData[i].name] !== null && this.model.values[this.form.formData[i].name] !== undefined) {
                            value = this.model.values[this.form.formData[i].name];
                            if (value == undefined || value == null) { value = []; }
                            // console.log("3:" + this.form.formData[i].values + " -> " + value);
                            this.form.formData[i].values = value;
                        }
                    }
                }
                var formRenderOpts = {
                    formData: this.form.formData,
                    dataType: this.form.dataType,
                    roles: roles,
                    disabledActionButtons: ['data', 'clear'],
                    onSave: this.Save.bind(this),
                };
                if (this.model.userData !== null && this.model.userData !== undefined && this.model.userData !== "") {
                    formRenderOpts.formData = this.model.userData;
                }
                var concatHashToString = function (hash) {
                    var emptyStr = '';
                    $.each(hash, function (index) {
                        emptyStr += ' ' + hash[index].name + '="' + hash[index].value + '"';
                    });
                    return emptyStr;
                }
                var replaceElem = function (targetId, replaceWith) {
                    $(targetId).each(function () {
                        var attributes = concatHashToString(this.attributes);
                        var replacingStartTag = '<' + replaceWith + attributes + '>';
                        var replacingEndTag = '</' + replaceWith + '>';
                        $(this).replaceWith(replacingStartTag + $(this).html() + replacingEndTag);
                    });
                }
                var replaceElementTag = function (targetSelector, newTagString) {
                    $(targetSelector).each(function () {
                        var newElem = $(newTagString, { html: $(this).html() });
                        $.each(this.attributes, function () {
                            newElem.attr(this.name, this.value);
                        });
                        $(this).replaceWith(newElem);
                    });
                }

                // 
                // replaceElem('div', 'span');
                setTimeout(() => {
                    // $('button[type="button"]').contents().unwrap().wrap('<input/>');
                    // replaceElem('button', 'input');
                    // replaceElementTag('button[type="button"]', '<input></input>');

                    console.log("Attach buttons! 2");
                    // $('button[type="button"]').bind("click", function () {

                    $('button[type="button"]').each(function () {
                        var cur: any = $(this)[0];
                        console.log("set submit");
                        console.log(cur);
                        cur.type = "submit";
                    });
                    // $('input[type="button"]').click(function (evt) {
                    //     // var input = $("<input>").attr("type", "hidden").attr("name", evt.target.id).val((evt.target as any).value);
                    //     // $('#workflowform').append(input);
                    //     // $('button[type="button"]').replaceWith('<input>' + $('target').html() +'</newTag>')
                    //     // evt.preventDefault();
                    //     console.log(evt);
                    //     console.log("button clicked!");
                    //     $('#workflowform').submit();
                    // });
                    // $('button[type="button"]').click(function (evt) {
                    //     var input = $("<input>").attr("type", "hidden").attr("name", "clicked").val(evt.target.id);
                    //     $('#workflowform').append(input);
                    //     $('#workflowform').submit();
                    // });

                    var click = function (evt) {
                        this.submitbutton = evt.target.id;
                        // console.log(this);
                        // var input = $("<input>").attr("type", "hidden").attr("name", "clicked").val(evt.target.id);
                        // $('#workflowform').append(input);
                        // evt.preventDefault();
                        // $('#workflowform').submit();
                    }
                    $('button[type="submit"]').click(click.bind(this));

                }, 500);
                ele = $('.render-wrap');
                ele.show();
                this.formRender = ele.formRender(formRenderOpts);
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            } else {

                this.traversecomponentsMakeDefaults(this.form.schema.components);

                if (this.form.wizard == true) {
                    this.form.schema.display = "wizard";
                } else {
                    this.form.schema.display = "form";
                }

                this.formioRender = await Formio.createForm(document.getElementById('formio'), this.form.schema,
                    {
                        breadcrumbSettings: { clickable: true },
                        buttonSettings: { showCancel: false },
                        hooks: {
                            beforeSubmit: this.beforeSubmit.bind(this)
                        }
                    });
                // wizard
                this.formioRender.on('change', form => {
                    //console.log('change', form);
                    // setTimeout(() => {
                    //     this.formioRender.submit();
                    // }, 200);

                    // this.model.schema = form;
                    // if (!this.$scope.$$phase) { this.$scope.$apply(); }
                })
                // https://formio.github.io/formio.js/app/examples/datagrid.html

                if (this.model.payload != null && this.model.payload != undefined) {
                    this.formioRender.submission = { data: this.model.payload };
                }
                this.formioRender.on('submit', async submission => {
                    console.log('onsubmit', submission);
                    $(".alert-success").hide();
                    setTimeout(() => {
                        // just to be safe
                        $(".alert-success").hide();
                    }, 200);
                    this.model.submission = submission;
                    this.model.userData = submission;
                    this.model.payload = submission.data;
                    this.traversecomponentsPostProcess(this.form.schema.components, submission.data);
                    this.Save();
                })
                this.formioRender.on('error', (errors) => {
                    console.error(errors);
                });
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
        }
    }
    export class jslogCtrl extends entitiesCtrl<openflow.Base> {
        public message: string = "";
        public charts: chartset[] = [];
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.autorefresh = true;
            console.debug("jslogCtrl");
            this.searchfields = ["_createdby", "host", "message"];
            this.collection = "jslog";
            this.basequery = {};
            this.orderby = { _created: -1 };
            this.baseprojection = { _type: 1, type: 1, host: 1, message: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteMany(): Promise<void> {
            this.loading = true;
            var Promises: Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = this.collection; q._id = (model as any)._id;
                var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values: DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids: string[] = [];
            values.forEach((x: DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any): boolean { return ids.indexOf(m._id) === -1; });
            this.loading = false;

            this.models = await this.api.Query(this.collection, this.basequery, this.baseprojection, this.orderby);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            if (this.models.length > 0) {
                await this.DeleteMany();
            }
        }

    }


    export class EntityCtrl extends entityCtrl<openflow.Base> {
        searchFilteredList: openflow.TokenUser[] = [];
        searchSelectedItem: openflow.TokenUser = null;
        searchtext: string = "";
        e: any = null;

        public newkey: string = "";
        public showjson: boolean = false;
        public jsonmodel: string = "";
        public message: string = "";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            console.debug("EntityCtrl");
            this.collection = $routeParams.collection;
            this.postloadData = this.processdata;
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                // this.usergroups = await this.api.Query("users", {});
                if (this.id !== null && this.id !== undefined) {
                    await this.loadData();
                } else {
                    this.model = new openflow.Base();
                    this.model._type = "test";
                    this.model.name = "new item";
                    this.model._encrypt = [];
                    this.model._acl = [];
                    this.keys = Object.keys(this.model);
                    for (var i: number = this.keys.length - 1; i >= 0; i--) {
                        if (this.keys[i].startsWith('_')) this.keys.splice(i, 1);
                    }
                    this.processdata();
                    //if (!this.$scope.$$phase) { this.$scope.$apply(); }
                }
            });
        }
        processdata() {
            var ids: string[] = [];
            if (this.collection == "files") {
                console.log(this.model);
                for (var i: number = 0; i < (this.model as any).metadata._acl.length; i++) {
                    ids.push((this.model as any).metadata._acl[i]._id);
                }
            } else {
                for (var i: number = 0; i < this.model._acl.length; i++) {
                    ids.push(this.model._acl[i]._id);
                }
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            this.fixtextarea();
        }
        fixtextarea() {
            setTimeout(() => {
                var tx = document.getElementsByTagName('textarea');
                for (var i = 0; i < tx.length; i++) {
                    tx[i].setAttribute('style', 'height:' + (tx[i].scrollHeight) + 'px;overflow-y:hidden;');
                    tx[i].addEventListener("input", OnInput, false);
                }

                function OnInput() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                }

            }, 500);
        }
        togglejson() {
            this.showjson = !this.showjson;
            if (this.showjson) {
                this.jsonmodel = JSON.stringify(this.model, null, 2);
            } else {
                this.model = JSON.parse(this.jsonmodel);
                this.keys = Object.keys(this.model);
                for (var i: number = this.keys.length - 1; i >= 0; i--) {
                    if (this.keys[i].startsWith('_')) this.keys.splice(i, 1);
                }
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            this.fixtextarea();
        }
        async submit(): Promise<void> {
            if (this.showjson) {
                try {
                    this.model = JSON.parse(this.jsonmodel);
                } catch (error) {
                    this.message = error;
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    return;
                }
            }
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            if (this.collection == "files") {
                this.$location.path("/Files");
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
            this.$location.path("/Entities/" + this.collection);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        removekey(key) {
            if (this.keys.indexOf(key) > -1) {
                this.keys.splice(this.keys.indexOf(key), 1);
            }
            delete this.model[key];
        }
        addkey() {
            if (this.newkey === '') { return; }
            if (this.keys.indexOf(this.newkey) > -1) {
                this.keys.splice(this.keys.indexOf(this.newkey), 1);
            }
            this.keys.push(this.newkey);
            this.model[this.newkey] = '';
            this.newkey = '';
        }
        removeuser(_id) {
            if (this.collection == "files") {
                for (var i = 0; i < (this.model as any).metadata._acl.length; i++) {
                    if ((this.model as any).metadata._acl[i]._id == _id) {
                        (this.model as any).metadata._acl.splice(i, 1);
                    }
                }
            } else {
                for (var i = 0; i < this.model._acl.length; i++) {
                    if (this.model._acl[i]._id == _id) {
                        this.model._acl.splice(i, 1);
                        //this.model._acl = this.model._acl.splice(index, 1);
                    }
                }
            }

        }
        adduser() {
            var ace = new Ace();
            ace.deny = false;
            ace._id = this.searchSelectedItem._id;
            ace.name = this.searchSelectedItem.name;
            ace.rights = "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";

            if (this.collection == "files") {
                (this.model as any).metadata._acl.push(ace);
            } else {
                this.model._acl.push(ace);
            }
            this.searchSelectedItem = null;
            this.searchtext = "";
        }

        isBitSet(base64: string, bit: number): boolean {
            bit--;
            var buf = this._base64ToArrayBuffer(base64);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            return (currentValue & mask) != 0;
        }
        setBit(base64: string, bit: number) {
            bit--;
            var buf = this._base64ToArrayBuffer(base64);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            var newValue = currentValue | mask;
            view[octet] = newValue;
            return this._arrayBufferToBase64(view);
        }
        unsetBit(base64: string, bit: number) {
            bit--;
            var buf = this._base64ToArrayBuffer(base64);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            var newValue = currentValue &= ~mask;
            view[octet] = newValue;
            return this._arrayBufferToBase64(view);
        }
        toogleBit(a: any, bit: number) {
            if (this.isBitSet(a.rights, bit)) {
                a.rights = this.unsetBit(a.rights, bit);
            } else {
                a.rights = this.setBit(a.rights, bit);
            }
            var buf2 = this._base64ToArrayBuffer(a.rights);
            var view2 = new Uint8Array(buf2);
        }
        _base64ToArrayBuffer(string_base64): ArrayBuffer {
            var binary_string = window.atob(string_base64);
            var len = binary_string.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                //var ascii = string_base64.charCodeAt(i);
                var ascii = binary_string.charCodeAt(i);
                bytes[i] = ascii;
            }
            return bytes.buffer;
        }
        _arrayBufferToBase64(array_buffer): string {
            var binary = '';
            var bytes = new Uint8Array(array_buffer);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i])
            }
            return window.btoa(binary);
        }




        restrictInput(e) {
            if (e.keyCode == 13) {
                e.preventDefault();
                return false;
            }
        }
        setkey(e) {
            this.e = e;
            this.handlekeys();
        }
        handlekeys() {
            if (this.searchFilteredList.length > 0) {
                var idx: number = -1;
                for (var i = 0; i < this.searchFilteredList.length; i++) {
                    if (this.searchSelectedItem != null) {
                        if (this.searchFilteredList[i]._id == this.searchSelectedItem._id) {
                            idx = i;
                        }
                    }
                }
                if (this.e.keyCode == 38) { // up
                    if (idx <= 0) {
                        idx = 0;
                    } else { idx--; }
                    console.log("idx: " + idx);
                    // this.searchtext = this.searchFilteredList[idx].name;
                    this.searchSelectedItem = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 40) { // down
                    if (idx >= this.searchFilteredList.length) {
                        idx = this.searchFilteredList.length - 1;
                    } else { idx++; }
                    console.log("idx: " + idx);
                    // this.searchtext = this.searchFilteredList[idx].name;
                    this.searchSelectedItem = this.searchFilteredList[idx];
                    return;
                }
                else if (this.e.keyCode == 13) { // enter
                    if (idx >= 0) {
                        this.searchtext = this.searchFilteredList[idx].name;
                        this.searchSelectedItem = this.searchFilteredList[idx];
                        this.searchFilteredList = [];
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    }
                    return;
                }
                else {
                    // console.log(this.e.keyCode);
                }
            } else {
                if (this.e.keyCode == 13 && this.searchSelectedItem != null) {
                    this.adduser();
                }
            }
        }
        async handlefilter(e) {
            this.e = e;
            // console.log(e.keyCode);
            var ids: string[] = this.model._acl.map(item => item._id);
            this.searchFilteredList = await this.api.Query("users",
                {
                    $and: [
                        { $or: [{ _type: "user" }, { _type: "role" }] },
                        { name: new RegExp([this.searchtext].join(""), "i") },
                        { _id: { $nin: ids } }
                    ]
                }
                , null, { _type: -1, name: 1 }, 5);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        fillTextbox(searchtext) {
            this.searchFilteredList.forEach((item: any) => {
                if (item.name.toLowerCase() == searchtext.toLowerCase()) {
                    this.searchtext = item.name;
                    this.searchSelectedItem = item;
                    this.searchFilteredList = [];
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                }
            });
        }

    }

    export class HistoryCtrl extends entitiesCtrl<openflow.Base> {
        public id: string = "";
        public model: openflow.Base;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.autorefresh = true;
            console.debug("HistoryCtrl");
            this.id = $routeParams.id;
            this.basequery = { _id: this.id };
            this.collection = $routeParams.collection;
            this.baseprojection = null;
            this.postloadData = this.ProcessData;
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async ProcessData() {
            // this.models = await this.api.Query(this.collection, { _id: this.id }, null, null);
            this.model = this.models[0];
            var keys = Object.keys(this.model);
            keys.forEach(key => {
                if (key.startsWith("_")) {
                    delete this.model[key];
                }
            });
            this.models = await this.api.Query(this.collection + "_hist", { id: this.id }, null, this.orderby);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        CompareNow(model) {
            var modal: any = $("#exampleModal");
            modal.modal()
            // var delta = jsondiffpatch.diff(this.model, model.item);
            var keys = Object.keys(model.item);
            keys.forEach(key => {
                if (key.startsWith("_")) {
                    delete model.item[key];
                }
            });

            var delta = jsondiffpatch.diff(model.item, this.model);
            document.getElementById('visual').innerHTML = jsondiffpatch.formatters.html.format(delta, this.model);
        }
        CompareThen(model) {
            var modal: any = $("#exampleModal");
            modal.modal()
            document.getElementById('visual').innerHTML = jsondiffpatch.formatters.html.format(model.delta, model.item);
        }
    }

    export class NoderedCtrl {
        public static $inject = [
            "$scope",
            "$location",
            "$routeParams",
            "WebSocketClient",
            "api"
        ];
        public messages: string = "";
        public queuename: string = "webtest";
        public message: string = "Hi mom";
        public noderedurl: string = "";
        public instance: any = null;
        public instancestatus: string = "";
        public instancelog: string = "";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            console.debug("NoderedCtrl");
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                await api.RegisterQueue();
                var name = WebSocketClient.user.username;
                name = name.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                this.noderedurl = "https://" + WebSocketClient.nodered_domain_schema.replace("$nodered_id$", name);
                // // this.GetNoderedInstance();
                this.GetNoderedInstance();
            });
        }
        async GetNoderedInstance() {
            try {
                this.instancestatus = "fetching status";

                this.instance = await this.api.GetNoderedInstance();
                console.debug("GetNoderedInstance:");
                if (this.instance !== null && this.instance !== undefined) {
                    if (this.instance.metadata.deletionTimestamp !== undefined) {
                        this.instancestatus = "pending deletion (" + this.instance.status.phase + ")";
                    } else {
                        this.instancestatus = this.instance.status.phase;
                    }
                } else {
                    this.instancestatus = "non existent";
                    // this.messages += "GetNoderedInstance completed, status unknown/non existent" + "\n";
                }
                this.messages += "GetNoderedInstance completed, status " + this.instancestatus + "\n";
            } catch (error) {
                this.messages += error + "\n";
                this.instancestatus = "";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async GetNoderedInstanceLog() {
            try {
                this.instancestatus = "fetching log";
                console.debug("GetNoderedInstanceLog:");
                this.instancelog = await this.api.GetNoderedInstanceLog();
                this.instancelog = this.instancelog.split("\n").reverse().join("\n");
                this.messages += "GetNoderedInstanceLog completed\n";
                this.instancestatus = "";
            } catch (error) {
                this.messages += error + "\n";
                this.instancestatus = "";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async EnsureNoderedInstance() {
            try {
                await this.api.EnsureNoderedInstance();
                this.messages += "EnsureNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteNoderedInstance() {
            try {
                await this.api.DeleteNoderedInstance();
                this.messages += "DeleteNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async RestartNoderedInstance() {
            try {
                await this.api.RestartNoderedInstance();
                this.messages += "RestartNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async StartNoderedInstance() {
            try {
                await this.api.StartNoderedInstance();
                this.messages += "StartNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async StopNoderedInstance() {
            try {
                await this.api.StopNoderedInstance();
                this.messages += "StopNoderedInstance completed" + "\n";
            } catch (error) {
                this.messages += error + "\n";
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }

        async submit() {
            await this.SendOne(this.queuename, this.message);
        }
        async SendOne(queuename: string, message: any): Promise<void> {
            var result: any = await this.api.QueueMessage(queuename, message);
            try {
                // result = JSON.parse(result);
            } catch (error) {
            }
            this.messages += result + "\n";
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }




    export class hdrobotsCtrl extends entitiesCtrl<openflow.unattendedclient> {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public $interval: ng.IIntervalService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, $interval, WebSocketClient, api);
            this.autorefresh = true;
            console.debug("RolesCtrl");
            this.basequery = { _type: "unattendedclient" };
            this.collection = "openrpa";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any): Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Enable(model: any): Promise<any> {
            this.loading = true;
            model.enabled = true;
            await this.api.Update(this.collection, model);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async Disable(model: any): Promise<any> {
            this.loading = true;
            model.enabled = false;
            await this.api.Update(this.collection, model);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
}
