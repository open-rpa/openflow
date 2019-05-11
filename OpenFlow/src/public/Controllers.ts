module openflow {
    "use strict";

    
    export class MainCtrl extends entitiesCtrl {
        public loading:boolean = false;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api,
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            console.log("MainCtrl::constructor");
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }

        async InsertNew():Promise<void> {
            // this.loading = true;
            var model = {name: "Find me " + Math.random().toString(36).substr(2, 9), "temp": "hi mom"};
            var result = await this.api.Insert(this.collection, model);
            this.models.push(result);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async UpdateOne(model: any):Promise<any> {
            var index = this.models.indexOf(model);
            this.loading = true;
            model.name = "Find me " + Math.random().toString(36).substr(2, 9);
            var newmodel = await this.api.Update(this.collection, model);
            this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            this.models.splice(index, 0, newmodel);
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteOne(model: any):Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async InsertMany():Promise<void> {
            this.loading = true;
            var Promises:Promise<InsertOneMessage>[] = [];
            var q: InsertOneMessage = new InsertOneMessage();
            for(var i:number=(this.models.length); i < (this.models.length + 50); i++) {
                q.collectionname = "entities"; q.item = {name: "findme " + i.toString(), "temp": "hi mom"};
                var msg:Message  = new Message(); msg.command = "insertone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            }
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values:InsertOneMessage[] = results.filter(result => !(result instanceof Error));
            // this.models.push(...values);
            values.forEach(element => {
                this.models.push(element.result);
            });
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async DeleteMany():Promise<void> {
            this.loading = true;
            var Promises:Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = "entities"; q._id = (model as any)._id;
                var msg:Message  = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values:DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids:string[] = [];
            values.forEach((x:DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any):boolean { return ids.indexOf(m._id)===-1;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class LoginCtrl {
        public localenabled:boolean = false;
        public providers:any = false;
        public username:string = "";
        public password:string = "";
        public message:string = "";
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
            console.log("LoginCtrl::constructor");
            WebSocketClient.getJSON("/loginproviders", async (error:any, data:any) => {
                this.providers = data;
                for(var i:number=this.providers.length -1; i >= 0; i--) {
                    if(this.providers[i].provider=="local") {
                        this.providers.splice(i,1);
                        this.localenabled = true;
                    }
                }

                if (!this.$scope.$$phase) { this.$scope.$apply(); }
            });
        }
        async submit():Promise<void> {
            this.message = "";
            var q:SigninMessage = new SigninMessage();
            q.username = this.username; q.password = this.password;
            var msg:Message  = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
            try {
                var a:any = await this.WebSocketClient.Send(msg);
                var result:SigninMessage = a;
                if(result.user==null) { return; }
                this.$scope.$root.$broadcast(msg.command, result);
                this.WebSocketClient.user = result.user;
                this.$location.path("/");
            } catch (error) {
                this.message = error;
                console.error(error);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class MenuCtrl {
        public user:TokenUser;
        public signedin:boolean = false;
        public path:string = "";
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
            console.log("MenuCtrl::constructor");
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
    }

    export class ProvidersCtrl extends entitiesCtrl {
        public loading:boolean = false;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.basequery = {_type: "provider"};
            this.collection = "config";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any):Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }

    }
    export class ProviderCtrl extends entityCtrl {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.collection = "config";
            WebSocketClient.onSignedin((user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    this.loadData();
                } else {
                    this.model = {};
                    this.model._type = "provider";
                    this.model.name = "Office 365";
                    this.model.id = "Office365";
                    this.model.provider = "saml";
                    this.model.issuer = "";
                    this.model.saml_federation_metadata = "https://login.microsoftonline.com/common/FederationMetadata/2007-06/FederationMetadata.xml";
                }
                
            });
        }
        async submit():Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Providers");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }


    
    export class UsersCtrl extends entitiesCtrl {
        public loading:boolean = false;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api: api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.basequery = {_type: "user"};
            this.collection = "users";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any):Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class UserCtrl extends entityCtrl {
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api:api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.collection = "users";
            WebSocketClient.onSignedin((user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    this.loadData();
                } else {
                    this.model = {};
                    this.model._type = "user";
                    this.model.name = "";
                    this.model.username = "";
                    this.model.newpassword = "";
                    this.model.sid = "";
                    this.model.federationids = [];
                }
                
            });
        }
        async submit():Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Users");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }




    
    export class RolesCtrl extends entitiesCtrl {
        public loading:boolean = false;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api:api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.basequery = {_type: "role"};
            this.collection = "users";
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteOne(model: any):Promise<any> {
            this.loading = true;
            await this.api.Delete(this.collection, model);
            this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class RoleCtrl extends entityCtrl {
        public addthis:any = "";
        public users:any[] = null;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api:api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.collection = "users";
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    await this.loadData();
                    await this.loadUsers();
                } else {
                    this.model = {};
                    this.model._type = "role";
                    this.model.members = [];
                    this.model.name = "";
                }
                
            });
        }
        async loadUsers():Promise<void> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = this.collection; 
            // q.query = {};
            q.query = {$or: [{_type:"user"}, {_type:"role"}]} ;
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<QueryMessage>(msg);
            this.users = q.result;
            var ids:string[] = [];
            if(this.model.members === undefined) { this.model.members = []; }
            for(var i:number=0; i < this.model.members.length; i++) {
                ids.push(this.model.members[i]._id);
            }
            for(var i:number=this.users.length -1; i >= 0; i--) {
                if(ids.indexOf(this.users[i]._id) > -1) {
                    this.users.splice(i,1);
                }
            }
            this.addthis = q.result[0]._id;

            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async submit():Promise<void> {
            if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
            }
            this.$location.path("/Roles");
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        RemoveMember(model:any) {
            if(this.model.members === undefined) { this.model.members = []; }
            for(var i:number=0; i < this.model.members.length; i++) {
                if(this.model.members[i]._id === model._id) {
                    this.model.members.splice(i,1);
                }
            }
        }
        AddMember(model:any) {
            if(this.model.members === undefined) { this.model.members = []; }
            var user:any = null;
            this.users.forEach(u => {
                if(u._id === this.addthis) { user = u; }
            });
            this.model.members.push({name:user.name, _id:user._id});
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
        public loading:boolean = false;
        public messages:string = "";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api:api
        ) {
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                var q: RegisterQueueMessage = new RegisterQueueMessage();
                var msg:Message  = new Message(); msg.command = "registerqueue"; msg.data = JSON.stringify(q);
                await this.WebSocketClient.Send(msg);
            });
        }

        async SendOne():Promise<void> {
            var result:any = await this.api.QueueMessage("webtest", {payload: "hi mom"});
            var msg = JSON.parse(result.data);
            this.messages += msg.payload + "\n";
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }


    
    
    export class EntitiesCtrl extends entitiesCtrl {
        public loading:boolean = false;
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient, 
            public api:api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.basequery = {};
            this.collection = $routeParams.collection;
            this.baseprojection = {_type:1, type:1, name:1, _created:1, _createdby:1, _modified:1};
            WebSocketClient.onSignedin((user: TokenUser) => {
                this.loadData();
            });
        }
        async DeleteMany():Promise<void> {
            this.loading = true;
            var Promises:Promise<DeleteOneMessage>[] = [];
            var q: DeleteOneMessage = new DeleteOneMessage();
            this.models.forEach(model => {
                q.collectionname = this.collection; q._id = (model as any)._id;
                var msg:Message  = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
                Promises.push(this.WebSocketClient.Send(msg));
            });
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));
            const values:DeleteOneMessage[] = results.filter(result => !(result instanceof Error));
            var ids:string[] = [];
            values.forEach((x:DeleteOneMessage) => ids.push(x._id));
            this.models = this.models.filter(function (m: any):boolean { return ids.indexOf(m._id)===-1;});
            this.loading = false;
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
    }
    export class EntityCtrl extends entityCtrl {
        public addthis:any = "";
        public users:any[] = null;
        public newkey:string = "";
        public showjson:boolean = false;
        public jsonmodel:string = "";
        constructor(
            public $scope: ng.IScope,
            public $location: ng.ILocationService,
            public $routeParams: ng.route.IRouteParamsService,
            public WebSocketClient: WebSocketClient,
            public api:api
        ) {
            super($scope, $location, $routeParams, WebSocketClient, api);
            this.collection = $routeParams.collection;
            WebSocketClient.onSignedin(async (user: TokenUser) => {
                if (this.id !== null && this.id !== undefined) {
                    await this._loadData();
                } else {
                    this.model = {};
                    this.model._type = "role";
                    this.model.name = "";
                    this.model.username = "";
                    this.model.newpassword = "";
                    this.model.sid = "";
                    this.model.federationids = [];
                    this.keys = Object.keys(this.model);
                }
            });
        }
        togglejson() {
            this.showjson = !this.showjson;
            if (this.showjson) {
                this.jsonmodel = JSON.stringify(this.model, null, 2);
            } else {
                this.model = JSON.parse(this.jsonmodel);
            }
            }
        async _loadData():Promise<void> {
            var q: QueryMessage = new QueryMessage();
            q.collectionname = this.collection; q.query = this.basequery;
            q.projection = this.baseprojection; q.top = 1;
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.WebSocketClient.Send<QueryMessage>(msg);
            if(q.result.length > 0) { this.model = q.result[0]; }
            this.keys = Object.keys(this.model);
            for(var i:number=this.keys.length-1; i >=0; i--) {
                if (this.keys[i].startsWith('_')) this.keys.splice(i, 1);
            }
            if (!this.$scope.$$phase) { this.$scope.$apply(); }
        }
        async submit():Promise<void> {
            if (this.showjson) {
                this.model = JSON.parse(this.jsonmodel);
            }
                if (this.model._id) {
                await this.api.Update(this.collection, this.model);
            } else {
                await this.api.Insert(this.collection, this.model);
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
    
    }

}
