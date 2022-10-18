import { WebSocketClientService } from "./WebSocketClientService";
import angular = require("angular");
import { timesince, timetoo, translate, textarea, fileread, userdata, api, copytext, jsonText, formatBytes, whenScrolled, ngtype } from "./CommonControllers";
import {
    MenuCtrl, ProvidersCtrl, MainCtrl, LoginCtrl, ProviderCtrl, UsersCtrl, UserCtrl, RolesCtrl, RoleCtrl, RPAWorkflowsCtrl, RPAWorkflowCtrl,
    WorkflowsCtrl, ReportsCtrl, EditFormCtrl, FormsCtrl, FormCtrl, FilesCtrl, EntitiesCtrl, EntityCtrl, HistoryCtrl, NoderedCtrl,
    hdrobotsCtrl, ClientsCtrl, AuditlogsCtrl, CredentialsCtrl, CredentialCtrl, DuplicatesCtrl,
    OAuthClientsCtrl, OAuthClientCtrl, DeletedCtrl, CustomerCtrl, EntityRestrictionsCtrl, EntityRestrictionCtrl, CustomersCtrl, ResourcesCtrl, ResourceCtrl, WorkitemsCtrl, WorkitemCtrl, WorkitemQueuesCtrl, WorkitemQueueCtrl, MailHistCtrl, MailHistsCtrl, FormResourcesCtrl, FormResourceCtrl, WebsocketClientsCtrl, ConsoleCtrl
} from "./Controllers";

require('angular-route');
require('angular-sanitize');
require('@fortawesome/fontawesome-free');
require('chart.js');
require('angular-chart.js');

// require('./formio.full.js');
// var css = require('./app.css');

var css = require('./app.css');


/**
 * @type {angular.Module}
 */
module openflow {
    "use strict";
    // .config(function (ChartJsProvider) {
    //     ChartJsProvider.setOptions({ responsive: true });
    //     ChartJsProvider.setOptions('Line', { responsive: true });
    // })
    //
    const webApp: any = angular.module("webApp", ['ngRoute', 'chart.js', 'ngLocalize', 'ngLocalize.Config'])
        .controller("MenuCtrl", MenuCtrl)
        .controller("Providers", ProvidersCtrl)
        .directive("timesince", timesince.factory())
        .directive("timetoo", timetoo.factory())
        .directive("translate", translate.factory())
        .directive("textarea", textarea.factory())
        .directive("fileread", fileread.factory())
        .directive("copytext", copytext.factory())
        .directive("jsonText", jsonText.factory())
        .directive("ngType", ngtype.factory())
        .directive("formatBytes", formatBytes.factory())
        .directive("whenScrolled", whenScrolled.factory())
        .service("userdata", userdata)
        .service("WebSocketClientService", WebSocketClientService)


        .directive('autoComplete', function ($timeout) {
            return function (scope, iElement, iAttrs) {
                (iElement as any).autocomplete({
                    source: scope[iAttrs.uiItems],
                    select: function () {
                        $timeout(function () {
                            (iElement as any).trigger('input');
                        }, 0);
                    }
                })
            };
        })
        .service("api", api);
    webApp.config([
        <any>'$routeProvider',
        ($routeProvider: angular.route.IRouteProvider) => {
            $routeProvider
                .when('/main', { templateUrl: 'Main.html', controller: MainCtrl, controllerAs: 'ctrl' })
                .when('/Login', { templateUrl: 'Login.html', controller: LoginCtrl, controllerAs: 'ctrl' })
                .when('/Providers', { templateUrl: 'Providers.html', controller: ProvidersCtrl, controllerAs: 'ctrl' })
                .when('/Provider', { templateUrl: 'Provider.html', controller: ProviderCtrl, controllerAs: 'ctrl' })
                .when('/Provider/:id', { templateUrl: 'Provider.html', controller: ProviderCtrl, controllerAs: 'ctrl' })
                .when('/Users', { templateUrl: 'Users.html', controller: UsersCtrl, controllerAs: 'ctrl' })
                .when('/User', { templateUrl: 'User.html', controller: UserCtrl, controllerAs: 'ctrl' })
                .when('/User/:id', { templateUrl: 'User.html', controller: UserCtrl, controllerAs: 'ctrl' })
                .when('/Roles', { templateUrl: 'Roles.html', controller: RolesCtrl, controllerAs: 'ctrl' })
                .when('/Role', { templateUrl: 'Role.html', controller: RoleCtrl, controllerAs: 'ctrl' })
                .when('/Role/:id', { templateUrl: 'Role.html', controller: RoleCtrl, controllerAs: 'ctrl' })

                .when('/RPAWorkflows', { templateUrl: 'RPAWorkflows.html', controller: RPAWorkflowsCtrl, controllerAs: 'ctrl' })
                .when('/RPAWorkflow/:id', { templateUrl: 'RPAWorkflow.html', controller: RPAWorkflowCtrl, controllerAs: 'ctrl' })

                .when('/Workflows', { templateUrl: 'Workflows.html', controller: WorkflowsCtrl, controllerAs: 'ctrl' })
                .when('/Reports', { templateUrl: 'Reports.html', controller: ReportsCtrl, controllerAs: 'ctrl' })

                .when('/EditForm/:id', { templateUrl: 'EditForm.html', controller: EditFormCtrl, controllerAs: 'ctrl' })
                .when('/EditForm', { templateUrl: 'EditForm.html', controller: EditFormCtrl, controllerAs: 'ctrl' })
                .when('/Forms', { templateUrl: 'Forms.html', controller: FormsCtrl, controllerAs: 'ctrl' })
                .when('/Form/:id', { templateUrl: 'Form.html', controller: FormCtrl, controllerAs: 'ctrl' })
                .when('/Form/:id/:instance', { templateUrl: 'Form.html', controller: FormCtrl, controllerAs: 'ctrl' })
                .when('/FormResources', { templateUrl: 'FormResources.html', controller: FormResourcesCtrl, controllerAs: 'ctrl' })
                .when('/FormResource', { templateUrl: 'FormResource.html', controller: FormResourceCtrl, controllerAs: 'ctrl' })
                .when('/FormResource/:id', { templateUrl: 'FormResource.html', controller: FormResourceCtrl, controllerAs: 'ctrl' })

                .when('/Files', { templateUrl: 'Files.html', controller: FilesCtrl, controllerAs: 'ctrl' })
                .when('/Entities', { templateUrl: 'Entities.html', controller: EntitiesCtrl, controllerAs: 'ctrl' })
                .when('/Entities/:collection', { templateUrl: 'Entities.html', controller: EntitiesCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection/:id', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })

                .when('/Duplicates/:collection', { templateUrl: 'Duplicates.html', controller: DuplicatesCtrl, controllerAs: 'ctrl' })

                .when('/History/:collection/:id', { templateUrl: 'History.html', controller: HistoryCtrl, controllerAs: 'ctrl' })
                .when('/Deleted/:collection', { templateUrl: 'Deleted.html', controller: DeletedCtrl, controllerAs: 'ctrl' })

                .when('/Nodered', { templateUrl: 'Nodered.html', controller: NoderedCtrl, controllerAs: 'ctrl' })
                .when('/Nodered/:id', { templateUrl: 'Nodered.html', controller: NoderedCtrl, controllerAs: 'ctrl' })

                .when('/hdrobots', { templateUrl: 'hdrobots.html', controller: hdrobotsCtrl, controllerAs: 'ctrl' })
                .when('/Clients', { templateUrl: 'Clients.html', controller: ClientsCtrl, controllerAs: 'ctrl' })

                .when('/Auditlogs', { templateUrl: 'Auditlogs.html', controller: AuditlogsCtrl, controllerAs: 'ctrl' })

                .when('/Credentials', { templateUrl: 'Credentials.html', controller: CredentialsCtrl, controllerAs: 'ctrl' })
                .when('/Credential', { templateUrl: 'Credential.html', controller: CredentialCtrl, controllerAs: 'ctrl' })
                .when('/Credential/:id', { templateUrl: 'Credential.html', controller: CredentialCtrl, controllerAs: 'ctrl' })

                .when('/OAuthClients', { templateUrl: 'OAuthClients.html', controller: OAuthClientsCtrl, controllerAs: 'ctrl' })
                .when('/OAuthClient', { templateUrl: 'OAuthClient.html', controller: OAuthClientCtrl, controllerAs: 'ctrl' })
                .when('/OAuthClient/:id', { templateUrl: 'OAuthClient.html', controller: OAuthClientCtrl, controllerAs: 'ctrl' })

                .when('/Customers', { templateUrl: 'Customers.html', controller: CustomersCtrl, controllerAs: 'ctrl' })
                .when('/Customer', { templateUrl: 'Customer.html', controller: CustomerCtrl, controllerAs: 'ctrl' })
                .when('/Customer/:id', { templateUrl: 'Customer.html', controller: CustomerCtrl, controllerAs: 'ctrl' })
                .when('/Customer/:id/:action', { templateUrl: 'Customer.html', controller: CustomerCtrl, controllerAs: 'ctrl' })

                .when('/EntityRestrictions', { templateUrl: 'EntityRestrictions.html', controller: EntityRestrictionsCtrl, controllerAs: 'ctrl' })
                .when('/EntityRestriction', { templateUrl: 'EntityRestriction.html', controller: EntityRestrictionCtrl, controllerAs: 'ctrl' })
                .when('/EntityRestriction/:id', { templateUrl: 'EntityRestriction.html', controller: EntityRestrictionCtrl, controllerAs: 'ctrl' })

                .when('/Resources', { templateUrl: 'Resources.html', controller: ResourcesCtrl, controllerAs: 'ctrl' })
                .when('/Resource', { templateUrl: 'Resource.html', controller: ResourceCtrl, controllerAs: 'ctrl' })
                .when('/Resource/:id', { templateUrl: 'Resource.html', controller: ResourceCtrl, controllerAs: 'ctrl' })

                .when('/Workitems', { templateUrl: 'Workitems.html', controller: WorkitemsCtrl, controllerAs: 'ctrl' })
                .when('/Workitems/:queue', { templateUrl: 'Workitems.html', controller: WorkitemsCtrl, controllerAs: 'ctrl' })
                .when('/Workitem/:id', { templateUrl: 'Workitem.html', controller: WorkitemCtrl, controllerAs: 'ctrl' })
                .when('/Workitem', { templateUrl: 'Workitem.html', controller: WorkitemCtrl, controllerAs: 'ctrl' })

                .when('/WorkitemQueues', { templateUrl: 'WorkitemQueues.html', controller: WorkitemQueuesCtrl, controllerAs: 'ctrl' })
                .when('/WorkitemQueue', { templateUrl: 'WorkitemQueue.html', controller: WorkitemQueueCtrl, controllerAs: 'ctrl' })
                .when('/WorkitemQueue/:id', { templateUrl: 'WorkitemQueue.html', controller: WorkitemQueueCtrl, controllerAs: 'ctrl' })

                .when('/WebsocketClients', { templateUrl: 'WebsocketClients.html', controller: WebsocketClientsCtrl, controllerAs: 'ctrl' })
                .when('/Console', { templateUrl: 'Console.html', controller: ConsoleCtrl, controllerAs: 'ctrl' })
                // .when('/WebsocketClients/:id', { templateUrl: 'WebsocketClients.html', controller: WebsocketClientsCtrl, controllerAs: 'ctrl' })

                .when('/MailHists', { templateUrl: 'MailHists.html', controller: MailHistsCtrl, controllerAs: 'ctrl' })
                .when('/MailHist/:id', { templateUrl: 'MailHist.html', controller: MailHistCtrl, controllerAs: 'ctrl' })

                .otherwise({ redirectTo: '/main' });
        }
    ])
    webApp.config([
        <any>'$locationProvider',
        ($locationProvider) => {
            //$locationProvider.html5Mode(false);
            $locationProvider.hashPrefix('');
        }
    ]).value('localeConf', {
        basePath: 'languages',
        defaultLocale: 'en-US',
        sharedDictionary: 'common',
        fileExtension: '.json',
        persistSelection: true,
        cookieName: 'COOKIE_LOCALE_LANG',
        observableAttrs: new RegExp('^data-(?!ng-|i18n)'),
        delimiter: '::',
        validTokens: new RegExp('^[\\w\\.-]+\\.[\\w\\s\\.-]+\\w(:.*)?$')
    }).value('localeSupported', [
        'en-US',
        'da-DK'
    ]);

}
