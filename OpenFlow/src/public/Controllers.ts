import { userdata, api, entityCtrl, entitiesCtrl } from "./CommonControllers";
import { TokenUser, QueueMessage, SigninMessage, Ace, NoderedUser, Billing, stripe_customer, stripe_list, stripe_base, stripe_plan, stripe_subscription_item, Base, NoderedUtil, WebSocketClient, Role, NoderedConfig, Resources, ResourceValues, stripe_invoice, Message } from "openflow-api";
import { RPAWorkflow, Provider, Form, WorkflowInstance, Workflow, unattendedclient } from "./Entities";
import { WebSocketClientService } from "./WebSocketClientService";
import * as jsondiffpatch from "jsondiffpatch";

function treatAsUTC(date): number {
    const result = new Date(date);
    result.setMinutes(result.getMinutes() - result.getTimezoneOffset());
    return result as any;
}
function daysBetween(startDate, endDate): number {
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    return (treatAsUTC(endDate) - treatAsUTC(startDate)) / millisecondsPerDay;
}
declare const Formio: any;
declare const FileSaver: any;
export class RPAWorkflowCtrl extends entityCtrl<RPAWorkflow> {
    public arguments: any;
    public users: TokenUser[];
    public user: TokenUser;
    public messages: string;
    public queuename: string = "";
    public timeout: string = (60 * 1000).toString(); // 1 min;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("RPAWorkflowCtrl");
        this.collection = "openrpa";
        this.messages = "";
        WebSocketClientService.onSignedin(async (_user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                this.queuename = await NoderedUtil.RegisterQueue(WebSocketClient.instance, "", (data: QueueMessage, ack: any) => {
                    ack();
                    console.debug(data);
                    if (data.data.command == undefined && data.data.data != null) data.data = data.data.data;
                    this.messages += data.data.command + "\n";
                    if (data.data.command == "invokecompleted") {
                        this.arguments = data.data.data;
                    }
                    if (data.data.command == "invokefailed") {
                        if (data.data && data.data.data && data.data.data.Message) {
                            this.errormessage = data.data.data.Message;
                        } else {
                            this.errormessage = JSON.stringify(data.data);
                        }

                    }

                    if (!this.$scope.$$phase) { this.$scope.$apply(); }

                });
                console.log(this.queuename);
                await this.loadData();
                await this.loadUsers();
            } else {
                console.error("Missing id");
            }
        });
    }
    async loadUsers(): Promise<void> {
        this.users = await NoderedUtil.Query("users", { $or: [{ _type: "user" }, { _type: "role", rparole: true }] }, null, null, 100, 0, null);
        this.users.forEach(user => {
            if (user._id == this.model._createdbyid || user._id == this.model._createdbyid) {
                this.user = user;
            }
        });
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async submit(): Promise<void> {

        try {
            this.errormessage = "";
            const rpacommand = {
                command: "invoke",
                workflowid: this.model._id,
                data: this.arguments
            }
            if (this.arguments === null || this.arguments === undefined) { this.arguments = {}; }
            const result: any = await NoderedUtil.QueueMessage(WebSocketClient.instance, this.user._id, this.queuename, rpacommand, null, parseInt(this.timeout));
            try {
                // result = JSON.parse(result);
            } catch (error) {
            }
        } catch (error) {
            this.errormessage = JSON.stringify(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class RPAWorkflowsCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("RPAWorkflowsCtrl");
        this.collection = "openrpa";
        this.basequery = { _type: "workflow" };
        this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1, projectandname: 1 };
        this.postloadData = this.processdata;
        if (this.userdata.data != null && this.userdata.data.basequeryas != null) {
            this.basequeryas = this.userdata.data.basequeryas;
        } else if (this.userdata.data.RPAWorkflowsCtrl) {
            if (this.userdata.data.RPAWorkflowsCtrl.basequeryas) this.basequeryas = this.userdata.data.RPAWorkflowsCtrl.basequeryas;
            if (this.userdata.data.RPAWorkflowsCtrl.basequery) {
                this.basequery = this.userdata.data.RPAWorkflowsCtrl.basequery;
                this.collection = this.userdata.data.RPAWorkflowsCtrl.collection;
                this.baseprojection = this.userdata.data.RPAWorkflowsCtrl.baseprojection;
                this.orderby = this.userdata.data.RPAWorkflowsCtrl.orderby;
                this.searchstring = this.userdata.data.RPAWorkflowsCtrl.searchstring;
                this.basequeryas = this.userdata.data.RPAWorkflowsCtrl.basequeryas;
            }
        }
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    processdata() {
        this.loading = true;
        this.loading = false;
        if (!this.userdata.data.RPAWorkflowsCtrl) this.userdata.data.RPAWorkflowsCtrl = {};
        this.userdata.data.RPAWorkflowsCtrl.basequery = this.basequery;
        this.userdata.data.RPAWorkflowsCtrl.collection = this.collection;
        this.userdata.data.RPAWorkflowsCtrl.baseprojection = this.baseprojection;
        this.userdata.data.RPAWorkflowsCtrl.orderby = this.orderby;
        this.userdata.data.RPAWorkflowsCtrl.searchstring = this.searchstring;
        this.userdata.data.RPAWorkflowsCtrl.basequeryas = this.basequeryas;
        const chart: chartset = null;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        this.dographs();
    }
    async dographs() {
        const datatimeframe = new Date(new Date().toISOString());
        datatimeframe.setDate(datatimeframe.getDate() - 5);
        const agg: any = [
            { $match: { _created: { "$gte": datatimeframe } } },
            {
                $group:
                {
                    _id:
                    {
                        WorkflowId: "$WorkflowId",
                        name: "$name",
                        day: { $dayOfMonth: "$_created" }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.day": 1 } }
            // ,{ "$limit": 20 }
        ];
        const workflowruns = await NoderedUtil.Aggregate("openrpa_instances", agg, null);


        for (let i = 0; i < this.models.length; i++) {
            const workflow = this.models[i] as any;

            const chart: chartset = new chartset();
            chart.data = [];
            for (let x = 0; x < workflowruns.length; x++) {
                if (workflowruns[x]._id.WorkflowId == workflow._id) {
                    chart.data.push(workflowruns[x].count);
                    chart.labels.push(workflowruns[x]._id.day);
                }
            }
            if (chart.data.length > 0) {
                workflow.chart = chart;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }

        }

    }
    download(data, filename, type) {
        const file = new Blob([data], { type: type });
        if (window.navigator.msSaveOrOpenBlob) // IE10+
            window.navigator.msSaveOrOpenBlob(file, filename);
        else { // Others
            const a = document.createElement("a"),
                url = URL.createObjectURL(file);
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 0);
        }
    }
    async Download(model: any) {
        const workflows = await NoderedUtil.Query("openrpa", { _type: "workflow", _id: model._id }, null, null, 0, 0, null);
        if (workflows.length > 0) {
            model = workflows[0];
            this.download(model.Xaml, model.name + ".xaml", "application/xaml+xml");
        }
    }

}
export class WorkflowsCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.collection = "workflow";
        this.basequery = { _type: "workflow", web: true };
        console.debug("WorkflowsCtrl");
        this.postloadData = this.processData;
        if (this.userdata.data.WorkflowsCtrl) {
            this.basequery = this.userdata.data.WorkflowsCtrl.basequery;
            this.collection = this.userdata.data.WorkflowsCtrl.collection;
            this.baseprojection = this.userdata.data.WorkflowsCtrl.baseprojection;
            this.orderby = this.userdata.data.WorkflowsCtrl.orderby;
            this.searchstring = this.userdata.data.WorkflowsCtrl.searchstring;
            this.basequeryas = this.userdata.data.WorkflowsCtrl.basequeryas;
        }
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async processData(): Promise<void> {
        if (!this.userdata.data.WorkflowsCtrl) this.userdata.data.WorkflowsCtrl = {};
        this.userdata.data.WorkflowsCtrl.basequery = this.basequery;
        this.userdata.data.WorkflowsCtrl.collection = this.collection;
        this.userdata.data.WorkflowsCtrl.baseprojection = this.baseprojection;
        this.userdata.data.WorkflowsCtrl.orderby = this.orderby;
        this.userdata.data.WorkflowsCtrl.searchstring = this.searchstring;
        this.userdata.data.WorkflowsCtrl.basequeryas = this.basequeryas;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class chartset {
    options: any = {
        legend: { display: true }
    };
    // baseColors: string[] = ['#F7464A', '#97BBCD', '#FDB45C', '#46BFBD', '#949FB1', '#4D5360'];
    // baseColors: string[] = ['#803690', '#00ADF9', '#DCDCDC', '#46BFBD', '#FDB45C', '#949FB1', '#4D5360'];
    baseColors: [
        '#97BBCD', // blue
        '#DCDCDC', // light grey
        '#F7464A', // red
        '#46BFBD', // green
        '#FDB45C', // yellow
        '#949FB1', // grey
        '#4D5360'  // dark grey
    ];
    colors: string[] = [
        '#97BBCD', // blue
        '#DCDCDC', // light grey
        '#F7464A', // red
        '#46BFBD', // green
        '#FDB45C', // yellow
        '#949FB1', // grey
        '#4D5360'  // dark grey
    ];
    type: string = 'bar';
    heading: string = "";
    labels: string[] = [];
    series: string[] = [];
    data: any[] = [];
    ids: any[] = [];
    charttype: string = "bar";
    click: any = null;
}
export declare function emit(k, v);
export class ReportsCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    public datatimeframe: Date;
    public onlinetimeframe: Date;
    public timeframedesc: string = "";
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("ReportsCtrl");
        WebSocketClientService.onSignedin((user: TokenUser) => {
            if (this.userdata.data.ReportsCtrl) {
                this.datatimeframe = this.userdata.data.ReportsCtrl.datatimeframe;
                this.onlinetimeframe = this.userdata.data.ReportsCtrl.onlinetimeframe;
                this.processData();
            } else {
                this.settimeframe(30, 0, "30 days");
            }

        });
    }
    settimeframe(days, hours, desc) {
        this.datatimeframe = new Date(new Date().toISOString());
        if (days > 0) this.datatimeframe.setDate(this.datatimeframe.getDate() - days);
        if (hours > 0) this.datatimeframe.setHours(this.datatimeframe.getHours() - hours);
        this.timeframedesc = desc;

        this.onlinetimeframe = new Date(new Date().toISOString());
        this.onlinetimeframe.setMinutes(this.onlinetimeframe.getMinutes() - 1);
        // this.datatimeframe = new Date(new Date().toISOString());
        // this.datatimeframe.setMonth(this.datatimeframe.getMonth() - 1);

        // dt = new Date(new Date().toISOString());
        // dt.setMonth(dt.getMonth() - 1);
        // //dt.setDate(dt.getDate() - 1);
        // dt = new Date(new Date().toISOString());
        // dt.setMonth(dt.getMonth() - 1);
        // const dt2 = new Date(new Date().toISOString());
        // dt2.setMinutes(dt.getMinutes() - 1);

        if (!this.userdata.data.ReportsCtrl) this.userdata.data.ReportsCtrl = { run: this.processData.bind(this) };
        this.userdata.data.ReportsCtrl.datatimeframe = this.datatimeframe;
        this.userdata.data.ReportsCtrl.onlinetimeframe = this.onlinetimeframe;
        this.userdata.data.ReportsCtrl.run(this.userdata.data.ReportsCtrl.points);
    }
    async processData(): Promise<void> {
        console.debug('processData');
        this.userdata.data.ReportsCtrl.run = this.processData.bind(this);
        this.userdata.data.ReportsCtrl.points = null;
        this.loading = true;
        this.charts = [];
        const agg: any = [
            { $match: { _rpaheartbeat: { "$gte": this.datatimeframe } } },
            { "$count": "_rpaheartbeat" }
        ];
        const data: any[] = await NoderedUtil.Aggregate("users", agg, null);
        let totalrobots = 0;
        if (data.length > 0) totalrobots = data[0]._rpaheartbeat;

        const agg2 = [
            { $match: { _rpaheartbeat: { "$gte": this.onlinetimeframe } } },
            { "$count": "_rpaheartbeat" }
        ];
        const data2 = await NoderedUtil.Aggregate("users", agg2, null);
        let onlinerobots = 0;
        if (data2.length > 0) onlinerobots = data2[0]._rpaheartbeat;

        const chart: chartset = new chartset();
        chart.heading = onlinerobots + " Online and " + (totalrobots - onlinerobots) + " offline robots, seen the last " + this.timeframedesc;
        chart.labels = ['online', 'offline'];
        chart.data = [onlinerobots, (totalrobots - onlinerobots)];
        chart.charttype = "pie";
        chart.colors = [
            // '#98FB98', // very light green
            // '#F08080', // very light red
            // '#228B22', // green
            // '#B22222', // red
            '#006400', // green
            '#8B0000', // red
        ];

        // chart.click = this.robotsclick.bind(this);
        chart.click = this.robotsclick.bind(this);
        this.charts.push(chart);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }


        // const agg = [{ "$group": { "_id": "$_type", "count": { "$sum": 1 } } }];

        const agg3 = [
            { $match: { _created: { "$gte": this.datatimeframe }, _type: "workflowinstance" } },
            { "$group": { "_id": { "WorkflowId": "$WorkflowId", "name": "$name" }, "count": { "$sum": 1 } } },
            { $sort: { "count": -1 } },
            { "$limit": 20 }
        ];
        const workflowruns = await NoderedUtil.Aggregate("openrpa_instances", agg3, null);


        const chart2: chartset = new chartset();
        chart2.heading = "Workflow runs (top 20)";
        // chart2.series = ['name', 'count'];
        // chart2.labels = ['name', 'count'];
        chart2.data = [];
        chart2.ids = [];
        for (let x = 0; x < workflowruns.length; x++) {
            // chart2.data[0].push(workflowruns[x]._id.name);
            // chart2.data[1].push(workflowruns[x].count);
            chart2.data.push(workflowruns[x].count);
            chart2.ids.push(workflowruns[x]._id.WorkflowId);
            chart2.labels.push(workflowruns[x]._id.name);
            //     if (workflow == undefined) { chart2.labels.push("unknown"); } else { chachart2rt.labels.push(workflow.name); }
            // }
        }
        chart2.click = this.workflowclick.bind(this);
        this.charts.push(chart2);

        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async robotsclick(points, evt): Promise<void> {
        console.debug('robotsclick');
        this.userdata.data.ReportsCtrl.run = this.robotsclick.bind(this);
        this.userdata.data.ReportsCtrl.points = points;
        if (points.length > 0) {
        } else { return; }
        let chart: chartset = null;
        let agg: any = {};
        let rpaheartbeat: any = [];
        if (points[0]._index == 0) // Online robots
        {
            // rpaheartbeat = { $match: { "user._rpaheartbeat": { "$gte": this.onlinetimeframe } } };
            rpaheartbeat = { $match: { "_rpaheartbeat": { "$gte": this.onlinetimeframe } } };
        } else {

            // rpaheartbeat = { $match: { "user._rpaheartbeat": { "$lt": this.onlinetimeframe } } };
            rpaheartbeat = { $match: { "_rpaheartbeat": { "$lt": this.onlinetimeframe } } };
        }
        this.charts = [];
        agg = [
            { $match: { _type: 'user' } }
            , { $sort: { "_rpaheartbeat": -1 } }
            , { "$limit": 20 }
            , rpaheartbeat
            , {
                $lookup: {
                    from: "audit",
                    localField: "_id",
                    foreignField: "userid",
                    as: "audit"
                }
            }
            , {
                $project: {
                    "_id": 1,
                    "name": 1,
                    "count": { "$size": "$audit" }
                }
            }
            , { $sort: { "count": -1 } }
            // , { $sort: { "_rpaheartbeat": -1 } }
            // , { "$limit": 20 }
        ];

        const data = await NoderedUtil.Aggregate("users", agg, null);

        chart = new chartset();
        if (points[0]._index == 0) // Online robots
        {
            chart.heading = "Logins per online robot the last " + this.timeframedesc + " (top 20)";
        } else {
            chart.heading = "Logins per offline robot the last " + this.timeframedesc + " (top 20)";
        }
        chart.data = [];
        chart.ids = [];
        for (let x = 0; x < data.length; x++) {
            chart.data.push(data[x].count);
            chart.ids.push(data[x]._id);
            chart.labels.push(data[x].name);
        }
        chart.click = this.robotclick.bind(this);
        this.charts.push(chart);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }


        if (points[0]._index == 0) // Online robots
        {
            rpaheartbeat = { $match: { "user._rpaheartbeat": { "$gte": this.onlinetimeframe } } };
        } else {
            rpaheartbeat = { $match: { "user._rpaheartbeat": { "$lt": this.onlinetimeframe } } };
        }

        agg = [
            { $match: { _created: { "$gte": this.datatimeframe }, _type: "workflowinstance" } },
            {
                $lookup: {
                    from: "users",
                    localField: "ownerid",
                    foreignField: "_id",
                    as: "userarr"
                }
            },
            {
                "$project": {
                    "WorkflowId": 1,
                    "name": 1,
                    "user": { "$arrayElemAt": ["$userarr", 0] }
                }
            },
            {
                "$project": {
                    "WorkflowId": 1,
                    "newname": { $concat: ["$name", " (", "$user.name", ")"] },
                    "name": 1,
                    "user": 1
                }
            },
            rpaheartbeat,
            // { $project: { "newname":  } },


            { "$group": { "_id": { "WorkflowId": "$WorkflowId", "name": "$newname" }, "count": { "$sum": 1 } } },
            { $sort: { "count": -1 } },
            { "$limit": 20 }
        ];
        const workflowruns = await NoderedUtil.Aggregate("openrpa_instances", agg, null);

        chart = new chartset();
        if (points[0]._index == 0) // Online robots
        {
            chart.heading = "Workflow runs for online robots (top 20)";
        } else {
            chart.heading = "Workflow runs for offline robots (top 20)";
        }
        chart.data = [];
        chart.ids = [];
        for (let x = 0; x < workflowruns.length; x++) {
            chart.data.push(workflowruns[x].count);
            chart.ids.push(workflowruns[x]._id.WorkflowId);
            chart.labels.push(workflowruns[x]._id.name);
        }
        chart.click = this.workflowclick.bind(this);
        this.charts.push(chart);


        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
    async robotclick(points, evt): Promise<void> {
        console.debug('robotclick');
        if (points.length > 0) {
        } else { return; }
        const userid = this.charts[0].ids[points[0]._index];
        let chart: chartset = null;
        let agg: any = {};
        agg = [
            { $match: { _created: { "$gte": this.datatimeframe }, _type: "workflowinstance", ownerid: userid } },
            { "$group": { "_id": { "WorkflowId": "$WorkflowId", "name": "$name", "owner": "$owner" }, "count": { "$sum": 1 } } },
            { $sort: { "count": -1 } },
            { "$limit": 20 }
        ];
        const workflowruns = await NoderedUtil.Aggregate("openrpa_instances", agg, null);

        chart = new chartset();
        if (workflowruns.length > 0) // Online robots
        {
            chart.heading = "Workflow runs for " + workflowruns[0].owner + " (top 20)";
        } else {
            chart.heading = "No data (or permissions) for robot";
        }
        chart.data = [];
        chart.ids = [];
        for (let x = 0; x < workflowruns.length; x++) {
            chart.data.push(workflowruns[x].count);
            chart.ids.push(workflowruns[x]._id.WorkflowId);
            chart.labels.push(workflowruns[x]._id.name);
        }
        chart.click = this.workflowclick.bind(this);
        this.charts.splice(1, 1);
        this.charts.push(chart);


        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
    async workflowclick(points, evt): Promise<void> {
        console.debug('workflowclick');
        if (points.length > 0) {
        } else { return; }

        const WorkflowId = this.charts[1].ids[points[0]._index];

        let chart: chartset = null;
        let agg: any = {};
        agg = [
            { $match: { _created: { "$gte": this.datatimeframe }, WorkflowId: WorkflowId } },
            {
                $group:
                {
                    _id:
                    {
                        name: "$name",
                        day: { $dayOfMonth: "$_created" },
                        month: { $month: "$_created" },
                        year: { $year: "$_created" }
                    },
                    total: { $sum: "$data" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.day": 1 } },
            { "$limit": 20 }
        ];
        const workflowruns = await NoderedUtil.Aggregate("openrpa_instances", agg, null);

        chart = new chartset();
        if (workflowruns.length > 0) {
            chart.heading = "Number of runs per day for " + workflowruns[0]._id.name;
        } else {
            chart.heading = "No data ";
        }
        chart.data = [];
        for (let x = 0; x < workflowruns.length; x++) {
            chart.data.push(workflowruns[x].count);
            chart.labels.push(workflowruns[x]._id.day);
        }
        chart.click = this.processData.bind(this);
        this.charts.splice(1, 1);
        this.charts.push(chart);


        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
    async InsertNew(): Promise<void> {
        // this.loading = true;
        const model = { name: "Find me " + Math.random().toString(36).substr(2, 9), "temp": "hi mom" };
        const result = await NoderedUtil.InsertOne(this.collection, model, 1, false, null);
        this.models.push(result);
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async UpdateOne(model: any): Promise<any> {
        const index = this.models.indexOf(model);
        this.loading = true;
        model.name = "Find me " + Math.random().toString(36).substr(2, 9);
        const newmodel = await NoderedUtil.UpdateOne(this.collection, null, model, 1, false, null);
        this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
        this.models.splice(index, 0, newmodel);
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class MainCtrl extends entitiesCtrl<Base> {
    public showcompleted: boolean = false;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("MainCtrl");
        this.collection = "workflow_instances"
        // this.basequery = { state: { $ne: "completed" }, $and: [{ form: { $exists: true } }, { form: { "$ne": "none" } }] };
        // this.basequery = { state: { $ne: "completed" }, form: { $exists: true } };
        this.preloadData = () => {
            const user = this.WebSocketClientService.user;
            const ors: any[] = [];
            ors.push({ targetid: user._id });
            this.WebSocketClientService.user.roles.forEach(role => {
                ors.push({ targetid: role._id });
            });
            this.basequery = {};
            this.basequery = { $or: ors };
            if (!this.showcompleted) {
                // this.basequery.state = { $ne: "completed" };
                this.basequery["$and"] = [{ state: { $ne: "completed" } }, { state: { $ne: "failed" } }];
                this.basequery.form = { $exists: true };
                // this.basequery.$or = ors;
            } else {
            }
        };
        WebSocketClientService.onSignedin((_user: TokenUser) => {
            this.loadData();
        });

    }
}
declare const QRScanner: any;
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
        "WebSocketClientService",
        "api"
    ];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        console.debug("LoginCtrl::constructor");
        this.domain = window.location.hostname;
        WebSocketClientService.getJSON("/loginproviders", async (error: any, data: any) => {
            this.providers = data;
            this.allow_user_registration = WebSocketClientService.allow_user_registration;
            for (let i: number = this.providers.length - 1; i >= 0; i--) {
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
            const win: any = window;
            //const type = win.TEMPORARY;
            const type = win.PERSISTENT;
            const size = 5 * 1024 * 1024;
            win.requestFileSystem(type, size, successCallback, errorCallback)
            function successCallback(fs) {
                fs.root.getFile(filename, {}, function (fileEntry) {

                    fileEntry.file(function (file) {
                        const reader = new FileReader();
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
            const win: any = window;
            //const type = win.TEMPORARY;
            const type = win.PERSISTENT;
            const size = 5 * 1024 * 1024;
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
                        const blob = new Blob([content], { type: 'text/plain' });
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
            const config = JSON.parse(value);
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
            const result: SigninMessage = await NoderedUtil.SigninWithUsername(this.username, this.password, null);
            if (result.user == null) { return; }
            this.setCookie("jwt", result.jwt, 365);
            this.$location.path("/");
        } catch (error) {
            this.message = error;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    Signup() {
        this.$location.path("/Signup");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    setCookie(cname, cvalue, exdays) {
        const d = new Date();
        d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
        const expires = "expires=" + d.toUTCString();
        document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
    }
    getCookie(cname) {
        const name = cname + "=";
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length, c.length);
            }
        }
        return "";
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
        "WebSocketClientService",
        "api"
    ];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        console.debug("MenuCtrl::constructor");
        $scope.$root.$on('$routeChangeStart', (...args) => { this.routeChangeStart.apply(this, args); });
        this.path = this.$location.path();
        const cleanup = this.$scope.$on('signin', (event, data) => {
            if (event && data) { }
            this.user = data;
            this.signedin = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            // cleanup();
        });
    }
    routeChangeStart(event: any, next: any, current: any) {
        this.path = this.$location.path();
    }
    hasrole(role: string) {
        if (this.WebSocketClientService.user === null || this.WebSocketClientService.user === undefined) return false;
        const hits = this.WebSocketClientService.user.roles.filter(member => member.name == role);
        return (hits.length == 1)
    }
    hascordova() {
        return this.WebSocketClientService.usingCordova;
    }
    stopimpersonation() {
        // this.WebSocketClientService.loadToken();
        this.WebSocketClientService.impersonate("-1");
        console.log("done 2");
    }
    PathIs(path: string) {
        if (this.path == null && this.path == undefined) return false;
        return this.path.startsWith(path);
    }
}
export class ProvidersCtrl extends entitiesCtrl<Provider> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("ProvidersCtrl");
        this.basequery = { _type: "provider" };
        this.collection = "config";
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
}
export class ProviderCtrl extends entityCtrl<Provider> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("ProviderCtrl");
        this.collection = "config";
        WebSocketClientService.onSignedin((user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                this.loadData();
            } else {
                this.model = new Provider("", "", "", "uri:" + this.WebSocketClientService.domain, "")
            }

        });
    }
    async submit(): Promise<void> {
        if (this.model._id) {
            await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        } else {
            await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
        }
        this.$location.path("/Providers");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class UsersCtrl extends entitiesCtrl<TokenUser> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("UsersCtrl");
        this.basequery = { _type: "user" };
        this.collection = "users";
        this.searchfields = ["name", "username"];
        this.postloadData = this.processData;
        if (this.userdata.data.UsersCtrl) {
            this.basequery = this.userdata.data.UsersCtrl.basequery;
            this.collection = this.userdata.data.UsersCtrl.collection;
            this.baseprojection = this.userdata.data.UsersCtrl.baseprojection;
            this.orderby = this.userdata.data.UsersCtrl.orderby;
            this.searchstring = this.userdata.data.UsersCtrl.searchstring;
            this.basequeryas = this.userdata.data.UsersCtrl.basequeryas;
        }

        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async processData(): Promise<void> {
        if (!this.userdata.data.UsersCtrl) this.userdata.data.UsersCtrl = {};
        this.userdata.data.UsersCtrl.basequery = this.basequery;
        this.userdata.data.UsersCtrl.collection = this.collection;
        this.userdata.data.UsersCtrl.baseprojection = this.baseprojection;
        this.userdata.data.UsersCtrl.orderby = this.orderby;
        this.userdata.data.UsersCtrl.searchstring = this.searchstring;
        this.userdata.data.UsersCtrl.basequeryas = this.basequeryas;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async Impersonate(model: TokenUser): Promise<any> {
        try {
            this.loading = true;
            await this.WebSocketClientService.impersonate(model._id);
            this.loadData();
        } catch (error) {
            this.errormessage = JSON.stringify(error);
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DeleteOneUser(model: TokenUser): Promise<any> {
        this.loading = true;
        await NoderedUtil.DeleteOne(this.collection, model._id, null);
        this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
        this.loading = false;
        let name = model.username;
        name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();

        const list = await NoderedUtil.Query("users", { _type: "role", name: name + "noderedadmins" }, null, null, 2, 0, null);
        if (list.length == 1) {
            console.debug("Deleting " + name + "noderedadmins")
            await NoderedUtil.DeleteOne("users", list[0]._id, null);
        }

        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class UserCtrl extends entityCtrl<TokenUser> {
    public newid: string;
    public memberof: Role[];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("UserCtrl");
        this.collection = "users";
        this.postloadData = this.processdata;
        this.memberof = [];
        WebSocketClientService.onSignedin((user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                this.loadData();
            } else {
                this.model = new TokenUser();
                this.model._type = "user";
                this.model.name = "";
                this.model.username = "";
                (this.model as any).newpassword = "";
                (this.model as any).sid = "";
                (this.model as any).federationids = [];
                this.processdata();
            }

        });
    }
    async processdata() {
        if (this.model != null && (this.model._id != null && this.model._id != "")) {
            this.memberof = await NoderedUtil.Query("users",
                {
                    $and: [
                        { _type: "role" },
                        { members: { $elemMatch: { _id: this.model._id } } }
                    ]
                }, null, { _type: -1, name: 1 }, 5, 0, null);
        } else {
            this.memberof = [];
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    deleteid(id) {
        if ((this.model as any).federationids === null || (this.model as any).federationids === undefined) {
            (this.model as any).federationids = [];
        }
        (this.model as any).federationids = (this.model as any).federationids.filter(function (m: any): boolean { return m !== id; });
    }
    addid() {
        if ((this.model as any).federationids === null || (this.model as any).federationids === undefined) {
            (this.model as any).federationids = [];
        }
        (this.model as any).federationids.push(this.newid);
    }
    RemoveMember(model: Role) {
        this.memberof = this.memberof.filter(x => x._id != model._id);
    }
    async submit(): Promise<void> {
        try {
            if (this.model._id) {
                await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
            } else {
                await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
            }
            const currentmemberof = await NoderedUtil.Query("users",
                {
                    $and: [
                        { _type: "role" },
                        { members: { $elemMatch: { _id: this.model._id } } }
                    ]
                }, null, { _type: -1, name: 1 }, 5, 0, null);
            for (let i = 0; i < currentmemberof.length; i++) {
                const memberof = currentmemberof[i];
                if (this.memberof == null || this.memberof == undefined) this.memberof = [];
                const exists = this.memberof.filter(x => x._id == memberof._id);
                if (exists.length == 0) {
                    console.debug("Updating members of " + memberof.name + " " + memberof._id);
                    console.debug("members: " + memberof.members.length);
                    memberof.members = memberof.members.filter(x => x._id != this.model._id);
                    console.debug("members: " + memberof.members.length);
                    try {
                        await NoderedUtil.UpdateOne("users", null, memberof, 1, false, null);
                    } catch (error) {
                        console.error("Error updating " + memberof.name, error);
                    }
                }
            }
            this.$location.path("/Users");
        } catch (error) {
            this.errormessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class RolesCtrl extends entitiesCtrl<Role> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("RolesCtrl");
        this.basequery = { _type: "role" };
        this.collection = "users";
        this.postloadData = this.processdata;
        if (this.userdata.data.RolesCtrl) {
            this.basequery = this.userdata.data.RolesCtrl.basequery;
            this.collection = this.userdata.data.RolesCtrl.collection;
            this.baseprojection = this.userdata.data.RolesCtrl.baseprojection;
            this.orderby = this.userdata.data.RolesCtrl.orderby;
            this.searchstring = this.userdata.data.RolesCtrl.searchstring;
            this.basequeryas = this.userdata.data.RolesCtrl.basequeryas;
        }
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    processdata() {
        if (!this.userdata.data.RolesCtrl) this.userdata.data.RolesCtrl = {};
        this.userdata.data.RolesCtrl.basequery = this.basequery;
        this.userdata.data.RolesCtrl.collection = this.collection;
        this.userdata.data.RolesCtrl.baseprojection = this.baseprojection;
        this.userdata.data.RolesCtrl.orderby = this.orderby;
        this.userdata.data.RolesCtrl.searchstring = this.searchstring;
        this.userdata.data.RolesCtrl.basequeryas = this.basequeryas;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class RoleCtrl extends entityCtrl<Role> {
    searchFilteredList: Role[] = [];
    searchSelectedItem: Role = null;
    searchtext: string = "";
    e: any = null;

    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("RoleCtrl");
        this.collection = "users";
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                await this.loadData();
            } else {
                this.model = new Role();
            }
        });
    }
    async submit(): Promise<void> {
        if (this.model._id) {
            await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        } else {
            this.model = await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
            // this.model = await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
            // this.model = await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        }
        this.$location.path("/Roles");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    RemoveMember(model: any) {
        if (this.model.members === undefined) { this.model.members = []; }
        for (let i: number = 0; i < this.model.members.length; i++) {
            if (this.model.members[i]._id === model._id) {
                this.model.members.splice(i, 1);
            }
        }
    }
    AddMember(model: any) {
        if (this.model.members === undefined) { this.model.members = []; }
        const user: any = this.searchSelectedItem;;
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
            let idx: number = -1;
            for (let i = 0; i < this.searchFilteredList.length; i++) {
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
        const ids: string[] = this.model.members.map(item => item._id);
        this.searchFilteredList = await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: this.searchtext }
                ]
            }
            , null, { _type: -1, name: 1 }, 2, 0, null);

        this.searchFilteredList = this.searchFilteredList.concat(await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: new RegExp([this.searchtext].join(""), "i") },
                    { _id: { $nin: ids } }
                ]
            }
            , null, { _type: -1, name: 1 }, 5, 0, null));
        // this.searchFilteredList = await NoderedUtil.Query("users",
        //     {
        //         $and: [
        //             { $or: [{ _type: "user" }, { _type: "role" }] },
        //             { name: new RegExp([this.searchtext].join(""), "i") },
        //             { _id: { $nin: ids } }
        //         ]
        //     }
        //     , null, { _type: -1, name: 1 }, 8, 0, null);
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
        "WebSocketClientService",
        "api"
    ];
    public messages: string = "";
    public queuename: string = "webtest";
    public message: string = "Hi mom";
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        console.debug("SocketCtrl");
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            await NoderedUtil.RegisterQueue(WebSocketClient.instance, "", (data: QueueMessage, ack: any) => {
                ack();
            });
        });
    }
}
export class FilesCtrl extends entitiesCtrl<Base> {
    public file: string;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("EntitiesCtrl");
        this.autorefresh = true;
        this.basequery = {};
        this.searchfields = ["metadata.name", "metadata.path"];
        this.collection = "files";
        this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
        const elem = document.getElementById("myBar");
        elem.style.width = '0%';
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async Download(id: string) {
        const lastp: number = 0;
        // const fileinfo = await NoderedUtil.GetFile(null, id, (msg, index, count) => {
        //     const p: number = ((index + 1) / count * 100) | 0;
        //     if (p > lastp || (index + 1) == count) {
        //         console.debug(index + "/" + count + " " + p + "%");
        //         lastp = p;
        //     }
        //     const elem = document.getElementById("myBar");
        //     elem.style.width = p + '%';
        //     elem.innerText = p + '%';
        //     if (p == 100) {
        //         elem.innerText = 'Processing ...';
        //     }
        // });
        const fileinfo = await NoderedUtil.GetFile(null, id, null);

        const elem = document.getElementById("myBar");
        elem.style.width = '0%';
        elem.innerText = '';
        const blob = this.b64toBlob(fileinfo.file, fileinfo.mimeType);
        // const blobUrl = URL.createObjectURL(blob);
        // (window.location as any) = blobUrl;
        const anchor = document.createElement('a');
        anchor.download = fileinfo.metadata.name;
        anchor.href = ((window as any).webkitURL || window.URL).createObjectURL(blob);
        anchor.dataset.downloadurl = [fileinfo.mimeType, anchor.download, anchor.href].join(':');
        anchor.click();
    }
    b64toBlob(b64Data: string, contentType: string, sliceSize: number = 512) {
        contentType = contentType || '';
        sliceSize = sliceSize || 512;
        const byteCharacters = atob(b64Data);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }
        const blob = new Blob(byteArrays, { type: contentType });
        return blob;
    }
    async Upload() {
        // const e: any = document.querySelector('input[type="file"]');
        const e: any = document.getElementById('fileupload')
        const fd = new FormData();
        for (let i = 0; i < e.files.length; i++) {
            const file = e.files[i];
            fd.append(e.name, file, file.name);
        };
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                console.debug("upload complete");
                // we done!
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                this.loadData();

            }
        };
        console.debug("open");
        xhr.open('POST', '/upload', true);
        console.debug("send");
        xhr.send(fd);
    }
    async Upload_usingapi() {
        try {
            const filename = (this.$scope as any).filename;
            const type = (this.$scope as any).type;
            console.debug("filename: " + filename + " type: " + type);
            this.loading = true;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            const lastp: number = 0;
            await NoderedUtil.SaveFile(filename, type, null, this.file, null);
            // await NoderedUtil.SaveFile(filename, type, null, this.file, (msg, index, count) => {
            //     const p: number = ((index + 1) / count * 100) | 0;
            //     if (p > lastp || (index + 1) == count) {
            //         console.debug(index + "/" + count + " " + p + "%");
            //         lastp = p;
            //     }
            //     const elem = document.getElementById("myBar");
            //     elem.style.width = p + '%';
            //     elem.innerText = p + '%';
            //     if (p == 100) {
            //         elem.innerText = 'Processing ...';
            //     }
            // });
            const elem = document.getElementById("myBar");
            elem.style.width = '0%';
            elem.innerText = '';
            this.loading = false;

        } catch (error) {
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        this.loadData();
    }
}
export class EntitiesCtrl extends entitiesCtrl<Base> {
    public collections: any;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("EntitiesCtrl");
        this.autorefresh = true;
        this.basequery = {};
        this.collection = $routeParams.collection;
        this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
        this.postloadData = this.processdata;
        if (this.userdata.data.EntitiesCtrl) {
            this.basequery = this.userdata.data.EntitiesCtrl.basequery;
            this.collection = this.userdata.data.EntitiesCtrl.collection;
            this.baseprojection = this.userdata.data.EntitiesCtrl.baseprojection;
            this.orderby = this.userdata.data.EntitiesCtrl.orderby;
            this.searchstring = this.userdata.data.EntitiesCtrl.searchstring;
            this.basequeryas = this.userdata.data.EntitiesCtrl.basequeryas;
        } else {
            if (NoderedUtil.IsNullEmpty(this.collection)) {
                this.$location.path("/Entities/entities");
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
        }
        console.log("path: " + this.$location.path());
        if (NoderedUtil.IsNullEmpty(this.collection)) {
            this.$location.path("/Entities/entities");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            return;
        } else if (this.$location.path() != "/Entities/" + this.collection) {
            this.$location.path("/Entities/" + this.collection);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            return;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            this.loadData();
            this.collections = await NoderedUtil.ListCollections(null);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        });
    }
    processdata() {
        if (!this.userdata.data.EntitiesCtrl) this.userdata.data.EntitiesCtrl = {};
        this.userdata.data.EntitiesCtrl.basequery = this.basequery;
        this.userdata.data.EntitiesCtrl.collection = this.collection;
        this.userdata.data.EntitiesCtrl.baseprojection = this.baseprojection;
        this.userdata.data.EntitiesCtrl.orderby = this.orderby;
        this.userdata.data.EntitiesCtrl.searchstring = this.searchstring;
        this.userdata.data.EntitiesCtrl.basequeryas = this.basequeryas;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    SelectCollection() {
        this.userdata.data.EntitiesCtrl.collection = this.collection;
        this.$location.path("/Entities/" + this.collection);
        //this.$location.hash("#/Entities/" + this.collection);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        // this.loadData();
    }
    async DropCollection() {
        await NoderedUtil.DropCollection(this.collection, null);
        this.collections = await NoderedUtil.ListCollections(null);
        this.collection = "entities";
        this.loadData();
    }
}
export class FormsCtrl extends entitiesCtrl<Base> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("FormsCtrl");
        this.autorefresh = true;
        this.collection = "forms";
        this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
}
export class EditFormCtrl extends entityCtrl<Form> {
    public message: string = "";
    public charts: chartset[] = [];
    public formBuilder: any;
    public Formiobuilder: any;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("EditFormCtrl");
        this.collection = "forms";
        this.basequery = {};
        this.id = $routeParams.id;
        this.basequery = { _id: this.id };
        this.postloadData = this.renderform;
        this.
            WebSocketClientService.onSignedin(async (user: TokenUser) => {
                if (this.id !== null && this.id !== undefined && this.id !== "") {
                    this.basequery = { _id: this.id };
                    this.loadData();
                } else {
                    this.model = new Form();
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
            this.model = await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        } else {
            this.model = await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
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
            const roles: any = {};
            this.WebSocketClientService.user.roles.forEach(role => {
                roles[role._id] = role.name;
            });

            const fbOptions = {
                formData: this.model.formData,
                dataType: this.model.dataType,
                roles: roles,
                disabledActionButtons: ['data', 'clear'],
                onSave: this.Save.bind(this),
            };
            const ele: any = $(document.getElementById('fb-editor'));
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
export class FormCtrl extends entityCtrl<WorkflowInstance> {
    public message: string = "";
    public formRender: any;
    public formioRender: any;
    public workflow: Workflow;
    public form: Form;
    public instanceid: string;
    public myid: string;
    public submitbutton: string;
    public queuename: string;
    public queue_message_timeout: number = (60 * 1000); // 1 min

    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        this.myid = new Date().toISOString();
        console.debug("FormCtrl");
        this.collection = "workflow";
        this.basequery = {};
        this.id = $routeParams.id;
        this.instanceid = $routeParams.instance;

        this.basequery = { _id: this.id };
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            this.queuename = await NoderedUtil.RegisterQueue(WebSocketClient.instance, "", (data: QueueMessage, ack: any) => {
                ack();
                console.debug(data);
                if (data.queuename == this.queuename) {
                    if (this.instanceid == null && data.data._id != null) {
                        this.instanceid = data.data._id;
                        // this.$location.path("/Form/" + this.id + "/" + this.instanceid);
                        // if (!this.$scope.$$phase) { this.$scope.$apply(); }
                        this.loadData();
                        return;
                    } else {
                        this.loadData();
                    }
                }
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            });
            console.log(this.queuename);
            if (this.id !== null && this.id !== undefined && this.id !== "") {
                this.basequery = { _id: this.id };
                this.loadData();
            } else {
                this.errormessage = "missing id";
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                console.error(this.errormessage);
            }
        });

    }
    hideFormElements() {
        console.log("hideFormElements");
        $('#workflowform :input').prop("disabled", true);
        $('#workflowform :button').prop("disabled", true);
        $('#workflowform :input').addClass("disabled");
        $('#workflowform :button').addClass("disabled");
        $('#workflowform .form-group').addClass("is-disabled");
        $('#workflowform .form-group').prop("isDisabled", true);


        // $('.form-control').addClass("disabled");
        // $('.dropdown').attr("checked", "checked");;

        $('#workflowform :button').hide();
        $('input[type="submit"]').hide();

    }
    async loadData(): Promise<void> {
        this.loading = true;
        this.message = "";
        const res = await NoderedUtil.Query(this.collection, this.basequery, null, { _created: -1 }, 1, 0, null);
        if (res.length > 0) { this.workflow = res[0]; } else {
            this.errormessage = this.id + " workflow not found!";
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            console.error(this.errormessage);
            return;
        }
        if (this.instanceid !== null && this.instanceid !== undefined && this.instanceid !== "") {
            const res = await NoderedUtil.Query("workflow_instances", { _id: this.instanceid }, null, { _created: -1 }, 1, 0, null);
            if (res.length > 0) { this.model = res[0]; } else {
                this.errormessage = this.id + " workflow instances not found!";
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                console.error(this.errormessage);
                return;
            }
            console.log('model', this.model);
            // console.debug(this.model);
            // console.debug(this.model.form);
            // console.debug("form: " + this.model.form);
            if (this.model.payload === null || this.model.payload === undefined) {
                this.model.payload = { _id: this.instanceid };
            }
            if (typeof this.model.payload !== "object") {
                this.model.payload = { message: this.model.payload, _id: this.instanceid };
            }


            if (this.model.form === "none" || this.model.form === "" || this.model.state == "processing") {
                if (this.model.state != "failed" && this.model.state != "processing") {
                    this.$location.path("/main");
                } else {
                    this.hideFormElements();
                    if (this.model.state == "failed") {
                        if ((this.model as any).error != null && (this.model as any).error != "") {
                            this.errormessage = (this.model as any).error;
                        } else if (!this.model.payload) {
                            this.errormessage = "An unknown error occurred";
                        } else if (this.model.payload.message != null && this.model.payload.message != "") {
                            this.errormessage = this.model.payload.message;
                        } else if (this.model.payload.Message != null && this.model.payload.Message != "") {
                            this.errormessage = this.model.payload.Message;
                        } else {
                            this.errormessage = this.model.payload;
                        }
                        console.log(this.model.payload);
                    } else {
                        this.message = "Processing . . .";
                    }
                }
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            } else if (this.model.form === "unknown") {
                console.debug("Form is unknown for instance, send empty message");
                this.Save();
                return;
            } else if (this.model.form !== "") {
                const res = await NoderedUtil.Query("forms", { _id: this.model.form }, null, { _created: -1 }, 1, 0, null);
                if (res.length > 0) { this.form = res[0]; } else {
                    if (this.model.state == "completed") {
                        this.$location.path("/main");
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                        return;
                    } else {
                        this.errormessage = this.model.form + " form not found! " + this.model.state;
                        if (!this.$scope.$$phase) { this.$scope.$apply(); }
                        console.error(this.errormessage);
                        return;
                    }
                }
            } else {
                // this.errormessage = "Model contains no form";
                // if (!this.$scope.$$phase) { this.$scope.$apply(); }
                // console.error(this.errormessage);
            }
            this.renderform();
        } else {
            try {
                console.debug("No instance id found, send empty message");
                console.debug("SendOne: " + this.workflow._id + " / " + this.workflow.queue);
                await this.SendOne(this.workflow.queue, {});
            } catch (error) {
                this.errormessage = error;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                console.error(this.errormessage);

            }
        }
    }
    async SendOne(queuename: string, message: any): Promise<void> {
        let result: any = await NoderedUtil.QueueMessage(WebSocketClient.instance, queuename, this.queuename, message, null, this.queue_message_timeout);
        try {
            if (typeof result === "string" || result instanceof String) {
                result = JSON.parse((result as any));
            }
        } catch (error) {
            console.log(result);
            this.errormessage = error;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            console.error(this.errormessage);
        }
    }
    async Save() {
        if (this.form !== null && this.form !== undefined && this.form.fbeditor === true) {
            const userData: any[] = this.formRender.userData;
            if (this.model.payload === null || this.model.payload === undefined) { this.model.payload = {}; }
            for (let i = 0; i < userData.length; i++) {
                this.model.payload[userData[i].name] = "";
                const val = userData[i].userData;
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
            const ele = $('.render-wrap');
            ele.hide();
        } else {

        }
        // console.debug("SendOne: " + this.workflow._id + " / " + this.workflow.queue);
        this.model.payload._id = this.instanceid;
        try {
            await this.SendOne(this.workflow.queue, this.model.payload);
        } catch (error) {
            this.errormessage = error;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            console.error(this.errormessage);
        }
        this.loadData();
    }
    traversecomponentsPostProcess(components: any[], data: any) {
        for (let i = 0; i < components.length; i++) {
            const item = components[i];
            if (item.type == "button" && item.action == "submit") {
                if (data[item.key] == true) {
                    this.submitbutton = item.key;
                    this.model.payload.submitbutton = item.key;
                }
            }
        }

        for (let i = 0; i < components.length; i++) {
            const item = components[i];
            if (item.type == "table") {
                for (let x = 0; x < item.rows.length; x++) {
                    for (let y = 0; y < item.rows[x].length; y++) {
                        const subcomponents = item.rows[x][y].components;
                        this.traversecomponentsPostProcess(subcomponents, data);
                    }

                }
            }
        }

    }
    traversecomponentsMakeDefaults(components: any[]) {
        for (let y = 0; y < components.length; y++) {
            const item = components[y];
            if (item.type == "datagrid") {
                if (this.model.payload[item.key] === null || this.model.payload[item.key] === undefined) {
                    const obj: any = {};
                    for (let x = 0; x < item.components.length; x++) {
                        obj[item.components[x].key] = "";
                    }
                    console.debug("add default array for " + item.key, obj);
                    this.model.payload[item.key] = [obj];
                } else {
                    console.debug("payload already have values for " + item.key);
                    console.debug("isArray: " + Array.isArray(this.model.payload[item.key]))
                    if (Array.isArray(this.model.payload[item.key])) {
                    } else {
                        console.debug("convert payload for " + item.key + " from object to array");
                        const keys = Object.keys(this.model.payload[item.key]);
                        const arr: any[] = [];
                        for (let x = 0; x < keys.length; x++) {
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
                const keys = Object.keys(this.model.payload.values);
            }
        }
        if (this.model.payload != null && this.model.payload != undefined) {
            if (this.model.payload.values != null && this.model.payload.values != undefined) {
                const keys = Object.keys(this.model.payload.values);
                for (let i = 0; i < keys.length; i++) {
                    const values = this.model.payload.values[keys[i]];
                    for (let y = 0; y < components.length; y++) {
                        const item = components[y];
                        if (item.key == keys[i]) {
                            if (Array.isArray(values)) {
                                console.debug("handle " + item.key + " as array");
                                const obj2: any = {};
                                for (let x = 0; x < values.length; x++) {
                                    obj2[x] = values[x];
                                }
                                if (item.data != null && item.data != undefined) {
                                    item.data.values = obj2;
                                    item.data.json = JSON.stringify(values);
                                    // console.debug("Setting values for " + keys[i], JSON.stringify(obj));
                                } else {
                                    item.values = values;
                                }
                            } else {
                                console.debug("handle " + item.key + " as an object");
                                if (item.data != null && item.data != undefined) {
                                    item.data.values = values;
                                    item.data.json = JSON.stringify(values);
                                    // console.debug("Setting values for " + keys[i], JSON.stringify(values));
                                } else {
                                    item.values = values;
                                }
                            }
                            // if (item.data != null && item.data != undefined) {
                            //     console.debug(keys[i], item.data);
                            // } else {
                            //     console.debug(keys[i], item);
                            // }
                        }
                    }

                }
            }
        }

        for (let i = 0; i < components.length; i++) {
            const item = components[i];
            if (item.type == "table") {
                for (let x = 0; x < item.rows.length; x++) {
                    for (let y = 0; y < item.rows[x].length; y++) {
                        const subcomponents = item.rows[x][y].components;
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
        next();
    }
    async renderform() {
        if (this.form.fbeditor == null || this.form.fbeditor == undefined) this.form.fbeditor = true;
        if ((this.form.fbeditor as any) == "true") this.form.fbeditor = true;
        if ((this.form.fbeditor as any) == "false") this.form.fbeditor = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        if (this.form.fbeditor === true) {
            console.debug("renderform");
            const roles: any = {};
            this.WebSocketClientService.user.roles.forEach(role => {
                roles[role._id] = role.name;
            });
            if (typeof this.form.formData === 'string' || this.form.formData instanceof String) {
                this.form.formData = JSON.parse((this.form.formData as any));
            }
            for (let i = 0; i < this.form.formData.length; i++) {
                let value = this.model.payload[this.form.formData[i].name];
                if (value == undefined || value == null) { value = ""; }
                if (value != "" || this.form.formData[i].type != "button") {
                    // console.debug("0:" + this.form.formData[i].label + " -> " + value);
                    this.form.formData[i].userData = [value];
                }
                if (Array.isArray(value)) {
                    // console.debug("1:" + this.form.formData[i].userData + " -> " + value);
                    this.form.formData[i].userData = value;
                }
                if (this.model.payload[this.form.formData[i].label] !== null && this.model.payload[this.form.formData[i].label] !== undefined) {
                    value = this.model.payload[this.form.formData[i].label];
                    if (value == undefined || value == null) { value = ""; }
                    if (this.form.formData[i].type != "button") {
                        // console.debug("2:" + this.form.formData[i].label + " -> " + value);
                        this.form.formData[i].label = value;
                    } else if (value != "") {
                        // console.debug("2button:" + this.form.formData[i].label + " -> " + value);
                        this.form.formData[i].label = value;
                    } else {
                        // console.debug("skip " + this.form.formData[i].label);
                    }
                }
                if (this.model.values !== null && this.model.values !== undefined) {
                    if (this.model.values[this.form.formData[i].name] !== null && this.model.values[this.form.formData[i].name] !== undefined) {
                        value = this.model.values[this.form.formData[i].name];
                        if (value == undefined || value == null) { value = []; }
                        // console.debug("3:" + this.form.formData[i].values + " -> " + value);
                        this.form.formData[i].values = value;
                    }
                }
            }
            const formRenderOpts = {
                formData: this.form.formData,
                dataType: this.form.dataType,
                roles: roles,
                disabledActionButtons: ['data', 'clear'],
                onSave: this.Save.bind(this),
            };
            if (this.model.userData !== null && this.model.userData !== undefined && this.model.userData !== "") {
                formRenderOpts.formData = this.model.userData;
            }
            const concatHashToString = function (hash) {
                let emptyStr = '';
                $.each(hash, function (index) {
                    emptyStr += ' ' + hash[index].name + '="' + hash[index].value + '"';
                });
                return emptyStr;
            }
            setTimeout(() => {
                console.debug("Attach buttons! 2");
                $('button[type="button"]').each(function () {
                    const cur: any = $(this)[0];
                    console.debug("set submit");
                    cur.type = "submit";
                });
                const click = function (evt) {
                    this.submitbutton = evt.target.id;
                }
                $('button[type="submit"]').click(click.bind(this));

            }, 500);
            const ele: any = $('.render-wrap');
            ele.show();
            this.formRender = ele.formRender(formRenderOpts);
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
                //console.debug('change', form);
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
                console.debug('onsubmit', submission);
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
                this.errormessage = errors;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                console.error(this.errormessage);
            });
        }
        if (this.model.state == "completed" || this.model.state == "failed") {
            this.hideFormElements();
            if (this.model.state == "failed") {
                if ((this.model as any).error != null && (this.model as any).error != "") {
                    this.errormessage = (this.model as any).error;
                } else if (!this.model.payload) {
                    this.errormessage = "An unknown error occurred";
                } else if (this.model.payload.message != null && this.model.payload.message != "") {
                    this.errormessage = this.model.payload.message;
                } else if (this.model.payload.Message != null && this.model.payload.Message != "") {
                    this.errormessage = this.model.payload.Message;
                } else {
                    this.errormessage = this.model.payload;
                }
                console.log(this.model.payload);
            }
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }

}
export class jslogCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("jslogCtrl");
        this.searchfields = ["_createdby", "host", "message"];
        this.collection = "jslog";
        this.basequery = {};
        this.orderby = { _created: -1 };
        this.baseprojection = { _type: 1, type: 1, host: 1, message: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async DeleteMany(): Promise<void> {
        this.loading = true;
        const Promises: Promise<void>[] = [];
        this.models.forEach(model => {
            Promises.push(NoderedUtil.DeleteOne(this.collection, model._id, null));
        });
        const results: any = await Promise.all(Promises.map(p => p.catch(e => e)));
        // const values: void[] = results.filter(result => !(result instanceof Error));
        // const ids: string[] = [];
        // values.forEach((x: void) => ids.push(x._id));
        // this.models = this.models.filter(function (m: any): boolean { return ids.indexOf(m._id) === -1; });
        // this.loading = false;

        this.models = await NoderedUtil.Query(this.collection, this.basequery, this.baseprojection, this.orderby, 100, 0, null);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        if (this.models.length > 0) {
            await this.DeleteMany();
        }
    }

}
export class EntityCtrl extends entityCtrl<Base> {
    searchFilteredList: TokenUser[] = [];
    searchSelectedItem: TokenUser = null;
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
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("EntityCtrl");
        this.collection = $routeParams.collection;
        this.postloadData = this.processdata;
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                await this.loadData();
            } else {
                this.model = new Base();
                this.model._type = "test";
                this.model.name = "new item";
                this.model._encrypt = [];
                this.keys = Object.keys(this.model);
                for (let i: number = this.keys.length - 1; i >= 0; i--) {
                    if (this.keys[i].startsWith('_')) this.keys.splice(i, 1);
                }
                this.searchSelectedItem = WebSocketClientService.user;
                this.adduser();
                this.processdata();
                //if (!this.$scope.$$phase) { this.$scope.$apply(); }
            }
        });
    }
    processdata() {
        const ids: string[] = [];
        if (this.collection == "files") {
            for (let i: number = 0; i < (this.model as any).metadata._acl.length; i++) {
                ids.push((this.model as any).metadata._acl[i]._id);
            }
        } else {
            for (let i: number = 0; i < this.model._acl.length; i++) {
                ids.push(this.model._acl[i]._id);
            }
        }
        if (this.model._encrypt == null) { this.model._encrypt = []; }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        this.fixtextarea();
    }
    fixtextarea() {
        setTimeout(() => {
            const tx = document.getElementsByTagName('textarea');
            for (let i = 0; i < tx.length; i++) {
                tx[i].setAttribute('style', 'height:' + (tx[i].scrollHeight) + 'px;overflow-y:hidden;');
                // tx[i].addEventListener("input", OnInput, false);
            }

            // function OnInput() {
            //     console.log(this.scrollHeight);
            //     this.style.height = 'auto';
            //     this.style.height = (this.scrollHeight) + 'px';
            // }

        }, 500);
    }
    togglejson() {
        this.showjson = !this.showjson;
        if (this.showjson) {
            this.jsonmodel = JSON.stringify(this.model, null, 2);
        } else {
            this.model = JSON.parse(this.jsonmodel);
            this.keys = Object.keys(this.model);
            for (let i: number = this.keys.length - 1; i >= 0; i--) {
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
        try {
            if (this.model._id) {
                await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
            } else {
                await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
            }
            if (this.collection == "files") {
                this.$location.path("/Files");
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
            this.$location.path("/Entities/" + this.collection);
        } catch (error) {
            this.errormessage = error;
        }
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
            for (let i = 0; i < (this.model as any).metadata._acl.length; i++) {
                if ((this.model as any).metadata._acl[i]._id == _id) {
                    (this.model as any).metadata._acl.splice(i, 1);
                }
            }
        } else {
            for (let i = 0; i < this.model._acl.length; i++) {
                if (this.model._acl[i]._id == _id) {
                    this.model._acl.splice(i, 1);
                    //this.model._acl = this.model._acl.splice(index, 1);
                }
            }
        }

    }
    adduser() {
        const ace = new Ace();
        ace.deny = false;
        ace._id = this.searchSelectedItem._id;
        ace.name = this.searchSelectedItem.name;
        // ace.rights = "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";

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
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        const currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        return (currentValue & mask) != 0;
    }
    setBit(base64: string, bit: number) {
        bit--;
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        const currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        const newValue = currentValue | mask;
        view[octet] = newValue;
        return this._arrayBufferToBase64(view);
    }
    unsetBit(base64: string, bit: number) {
        bit--;
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        let currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        const newValue = currentValue &= ~mask;
        view[octet] = newValue;
        return this._arrayBufferToBase64(view);
    }
    toogleBit(a: any, bit: number) {
        if (this.isBitSet(a.rights, bit)) {
            a.rights = this.unsetBit(a.rights, bit);
        } else {
            a.rights = this.setBit(a.rights, bit);
        }
        const buf2 = this._base64ToArrayBuffer(a.rights);
        const view2 = new Uint8Array(buf2);
    }
    _base64ToArrayBuffer(string_base64): ArrayBuffer {
        const binary_string = window.atob(string_base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            //const ascii = string_base64.charCodeAt(i);
            const ascii = binary_string.charCodeAt(i);
            bytes[i] = ascii;
        }
        return bytes.buffer;
    }
    _arrayBufferToBase64(array_buffer): string {
        let binary = '';
        const bytes = new Uint8Array(array_buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
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
            let idx: number = -1;
            for (let i = 0; i < this.searchFilteredList.length; i++) {
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
                console.debug("idx: " + idx);
                // this.searchtext = this.searchFilteredList[idx].name;
                this.searchSelectedItem = this.searchFilteredList[idx];
                return;
            }
            else if (this.e.keyCode == 40) { // down
                if (idx >= this.searchFilteredList.length) {
                    idx = this.searchFilteredList.length - 1;
                } else { idx++; }
                console.debug("idx: " + idx);
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
                // console.debug(this.e.keyCode);
            }
        } else {
            if (this.e.keyCode == 13 && this.searchSelectedItem != null) {
                this.adduser();
            }
        }
    }
    async handlefilter(e) {
        this.e = e;
        // console.debug(e.keyCode);
        let ids: string[];
        if (this.collection == "files") {
            ids = (this.model as any).metadata._acl.map(item => item._id);
        } else {
            ids = this.model._acl.map(item => item._id);
        }
        this.searchFilteredList = await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: this.searchtext }
                ]
            }
            , null, { _type: -1, name: 1 }, 2, 0, null);

        this.searchFilteredList = this.searchFilteredList.concat(await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: new RegExp([this.searchtext].join(""), "i") },
                    { _id: { $nin: ids } }
                ]
            }
            , null, { _type: -1, name: 1 }, 5, 0, null));
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
export class HistoryCtrl extends entitiesCtrl<Base> {
    public id: string = "";
    public model: Base;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("HistoryCtrl");
        this.id = $routeParams.id;
        this.basequery = { _id: this.id };
        this.collection = $routeParams.collection;
        this.baseprojection = null;
        this.postloadData = this.ProcessData;
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async ProcessData() {
        this.model = this.models[0];
        const keys = Object.keys(this.model);
        keys.forEach(key => {
            if (key.startsWith("_")) {
                delete this.model[key];
            }
        });
        this.models = await NoderedUtil.Query(this.collection + "_hist", { id: this.id }, { name: 1, _createdby: 1, _modified: 1, _version: 1 }, this.orderby, 100, 0, null);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async CompareNow(model) {
        const modal: any = $("#exampleModal");
        modal.modal()
        if (model.item == null) {
            const item = await NoderedUtil.GetDocumentVersion(this.collection, this.id, model._version, null);
            if (item != null) model.item = item;
        }
        if (model.item == null) {
            document.getElementById('visual').innerHTML = "Failed loading item version " + model._version;
        }
        const keys = Object.keys(model.item);
        keys.forEach(key => {
            if (key.startsWith("_")) {
                delete model.item[key];
            }
        });
        const delta = jsondiffpatch.diff(model.item, this.model);
        document.getElementById('visual').innerHTML = jsondiffpatch.formatters.html.format(delta, this.model);
    }
    async CompareThen(model) {
        if (model.delta == null) {
            const items = await NoderedUtil.Query(this.collection + "_hist", { _id: model._id }, null, this.orderby, 100, 0, null);
            if (items.length > 0) {
                model.item = items[0].item;
                model.delta = items[0].delta;
            }
        }
        const modal: any = $("#exampleModal");
        modal.modal();
        console.log(model.delta);
        document.getElementById('visual').innerHTML = jsondiffpatch.formatters.html.format(model.delta, {});
    }
    async RevertTo(model) {
        if (model.item == null) {
            const item = await NoderedUtil.GetDocumentVersion(this.collection, this.id, model._version, null);
            if (item != null) model.item = item;
        }
        let result = window.confirm("Overwrite current version with version " + model._version + "?");
        if (result) {
            jsondiffpatch.patch(model.item, model.delta);
            model.item._id = this.id;
            await NoderedUtil.UpdateOne(this.collection, null, model.item, 1, false, null);
            this.loadData();
        }
    }
}
export class NoderedCtrl {
    public static $inject = [
        "$scope",
        "$location",
        "$routeParams",
        "WebSocketClientService",
        "api"
    ];
    public messages: string = "";
    public errormessage: string = "";
    public queuename: string = "webtest";
    public noderedurl: string = "";
    public instance: any = null;
    public instances: any[] = null;
    public instancestatus: string = "";
    public instancelog: string = "";
    public name: string = "";
    public instancename: string = "";
    public userid: string = "";
    public user: NoderedUser = null;
    public limitsmemory: string = "";
    public loading: boolean = false;
    public labels: any = {};
    public keys: string[] = [];
    public labelkeys: string[] = [];
    public label: any = null;
    public newkey: string = "";
    public newvalue: string = "";
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        console.debug("NoderedCtrl");
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            this.loading = true;
            this.userid = $routeParams.id;
            if (this.userid == null || this.userid == undefined || this.userid == "") {
                this.name = WebSocketClientService.user.username;
                this.userid = WebSocketClientService.user._id;
                console.log("user", WebSocketClientService.user);
                const users: NoderedUser[] = await NoderedUtil.Query("users", { _id: this.userid }, null, null, 1, 0, null);
                if (users.length == 0) {
                    this.instancestatus = "Unknown id! " + this.userid;
                    this.errormessage = "Unknown id! " + this.userid;
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    return;
                }

                this.user = NoderedUser.assign(users[0]);
                this.name = users[0].username;
            } else {
                const users: NoderedUser[] = await NoderedUtil.Query("users", { _id: this.userid }, null, null, 1, 0, null);
                if (users.length == 0) {
                    this.instancestatus = "Unknown id! " + this.userid;
                    this.errormessage = "Unknown id! " + this.userid;
                    if (!this.$scope.$$phase) { this.$scope.$apply(); }
                    return;
                }
                this.user = NoderedUser.assign(users[0]);
                this.name = users[0].username;
            }
            if (this.user.nodered != null && this.user.nodered.resources != null && this.user.nodered.resources.limits != null) {
                this.limitsmemory = this.user.nodered.resources.limits.memory;
            }
            if (this.user.nodered != null && (this.user.nodered as any).nodeselector != null) {
                // this.label = JSON.stringify((this.user.nodered as any).nodeselector);
                this.label = (this.user.nodered as any).nodeselector;
                this.labelkeys = Object.keys(this.label);

            }
            this.name = this.name.split("@").join("").split(".").join("");
            this.name = this.name.toLowerCase();
            // this.noderedurl = "https://" + WebSocketClientService.nodered_domain_schema.replace("$nodered_id$", this.name);
            this.noderedurl = "//" + WebSocketClientService.nodered_domain_schema.replace("$nodered_id$", this.name);
            console.log(this.noderedurl);
            // // this.GetNoderedInstance();
            this.GetNoderedInstance();
            this.labels = await NoderedUtil.GetKubeNodeLabels(null);
            if (this.labels != null) this.keys = Object.keys(this.labels);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }

        });
    }
    async save() {
        try {
            this.errormessage = "";
            if (this.limitsmemory != "") {
                if (this.user.nodered == null) this.user.nodered = new NoderedConfig();
                if (this.user.nodered.resources == null) this.user.nodered.resources = new Resources();
                if (this.user.nodered.resources.limits == null) this.user.nodered.resources.limits = new ResourceValues();
                if (this.user.nodered.resources.limits.memory != this.limitsmemory) {
                    this.user.nodered.resources.limits.memory = this.limitsmemory;
                }
            } else {
                if (this.user.nodered != null && this.user.nodered.resources != null && this.user.nodered.resources.limits != null) {
                    if (this.limitsmemory != this.user.nodered.resources.limits.memory) {
                        this.user.nodered.resources.limits.memory = this.limitsmemory;
                    }
                }
            }
            if (this.label) {
                const keys = Object.keys(this.label);
                if (keys.length == 0) this.label = null;
            }
            if (this.label) {
                if (this.user.nodered == null) this.user.nodered = new NoderedConfig();
                (this.user.nodered as any).nodeselector = this.label;
            } else {
                if (this.user.nodered == null) this.user.nodered = new NoderedConfig();
                delete (this.user.nodered as any).nodeselector;
            }
            this.loading = true;
            this.messages = 'Updating ' + this.user.name + "\n" + this.messages;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            await NoderedUtil.UpdateOne("users", null, this.user, 1, false, null);
            this.loading = false;
            this.messages = 'update complete\n' + this.messages;
            this.EnsureNoderedInstance();
        } catch (error) {
            this.errormessage = error;
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async GetNoderedInstance() {
        try {
            this.errormessage = "";
            this.instancestatus = "fetching status";

            this.instances = await NoderedUtil.GetNoderedInstance(this.userid, null);
            if (this.instances != null && this.instances.length > 0) {
                this.instance = this.instances[0];
            }

            console.debug("GetNoderedInstance:");
            if (this.instance !== null && this.instance !== undefined) {
                if (this.instance.metadata.deletionTimestamp !== undefined) {
                    this.instancestatus = "pending deletion (" + this.instance.status.phase + ")";
                } else {
                    this.instancestatus = this.instance.status.phase;
                }
            } else {
                this.instancestatus = "non existent";
                // this.messages = "GetNoderedInstance completed, status unknown/non existent" + "\n" + this.messages;
            }
            let reload: boolean = false;
            this.instances.forEach(instance => {
                if (this.instance.metadata.deletionTimestamp != null) reload = true;
                if (instance.status.phase == "deleting" || instance.status.phase == "Pending") reload = true;
                if (instance.metrics && instance.metrics.memory) {
                    console.log(instance.metrics.memory);
                    if (instance.metrics.memory.endsWith("Ki")) {
                        let memory: any = parseInt(instance.metrics.memory.replace("Ki", ""));
                        memory = Math.floor(memory / 1024) + "Mi";
                        console.log(memory);
                        instance.metrics.memory = memory;
                    }
                    if (instance.metrics.cpu.endsWith("n")) { // nanocores or nanoCPU
                        let cpu: any = parseInt(instance.metrics.cpu.replace("n", ""));
                        cpu = Math.floor(cpu / (1024 * 1024)) + "m";  // 1000m = 1 vcpu
                        console.log(cpu);
                        instance.metrics.cpu = cpu;
                    }
                }
            });

            this.messages = "GetNoderedInstance completed, status " + this.instancestatus + "\n" + this.messages;

            if (reload) {
                setTimeout(() => {
                    this.GetNoderedInstance();
                }, 2000);
            }
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            this.instancestatus = "";
            console.error(error);
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async GetNoderedInstanceLog(instancename: string) {
        try {
            this.errormessage = "";
            this.instancestatus = "fetching log";
            console.debug("GetNoderedInstanceLog:");
            this.instancelog = await NoderedUtil.GetNoderedInstanceLog(this.userid, instancename, null);
            this.instancelog = this.instancelog.split("\n").reverse().join("\n");
            this.messages = "GetNoderedInstanceLog completed\n" + this.messages;
            this.instancestatus = "";
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            this.instancestatus = "";
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async EnsureNoderedInstance() {
        try {
            this.errormessage = "";
            await NoderedUtil.EnsureNoderedInstance(this.userid, false, null);
            this.messages = "EnsureNoderedInstance completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DeleteNoderedInstance() {
        try {
            this.errormessage = "";
            await NoderedUtil.DeleteNoderedInstance(this.userid, null);
            this.messages = "DeleteNoderedInstance completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DeleteNoderedPod(instancename: string) {
        try {
            this.errormessage = "";
            await NoderedUtil.DeleteNoderedPod(this.userid, instancename, null);
            this.messages = "DeleteNoderedPod completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async RestartNoderedInstance() {
        try {
            this.errormessage = "";
            await NoderedUtil.RestartNoderedInstance(this.userid, null);
            this.messages = "RestartNoderedInstance completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async StartNoderedInstance() {
        try {
            this.errormessage = "";
            await NoderedUtil.StartNoderedInstance(this.userid, null);
            this.messages = "StartNoderedInstance completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async StopNoderedInstance() {
        try {
            this.errormessage = "";
            await NoderedUtil.StopNoderedInstance(this.userid, null);
            this.messages = "StopNoderedInstance completed" + "\n" + this.messages;
            this.GetNoderedInstance();
        } catch (error) {
            this.errormessage = error;
            this.messages = error + "\n" + this.messages;
            console.error(error);
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    addkey() {
        if (this.label == null) this.label = {};
        var _label: any[] = this.labels[this.newkey];
        this.label[this.newkey] = _label[0];
        if (this.newvalue != null) this.label[this.newkey] = this.newvalue;
        this.labelkeys = Object.keys(this.label);
    }
    removekey(key) {
        if (key == null) key = this.newkey;
        if (this.label == null) this.label = {};
        var _label: any[] = this.labels[key];
        delete this.label[key];
        this.labelkeys = Object.keys(this.label);
    }
    newkeyselected() {
        if (this.label == null || this.label[this.newkey] == null) this.newvalue = this.labels[this.newkey][0];
        if (this.label != null && this.label[this.newkey] != null) this.newvalue = this.label[this.newkey];
    }
}
export class hdrobotsCtrl extends entitiesCtrl<unattendedclient> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("RolesCtrl");
        this.basequery = { _type: "unattendedclient" };
        this.collection = "openrpa";
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async Enable(model: any): Promise<any> {
        this.loading = true;
        model.enabled = true;
        await NoderedUtil.UpdateOne(this.collection, null, model, 1, false, null);
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async Disable(model: any): Promise<any> {
        this.loading = true;
        model.enabled = false;
        await NoderedUtil.UpdateOne(this.collection, null, model, 1, false, null);
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class RobotsCtrl extends entitiesCtrl<unattendedclient> {
    public showall: boolean = false;
    public showinactive: boolean = false;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("RobotsCtrl");
        this.basequery = { _type: "user" };
        this.collection = "users";
        this.postloadData = this.processdata;
        this.preloadData = () => {
            const dt = new Date(new Date().toISOString());
            if (this.showinactive) {
                if (this.showall) {
                    this.basequery = { _heartbeat: { "$exists": true } };
                } else {
                    this.basequery = { _rpaheartbeat: { "$exists": true } };
                }
            } else if (this.showall) {
                dt.setMinutes(dt.getMinutes() - 1);
                this.basequery = { _heartbeat: { "$gte": dt } };
            } else {
                dt.setMinutes(dt.getMinutes() - 1);
                this.basequery = { _rpaheartbeat: { "$gte": dt } };
            }
        };
        if (this.userdata.data.RobotsCtrl) {
            this.basequery = this.userdata.data.RobotsCtrl.basequery;
            this.collection = this.userdata.data.RobotsCtrl.collection;
            this.baseprojection = this.userdata.data.RobotsCtrl.baseprojection;
            this.orderby = this.userdata.data.RobotsCtrl.orderby;
            this.searchstring = this.userdata.data.RobotsCtrl.searchstring;
            this.basequeryas = this.userdata.data.RobotsCtrl.basequeryas;
            this.showinactive = this.userdata.data.RobotsCtrl.showinactive;
            this.showall = this.userdata.data.RobotsCtrl.showall;
        }
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    processdata() {
        if (!this.userdata.data.RobotsCtrl) this.userdata.data.RobotsCtrl = {};
        this.userdata.data.RobotsCtrl.basequery = this.basequery;
        this.userdata.data.RobotsCtrl.collection = this.collection;
        this.userdata.data.RobotsCtrl.baseprojection = this.baseprojection;
        this.userdata.data.RobotsCtrl.orderby = this.orderby;
        this.userdata.data.RobotsCtrl.searchstring = this.searchstring;
        this.userdata.data.RobotsCtrl.basequeryas = this.basequeryas;
        this.userdata.data.RobotsCtrl.showinactive = this.showinactive;
        this.userdata.data.RobotsCtrl.showall = this.showall;

        for (let i = 0; i < this.models.length; i++) {
            const model: any = this.models[i];
            (model as any).hasnodered = false;
            if (model._noderedheartbeat != undefined && model._noderedheartbeat != null) {
                const dt = new Date(model._noderedheartbeat)
                const now: Date = new Date(),
                    secondsPast: number = (now.getTime() - dt.getTime()) / 1000;
                if (secondsPast < 60) (model as any).hasnodered = true;
            }
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    ShowWorkflows(model: any) {
        if (!this.userdata.data.RPAWorkflowsCtrl) this.userdata.data.RPAWorkflowsCtrl = {};
        this.userdata.data.RPAWorkflowsCtrl.basequeryas = model._id;
        this.userdata.data.basequeryas = model._id;
        this.$location.path("/RPAWorkflows");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
    OpenNodered(model: any) {
        let name = model.username;
        name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();
        const noderedurl = "https://" + this.WebSocketClientService.nodered_domain_schema.replace("$nodered_id$", name);
        window.open(noderedurl);
    }
    ManageNodered(model: any) {
        this.$location.path("/Nodered/" + model._id);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async Impersonate(model: TokenUser): Promise<any> {
        try {
            this.loading = true;
            await this.WebSocketClientService.impersonate(model._id);
            this.loadData();
        } catch (error) {
            this.errormessage = JSON.stringify(error);
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class AuditlogsCtrl extends entitiesCtrl<Role> {
    public model: Role;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = false;
        this.baseprojection = { name: 1, type: 1, _type: 1, impostorname: 1, clientagent: 1, clientversion: 1, _created: 1, success: 1, remoteip: 1 };
        this.searchfields = ["name", "impostorname", "clientagent", "type"];
        console.debug("AuditlogsCtrl");
        // this.basequery = { _type: "role" };
        this.collection = "audit";
        this.postloadData = this.processdata;
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    processdata() {
        for (let i = 0; i < this.models.length; i++) {
            const model: any = this.models[i];
            model.fa = "far fa-question-circle";
            model.fa2 = "";
            if (model.clientagent == 'openrpa') model.fa = 'fas fa-robot';
            if (model.clientagent == 'webapp') model.fa = 'fas fa-globe';
            if (model.clientagent == 'browser') model.fa = 'fas fa-globe';
            if (model.clientagent == 'mobileapp') model.fa = 'fas fa-mobile-alt';
            if (model.clientagent == 'nodered') model.fa = 'fab fa-node-js';
            if (model.clientagent == 'getUserFromRequest') model.fa = 'fab fa-node-js';
            if (model.clientagent == 'googleverify') model.fa = 'fab fa-google';
            if (model.clientagent == 'samlverify') model.fa = 'fab fa-windows';
            if (model.clientagent == 'aiotwebapp') model.fa = 'fas fa-globe';
            if (model.clientagent == 'aiotmobileapp') model.fa = 'fas fa-mobile-alt';
            if (model.clientagent == 'nodered-cli') model.fa = 'fab fa-node-js';
            if (model.clientagent == 'openflow-cli') model.fa = 'fab fa-node-js';

            if (model.impostorname != '' && model.impostorname != null) model.fa2 = 'fas fa-user-secret';
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }

    async ShowAudit(model: any): Promise<any> {
        this.model = null;
        const modal: any = $("#exampleModal");
        modal.modal();
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        const arr = await NoderedUtil.Query(this.collection, { _id: model._id }, null, null, 1, 0, null);
        if (arr.length == 1) {
            this.model = arr[0];
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class SignupCtrl extends entityCtrl<Base> {
    searchFilteredList: TokenUser[] = [];
    searchSelectedItem: TokenUser = null;
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
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("SignupCtrl");
        this.collection = $routeParams.collection;
        this.postloadData = this.processdata;
        WebSocketClientService.onConnected(async () => {
            if (this.id !== null && this.id !== undefined) {
                await this.loadData();
            } else {
                this.processdata();
            }
        });
    }
    processdata() {
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
declare const Stripe: any;
export class PaymentCtrl extends entityCtrl<Billing> {
    public messages: string = "";
    public cardmessage: string = "";
    public errormessage: string = "";
    public stripe: any = null;
    public stripe_customer: stripe_customer;
    public stripe_products: stripe_list<stripe_base>;
    public stripe_plans: stripe_list<stripe_plan>;
    public hastaxtext: string;
    public userid: string;

    public taxstatus: string = "";
    public taxaddress: string = "";
    public hascustomer: boolean = false;
    public allowopenflowsignup: boolean = false;
    public allowsupportsignup: boolean = false;
    public hastaxinfo: boolean = false;
    public openflowplan: stripe_plan;
    public supportplan: stripe_plan;
    public supporthoursplan: stripe_plan;
    public supportsubscription: stripe_subscription_item;
    public supporthourssubscription: stripe_subscription_item;

    public openflowplans: stripe_plan[] = [];
    public supportplans: stripe_plan[] = [];
    public supporthoursplans: stripe_plan[] = [];

    public nextbill: stripe_invoice;

    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("PaymentCtrl");
        //this.collection = $routeParams.collection;
        this.userid = $routeParams.userid;
        this.postloadData = this.processdata;
        this.collection = "users";

        WebSocketClientService.onSignedin(async (_user: TokenUser) => {
            if (this.userid == null || this.userid == "" || this.userid == "success" || this.userid == "cancel") {
                this.userid = _user._id;
            }

            this.basequery = { "userid": this.userid, "_type": "billing" };
            // this.basequery = { "userid": this.userid };
            this.stripe = Stripe(this.WebSocketClientService.stripe_api_key);

            this.loadData();
        });
    }
    async processdata() {
        try {

            this.taxstatus = "";
            this.hascustomer = false;
            this.allowopenflowsignup = false;
            this.allowsupportsignup = false;
            this.hastaxinfo = false;

            this.messages = "";
            this.cardmessage = "";
            this.errormessage = "";
            this.stripe = null;
            this.stripe_products = null;
            this.stripe_plans = null;
            this.hastaxtext = "vat included";

            this.taxstatus = "";
            this.taxaddress = "";
            this.hascustomer = false;
            this.allowopenflowsignup = false;
            this.allowsupportsignup = false;
            this.hastaxinfo = false;
            this.openflowplan = null;
            this.supportplan = null;
            this.supporthoursplan = null;
            this.supportsubscription = null;
            this.supporthourssubscription = null;

            this.cardmessage = "";
            if (this.model == null) {
                this.model = new Billing(this.WebSocketClientService.user._id);
                this.model.name = this.WebSocketClientService.user.name;
                if (this.WebSocketClientService.user.username.indexOf("@") > -1) {
                    this.model.email = this.WebSocketClientService.user.username;
                }
                this.model.tax = 1.0;
                this.hastaxtext = "excl vat";
            } else {
                if (this.model != null && this.model.stripeid != null && this.model.stripeid != "") {
                    const payload: stripe_customer = new stripe_customer;
                    this.stripe_customer = await NoderedUtil.EnsureStripeCustomer(this.model, this.userid, null);
                    this.hascustomer = (this.stripe_customer != null);
                    if (this.model.tax != 1) {
                        this.hastaxtext = "vat included";
                    } else {
                        this.hastaxtext = "excl vat";
                    }
                }
            }
            if (this.stripe_customer && this.stripe_customer) {
                if (this.stripe_customer.tax_ids.total_count > 0) {
                    this.hastaxinfo = true;
                    this.taxstatus = this.stripe_customer.tax_ids.data[0].verification.status;
                    this.taxaddress = this.stripe_customer.tax_ids.data[0].verification.verified_address;
                    if (this.stripe_customer.tax_ids.data[0].verification.status == 'verified' || this.stripe_customer.tax_ids.data[0].verification.status == 'unavailable') {
                        if (this.stripe_customer.tax_ids.data[0].verification.status == 'verified') {
                            this.model.name = this.stripe_customer.tax_ids.data[0].verification.verified_name;
                            this.model.address = this.stripe_customer.tax_ids.data[0].verification.verified_address;
                        }
                        this.allowopenflowsignup = true;
                        this.allowsupportsignup = true;
                    }
                    if (this.stripe_customer.tax_ids.data[0].verification.status == "unavailable") {
                        this.allowopenflowsignup = true;
                        this.allowsupportsignup = true;
                    }
                } else {
                    this.allowopenflowsignup = true;
                    this.allowsupportsignup = true;
                }
            }
            //if (this.allowopenflowsignup || this.allowsupportsignup) {
            this.model.taxrate = "";
            if (this.openflowplans.length == 0 && this.supportplans.length == 0) {
                this.stripe_plans = (await NoderedUtil.Stripe("GET", "plans", null, null, null, null) as any);
                for (let x = 0; x < this.stripe_plans.data.length; x++) {
                    const stripeplan = this.stripe_plans.data[x];
                    if ((stripeplan as any).active == true) {
                        if (stripeplan.metadata.openflowuser == "true") {
                            this.openflowplans.push(stripeplan);
                        }
                        if (stripeplan.metadata.supportplan == "true") {
                            this.supportplans.push(stripeplan);
                        }
                    }
                }
                for (let y = 0; y < this.supportplans.length; y++) {
                    const supportplan = this.supportplans[y];
                    for (let x = 0; x < this.stripe_plans.data.length; x++) {
                        const stripeplan = this.stripe_plans.data[x];
                        if (stripeplan.id == supportplan.metadata.subplan) {
                            this.supporthoursplans.push(stripeplan);
                            (supportplan as any).subplan = stripeplan;
                        }
                    }

                }
            }
            //}
            if (this.hascustomer) {
                const hasOpenflow = this.openflowplans.filter(plan => {
                    const hasit = this.stripe_customer.subscriptions.data.filter(s => {
                        const arr = s.items.data.filter(y => y.plan.id == plan.id);
                        if (arr.length == 1) {
                            if (arr[0].quantity > 0) {
                                // this.openflowplan = arr[0];
                                return true;
                            }
                        }
                        return false;
                    });
                    if (hasit.length > 0) return true;
                    return false;
                    // const hasit = this.stripe_customer.subscriptions.data.filter(s => s.items.data.filter(y => y.plan.id == plan.id).length > 0);
                    // if (hasit.length > 0) return true;
                    // return false;
                });
                if (hasOpenflow.length > 0) {
                    this.allowopenflowsignup = false;
                    this.openflowplan = hasOpenflow[0];
                }
                const hasSupport = this.supportplans.filter(plan => {
                    const hasit = this.stripe_customer.subscriptions.data.filter(s => {
                        const arr = s.items.data.filter(y => y.plan.id == plan.id);
                        if (arr.length == 1) {
                            if (arr[0].quantity > 0) {
                                this.supportsubscription = arr[0];
                                return true;
                            }
                        }
                        return false;
                    });
                    if (hasit.length > 0) return true;
                    return false;
                });
                if (hasSupport.length > 0) {
                    this.allowsupportsignup = false;
                    this.supportplan = hasSupport[0];
                }
                const hasSupportHours = this.supporthoursplans.filter(plan => {
                    const hasit = this.stripe_customer.subscriptions.data.filter(s => {
                        const arr = s.items.data.filter(y => y.plan.id == plan.id);
                        if (arr.length == 1) {
                            //if (arr[0].quantity > 0) {
                            this.supporthourssubscription = arr[0];
                            return true;
                            //}
                        }
                        return false;
                    });
                    if (hasit.length > 0) return true;
                    return false;
                });
                if (hasSupportHours.length > 0) {
                    this.allowsupportsignup = false;
                    this.supporthoursplan = hasSupportHours[0];
                } else if (this.supportplan != null) {
                    this.supporthoursplan = (this.supportplan as any).subplan;
                    const subscriptions = this.stripe_customer.subscriptions.data.filter(s => {
                        const arr = s.items.data.filter(y => y.plan.id == this.supportplan.id);
                        return arr.length > 0;
                    });
                    const subscription = subscriptions[0];
                    // (payload as any) = { subscription: subscription.id, plan: this.supporthoursplan.id, quantity: 1 };
                    // const payload:any = { subscription: subscription.id, plan: this.supporthoursplan.id };
                    // await NoderedUtil.Stripe("POST", "subscription_items", null, null, payload);
                    const result = await NoderedUtil.StripeAddPlan(this.userid, this.supporthoursplan.id, null, null);
                    // this.loadData();
                }
            }


            if (this.stripe_customer && this.stripe_customer) {
                try {
                    this.nextbill = (await NoderedUtil.Stripe<stripe_invoice>("GET", "invoices_upcoming", this.stripe_customer.id, null, null, null) as any);
                    this.nextbill.dtperiod_start = new Date(this.nextbill.period_start * 1000);
                    this.nextbill.dtperiod_end = new Date(this.nextbill.period_end * 1000);
                } catch (error) {
                    console.error(error);
                }
            }
            // Sort by price
            this.openflowplans = this.openflowplans.sort((a, b) => a.amount - b.amount);
            this.supportplans = this.supportplans.sort((a, b) => a.amount - b.amount);

        } catch (error) {
            console.error(error);
            this.cardmessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async Save() {
        try {
            let customer: stripe_customer = null;

            if (customer == null && this.model.name != null) {
                customer = await NoderedUtil.EnsureStripeCustomer(this.model, this.userid, null);
            }

            this.loadData();
        } catch (error) {
            console.error(error);
            this.cardmessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async CancelPlan(planid: string) {
        try {
            const result = await NoderedUtil.StripeCancelPlan(this.userid, planid, null);
            this.loadData();
        } catch (error) {
            console.error(error);
            this.cardmessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
    async AddHours(plan: string) {
        try {
            if (this.supporthourssubscription == null) return;
            const hours: number = parseInt(window.prompt("Number of hours", "1"));
            if (hours > 0) {
                const dt = parseInt((new Date().getTime() / 1000).toFixed(0))
                const payload: any = { "quantity": hours, "timestamp": dt };
                const res = await NoderedUtil.Stripe("POST", "usage_records", null, this.supporthourssubscription.id, payload, null);
            }
            this.loadData();
        } catch (error) {
            console.error(error);
            this.cardmessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async CheckOut(planid: string, subplanid: string) {
        try {
            const result = await NoderedUtil.StripeAddPlan(this.userid, planid, subplanid, null);
            if (result.checkout) {
                const stripe = Stripe(this.WebSocketClientService.stripe_api_key);
                stripe
                    .redirectToCheckout({
                        sessionId: result.checkout.id,
                    })
                    .then(function (event) {
                        if (event.complete) {
                            // enable payment button
                        } else if (event.error) {
                            console.error(event.error);
                            if (event.error && event.error.message) {
                                this.cardmessage = event.error.message;
                            } else {
                                this.cardmessage = event.error;
                            }
                            console.error(event.error);

                            // show validation to customer
                        } else {
                        }
                    }).catch((error) => {
                        console.error(error);
                        this.cardmessage = error;
                    });
            } else {
                this.loadData();
            }
        } catch (error) {
            console.error(error);
            this.cardmessage = error;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }

    }
}
export class QueuesCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.collection = "configclients";
        this.basequery = { _type: "queue" };
        console.debug("QueuesCtrl");
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async DumpRabbitmq() {
        try {
            this.loading = true;
            let m: Message = new Message();
            m.command = "dumprabbitmq"; m.data = "{}";
            const q = await WebSocketClient.instance.Send<any>(m);
            if ((q as any).command == "error") throw new Error(q.data);
        } catch (error) {
            console.error(error);
        }
        this.loading = false;
        this.loadData();
    }
}
export class QueueCtrl extends entityCtrl<Base> {
    public newid: string;
    public memberof: Role[];
    public data: any;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("QueueCtrl");
        this.collection = "configclients";
        this.postloadData = this.processdata;
        this.memberof = [];
        WebSocketClientService.onSignedin((user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                this.loadData();
            } else {
                this.model = new Base();
                this.model._type = "queue";
                this.model.name = "";
                this.processdata();
            }

        });
    }
    async processdata() {
        try {
            if (this.model == null) {
                this.errormessage = "Not found!";
                this.loading = false;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
            this.loading = true;
            let m: Message = new Message();
            m.command = "getrabbitmqqueue"; m.data = "{\"name\": \"" + (this.model as any).queuename + "\"}";
            const q = await WebSocketClient.instance.Send<any>(m);
            if ((q as any).command == "error") throw new Error(q.data);
            this.data = q.data;
            if (this.data == null) {
                this.errormessage = "Queue not found!";
                this.loading = false;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
            if (this.data.consumer_details == null || this.data.consumer_details.length == 0) {
                this.errormessage = "Queue has no consumers!";
                this.loading = false;
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
            this.collection = "configclients";
            this.basequery = { _type: "socketclient" };
            const clients = await NoderedUtil.Query("configclients", { _type: "socketclient" }, null, null, 2000, 0, null, null);
            for (let i = 0; i < this.data.consumer_details.length; i++) {
                console.log("find " + this.data.consumer_details[i].consumer_tag);

                for (let y = 0; y < clients.length; y++) {
                    const _client = clients[y];
                    if (_client.queues != null) {
                        // const keys = Object.keys(_client.queues);
                        // for (let z = 0; z < keys.length; z++) {
                        //     const q = _client.queues[keys[z]];
                        //     console.log(_client.name + " " + q.consumerTag);
                        //     if (q.consumerTag == this.data.consumer_details[i].consumer_tag) {
                        //         this.data.consumer_details[i].clientname = _client.name;
                        //     }
                        // }
                        for (let z = 0; z < _client.queues.length; z++) {
                            const q = _client.queues[z];
                            console.log(_client.name + " " + q.consumerTag);
                            if (q.consumerTag == this.data.consumer_details[i].consumer_tag) {
                                this.data.consumer_details[i].clientname = _client.name;
                            }
                        }
                    }

                }

            }
        } catch (error) {
            console.error(error);
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DeleteQueue(model) {
        try {
            this.loading = true;
            let m: Message = new Message();
            m.command = "deleterabbitmqqueue"; m.data = "{\"name\": \"" + (this.model as any).queuename + "\"}";
            const q = await WebSocketClient.instance.Send<any>(m);
            if ((q as any).command == "error") throw new Error(q.data);
            this.data = q.data;
            this.$location.path("/Queues");
        } catch (error) {
            this.errormessage = error;
            console.error(error);
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }

}
export class SocketsCtrl extends entitiesCtrl<Base> {
    public message: string = "";
    public charts: chartset[] = [];
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.collection = "configclients";
        this.basequery = { _type: "socketclient" };
        console.debug("SocketsCtrl");
        this.postloadData = this.processdata;
        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    processdata() {
        for (let i = 0; i < this.models.length; i++) {
            const model: any = this.models[i];
            model.keys = Object.keys(model.queues);
            model.queuescount = model.keys.length;
        }
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DumpClients() {
        try {
            this.loading = true;
            let m: Message = new Message();
            m.command = "dumpclients"; m.data = "{}";
            const q = await WebSocketClient.instance.Send<any>(m);
            if ((q as any).command == "error") throw new Error(q.data);
        } catch (error) {
            console.error(error);
        }
        this.loading = false;
        this.loadData();
    }
}
export class CredentialsCtrl extends entitiesCtrl<Base> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("CredentialsCtrl");
        this.basequery = { _type: "credential" };
        this.collection = "openrpa";
        this.searchfields = ["name", "username"];
        this.postloadData = this.processData;
        if (this.userdata.data.CredentialsCtrl) {
            this.basequery = this.userdata.data.CredentialsCtrl.basequery;
            this.collection = this.userdata.data.CredentialsCtrl.collection;
            this.baseprojection = this.userdata.data.CredentialsCtrl.baseprojection;
            this.orderby = this.userdata.data.CredentialsCtrl.orderby;
            this.searchstring = this.userdata.data.CredentialsCtrl.searchstring;
            this.basequeryas = this.userdata.data.CredentialsCtrl.basequeryas;
        }

        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async processData(): Promise<void> {
        if (!this.userdata.data.CredentialsCtrl) this.userdata.data.CredentialsCtrl = {};
        this.userdata.data.CredentialsCtrl.basequery = this.basequery;
        this.userdata.data.CredentialsCtrl.collection = this.collection;
        this.userdata.data.CredentialsCtrl.baseprojection = this.baseprojection;
        this.userdata.data.CredentialsCtrl.orderby = this.orderby;
        this.userdata.data.CredentialsCtrl.searchstring = this.searchstring;
        this.userdata.data.CredentialsCtrl.basequeryas = this.basequeryas;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    async DeleteOneUser(model: TokenUser): Promise<any> {
        this.loading = true;
        await NoderedUtil.DeleteOne(this.collection, model._id, null);
        this.models = this.models.filter(function (m: any): boolean { return m._id !== model._id; });
        this.loading = false;
        let name = model.username;
        name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();

        const list = await NoderedUtil.Query("users", { _type: "role", name: name + "noderedadmins" }, null, null, 2, 0, null);
        if (list.length == 1) {
            console.debug("Deleting " + name + "noderedadmins")
            await NoderedUtil.DeleteOne("users", list[0]._id, null);
        }

        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class CredentialCtrl extends entityCtrl<Base> {
    searchFilteredList: TokenUser[] = [];
    searchSelectedItem: TokenUser = null;
    searchtext: string = "";
    e: any = null;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("CredentialCtrl");
        this.collection = "openrpa";
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                await this.loadData();
            } else {
                this.model = new Base();
                this.model._type = "credential";
                this.model._encrypt = ["password"];
                this.searchSelectedItem = WebSocketClientService.user;
                this.adduser();
            }
        });
    }
    async submit(): Promise<void> {
        if (this.model._id) {
            await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        } else {
            await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
        }
        this.$location.path("/Credentials");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }




    removeuser(_id) {
        if (this.collection == "files") {
            for (let i = 0; i < (this.model as any).metadata._acl.length; i++) {
                if ((this.model as any).metadata._acl[i]._id == _id) {
                    (this.model as any).metadata._acl.splice(i, 1);
                }
            }
        } else {
            for (let i = 0; i < this.model._acl.length; i++) {
                if (this.model._acl[i]._id == _id) {
                    this.model._acl.splice(i, 1);
                    //this.model._acl = this.model._acl.splice(index, 1);
                }
            }
        }

    }
    adduser() {
        const ace = new Ace();
        ace.deny = false;
        ace._id = this.searchSelectedItem._id;
        ace.name = this.searchSelectedItem.name;
        // ace.rights = "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";
        if (this.WebSocketClientService.user._id != ace._id) {
            ace.rights = this.unsetBit(ace.rights, 1);
            ace.rights = this.setBit(ace.rights, 2);
            ace.rights = this.unsetBit(ace.rights, 3);
            ace.rights = this.unsetBit(ace.rights, 4);
            ace.rights = this.unsetBit(ace.rights, 5);
        }

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
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        const currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        return (currentValue & mask) != 0;
    }
    setBit(base64: string, bit: number) {
        bit--;
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        const currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        const newValue = currentValue | mask;
        view[octet] = newValue;
        return this._arrayBufferToBase64(view);
    }
    unsetBit(base64: string, bit: number) {
        bit--;
        const buf = this._base64ToArrayBuffer(base64);
        const view = new Uint8Array(buf);
        const octet = Math.floor(bit / 8);
        let currentValue = view[octet];
        const _bit = (bit % 8);
        const mask = Math.pow(2, _bit);
        const newValue = currentValue &= ~mask;
        view[octet] = newValue;
        return this._arrayBufferToBase64(view);
    }
    toogleBit(a: any, bit: number) {
        if (this.isBitSet(a.rights, bit)) {
            a.rights = this.unsetBit(a.rights, bit);
        } else {
            a.rights = this.setBit(a.rights, bit);
        }
        const buf2 = this._base64ToArrayBuffer(a.rights);
        const view2 = new Uint8Array(buf2);
    }
    _base64ToArrayBuffer(string_base64): ArrayBuffer {
        const binary_string = window.atob(string_base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            //const ascii = string_base64.charCodeAt(i);
            const ascii = binary_string.charCodeAt(i);
            bytes[i] = ascii;
        }
        return bytes.buffer;
    }
    _arrayBufferToBase64(array_buffer): string {
        let binary = '';
        const bytes = new Uint8Array(array_buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
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
            let idx: number = -1;
            for (let i = 0; i < this.searchFilteredList.length; i++) {
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
                console.debug("idx: " + idx);
                // this.searchtext = this.searchFilteredList[idx].name;
                this.searchSelectedItem = this.searchFilteredList[idx];
                return;
            }
            else if (this.e.keyCode == 40) { // down
                if (idx >= this.searchFilteredList.length) {
                    idx = this.searchFilteredList.length - 1;
                } else { idx++; }
                console.debug("idx: " + idx);
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
                // console.debug(this.e.keyCode);
            }
        } else {
            if (this.e.keyCode == 13 && this.searchSelectedItem != null) {
                this.adduser();
            }
        }
    }
    async handlefilter(e) {
        this.e = e;
        // console.debug(e.keyCode);
        let ids: string[];
        if (this.collection == "files") {
            ids = (this.model as any).metadata._acl.map(item => item._id);
        } else {
            ids = this.model._acl.map(item => item._id);
        }
        this.searchFilteredList = await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: this.searchtext }
                ]
            }
            , null, { _type: -1, name: 1 }, 2, 0, null);

        this.searchFilteredList = this.searchFilteredList.concat(await NoderedUtil.Query("users",
            {
                $and: [
                    { $or: [{ _type: "user" }, { _type: "role" }] },
                    { name: new RegExp([this.searchtext].join(""), "i") },
                    { _id: { $nin: ids } }
                ]
            }
            , null, { _type: -1, name: 1 }, 5, 0, null));

        // this.searchFilteredList = await NoderedUtil.Query("users",
        //     {
        //         $and: [
        //             { $or: [{ _type: "user" }, { _type: "role" }] },
        //             { name: new RegExp([this.searchtext].join(""), "i") },
        //             { _id: { $nin: ids } }
        //         ]
        //     }
        //     , null, { _type: -1, name: 1 }, 5, 0, null);
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


export class OAuthClientsCtrl extends entitiesCtrl<Base> {
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        this.autorefresh = true;
        console.debug("OAuthClientsCtrl");
        this.basequery = { _type: "oauthclient" };
        this.collection = "config";
        this.searchfields = ["name", "username"];
        this.postloadData = this.processData;
        if (this.userdata.data.OAuthClientsCtrl) {
            this.basequery = this.userdata.data.OAuthClientsCtrl.basequery;
            this.collection = this.userdata.data.OAuthClientsCtrl.collection;
            this.baseprojection = this.userdata.data.OAuthClientsCtrl.baseprojection;
            this.orderby = this.userdata.data.OAuthClientsCtrl.orderby;
            this.searchstring = this.userdata.data.OAuthClientsCtrl.searchstring;
            this.basequeryas = this.userdata.data.OAuthClientsCtrl.basequeryas;
        }

        WebSocketClientService.onSignedin((user: TokenUser) => {
            this.loadData();
        });
    }
    async processData(): Promise<void> {
        if (!this.userdata.data.OAuthClientsCtrl) this.userdata.data.OAuthClientsCtrl = {};
        this.userdata.data.OAuthClientsCtrl.basequery = this.basequery;
        this.userdata.data.OAuthClientsCtrl.collection = this.collection;
        this.userdata.data.OAuthClientsCtrl.baseprojection = this.baseprojection;
        this.userdata.data.OAuthClientsCtrl.orderby = this.orderby;
        this.userdata.data.OAuthClientsCtrl.searchstring = this.searchstring;
        this.userdata.data.OAuthClientsCtrl.basequeryas = this.basequeryas;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
}
export class OAuthClientCtrl extends entityCtrl<Base> {
    searchFilteredList: TokenUser[] = [];
    searchSelectedItem: TokenUser = null;
    searchtext: string = "";
    e: any = null;
    public rolemappings: any;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api);
        console.debug("OAuthClientCtrl");
        this.collection = "config";
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            if (this.id !== null && this.id !== undefined) {
                await this.loadData();
            } else {
                this.model = new Base();
                this.model._type = "oauthclient";
                this.model._encrypt = ["clientSecret"];
                (this.model as any).clientId = "application";
                (this.model as any).clientSecret = 'secret';
                (this.model as any).grants = ['password', 'refresh_token', 'authorization_code'];
                (this.model as any).redirectUris = [];
                (this.model as any).defaultrole = "Viewer";
                (this.model as any).rolemappings = { "admins": "Admin", "grafana editors": "Editor", "grafana admins": "Admin" };
            }
        });
    }
    async submit(): Promise<void> {
        this.model["id"] = this.model["clientId"];
        if (this.model.name == null || this.model.name == "") this.model.name = this.model["id"];
        if (this.model._id) {
            await NoderedUtil.UpdateOne(this.collection, null, this.model, 1, false, null);
        } else {
            await NoderedUtil.InsertOne(this.collection, this.model, 1, false, null);
        }
        this.$location.path("/OAuthClients");
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    deletefromarray(name: string, id: string) {
        if (id == null || id == "") return false;
        console.log(id);
        this.model[name] = this.model[name].filter(x => x != id);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        return true;
    }
    addtoarray(name: string, id: string) {
        if (id == null || id == "") return false;
        console.log(id);
        if (!Array.isArray(this.model[name])) this.model[name] = [];
        this.model[name] = this.model[name].filter(x => x != id);
        this.model[name].push(id);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        return true;
    }
    addrolemapping(name: string, value: string) {
        if (name == null || name == "") return false;
        if (value == null || value == "") return false;
        console.log(name, value);
        if (!this.model["rolemappings"]) this.model["rolemappings"] = {};
        this.model["rolemappings"][name] = value;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    deleterolemapping(name) {
        console.log(name);
        if (name == null || name == "") return false;
        if (!this.model["rolemappings"]) this.model["rolemappings"] = {};
        delete this.model["rolemappings"][name];
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    CopySecret(field) {
        /* Get the text field */
        var copyText = document.querySelector(field);
        copyText.type = "text";
        // var copythis = copyText.value;
        // copyText = document.getElementById('just_for_copy');
        // copyText.value = copythis;

        /* Select the text field */
        copyText.select();
        copyText.setSelectionRange(0, 99999); /*For mobile devices*/

        /* Copy the text inside the text field */
        document.execCommand("copy");
        /* Alert the copied text */
        // alert("Copied the text: " + copyText.value);
        console.log("Copied the text: " + copyText.value);
        copyText.type = "password";
    }

}

export class DuplicatesCtrl extends entitiesCtrl<Base> {
    public collections: any;
    public model: Base;
    public uniqeness: string;
    constructor(
        public $scope: ng.IScope,
        public $location: ng.ILocationService,
        public $routeParams: ng.route.IRouteParamsService,
        public $interval: ng.IIntervalService,
        public WebSocketClientService: WebSocketClientService,
        public api: api,
        public userdata: userdata
    ) {
        super($scope, $location, $routeParams, $interval, WebSocketClientService, api, userdata);
        console.debug("DuplicatesCtrl");
        this.autorefresh = true;
        this.basequery = {};
        this.collection = $routeParams.collection;
        // this.baseprojection = { _type: 1, type: 1, name: 1, _created: 1, _createdby: 1, _modified: 1 };
        this.pagesize = 1;
        this.postloadData = this.processdata;
        const checkList = document.getElementById('list1');
        (checkList.getElementsByClassName('anchor')[0] as any).onclick = function (evt) {
            if (checkList.classList.contains('visible'))
                checkList.classList.remove('visible');
            else
                checkList.classList.add('visible');
        }
        if (this.userdata.data.DuplicatesCtrl) {
            this.basequery = this.userdata.data.DuplicatesCtrl.basequery;
            this.uniqeness = this.userdata.data.DuplicatesCtrl.uniqeness;
            this.baseprojection = this.userdata.data.DuplicatesCtrl.baseprojection;
            this.orderby = this.userdata.data.DuplicatesCtrl.orderby;
            this.searchstring = this.userdata.data.DuplicatesCtrl.searchstring;
            this.basequeryas = this.userdata.data.DuplicatesCtrl.basequeryas;
        } else {
            if (NoderedUtil.IsNullEmpty(this.collection)) {
                console.log("1 redir to /Duplicates/entities");
                this.$location.path("/Duplicates/entities");
                if (!this.$scope.$$phase) { this.$scope.$apply(); }
                return;
            }
        }
        if (NoderedUtil.IsNullEmpty(this.collection)) {
            console.log("2 redir to /Duplicates/entities");
            this.$location.path("/Duplicates/entities");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            return;
        } else if (this.$location.path() != "/Duplicates/" + this.collection) {
            console.log("3 redir from / to");
            console.log(this.$location.path());
            console.log("/Duplicates/" + this.collection);
            this.$location.path("/Duplicates/" + this.collection);
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
            return;
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        WebSocketClientService.onSignedin(async (user: TokenUser) => {
            this.loadData();
        });
    }
    public keys: string[] = [];
    async processdata() {
        if (this.models.length > 0) {
            this.keys = Object.keys(this.models[0]);
            for (let i: number = this.keys.length - 1; i >= 0; i--) {
                if (this.keys[i].startsWith('_') && this.keys[i] != "_type") this.keys.splice(i, 1);
            }
            this.keys.sort();
            this.keys.reverse();
        } else { this.keys = []; }
        if (!NoderedUtil.IsNullEmpty(this.uniqeness)) {
            const pipe: any[] = [];
            const arr = this.uniqeness.split(",");
            const group: any = { _id: {}, count: { "$sum": 1 } };
            //if ("111".toLowerCase() == "22") {
            group.items = {
                $push: { "_id": '$$ROOT._id', "name": '$$ROOT.name' }
            }
            //}
            arr.forEach(field => {
                if (field.trim() !== "") {
                    group._id[field] = "$" + field;
                }
            });
            pipe.push({ "$group": group });
            pipe.push({ "$match": { "count": { "$gte": 2 } } });
            pipe.push({ "$limit": 100 });
            pipe.push({ "$sort": this.orderby })
            try {
                this.models = await NoderedUtil.Aggregate(this.collection, pipe, null);
                console.log(this.models);
            } catch (error) {
                console.log(pipe);
                this.errormessage = JSON.stringify(error);
            }
        }

        if (!this.userdata.data.DuplicatesCtrl) this.userdata.data.DuplicatesCtrl = {};
        this.userdata.data.DuplicatesCtrl.basequery = this.basequery;
        this.userdata.data.DuplicatesCtrl.uniqeness = this.uniqeness;
        this.userdata.data.DuplicatesCtrl.baseprojection = this.baseprojection;
        this.userdata.data.DuplicatesCtrl.orderby = this.orderby;
        this.userdata.data.DuplicatesCtrl.searchstring = this.searchstring;
        this.userdata.data.DuplicatesCtrl.basequeryas = this.basequeryas;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }
    ToggleUniqeness(model) {
        let arr = [];
        if (this.uniqeness != null && this.uniqeness != "") arr = this.uniqeness.split(',');
        const index = arr.indexOf(model);
        if (index > -1) {
            arr.splice(index, 1);
            this.uniqeness = arr.join(',');
        } else {
            arr.push(model);
            this.uniqeness = arr.join(',');
        }
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        this.loadData();
    }
    async ShowData(model) {
        const modal: any = $("#exampleModal");
        modal.modal();
        this.model = model;
    }
    async CloseModal() {
        const modal: any = $("#exampleModal");
        modal.modal('hide');
    }
    OpenEntity(model) {
        const modal: any = $("#exampleModal");
        modal.modal('hide');
        this.$location.path("/Entity/" + this.collection + "/" + model._id);
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        return;

    }
    async MassDeleteOnlyOne() {
        this.loading = true;
        for (let x = 0; x < this.models.length; x++) {
            const item = (this.models[x] as any);
            console.log("deleting ", item.items[0]);
            await NoderedUtil.DeleteOne(this.collection, item.items[0]._id, null);
        }
        this.loading = false;
        this.loadData();
    }
    async MassDeleteAllButOne() {
        this.loading = true;
        for (let x = 0; x < this.models.length; x++) {
            const item = (this.models[x] as any);
            for (let y = 1; y < item.items.length; y++) {
                console.log("deleting ", item.items[y]);
                await NoderedUtil.DeleteOne(this.collection, item.items[y]._id, null);
            }
        }
        this.loading = false;
        this.loadData();
    }
    async MassDeleteAll() {
        this.loading = true;
        for (let x = 0; x < this.models.length; x++) {
            const item = (this.models[x] as any);
            for (let y = 0; y < item.items.length; y++) {
                console.log("deleting ", item.items[y]);
                await NoderedUtil.DeleteOne(this.collection, item.items[y]._id, null);
            }
        }
        this.loading = false;
        this.loadData();
    }
    async DeleteOnlyOne(model) {
        if (NoderedUtil.IsNullUndefinded(model)) return;
        if (NoderedUtil.IsNullUndefinded(model.items)) return;
        if (model.items.length < 2) return;
        this.loading = true;
        console.log("deleting ", model.items[0]);
        await NoderedUtil.DeleteOne(this.collection, model.items[0]._id, null);
        this.loading = false;
        this.loadData();
    }
    async DeleteAllButOne(model) {
        if (NoderedUtil.IsNullUndefinded(model)) return;
        if (NoderedUtil.IsNullUndefinded(model.items)) return;
        this.loading = true;
        for (let i = 1; i < model.items.length; i++) {
            console.log("deleting ", model.items[i]);
            await NoderedUtil.DeleteOne(this.collection, model.items[i]._id, null);
        }
        this.loading = false;
        this.loadData();
    }
    async DeleteAll(model) {
        if (NoderedUtil.IsNullUndefinded(model)) return;
        if (NoderedUtil.IsNullUndefinded(model.items)) return;
        this.loading = true;
        for (let i = 0; i < model.items.length; i++) {
            console.log("deleting ", model.items[i]);
            await NoderedUtil.DeleteOne(this.collection, model.items[i]._id, null);
        }
        this.loading = false;
        this.loadData();
    }
    async ModalDeleteOne(model) {
        this.loading = true;
        await NoderedUtil.DeleteOne(this.collection, model._id, null);
        let arr: any[] = (this.model as any).items;
        arr = arr.filter(x => x._id != model._id);
        (this.model as any).items = arr;
        this.loading = false;
        if (!this.$scope.$$phase) { this.$scope.$apply(); }
        this.loadData();
    }
}