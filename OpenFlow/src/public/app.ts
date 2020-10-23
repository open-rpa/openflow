import { WebSocketClientService } from "./WebSocketClientService";
import angular = require("angular");
import { timesince, translate, textarea, fileread, userdata, api } from "./CommonControllers";
import { MenuCtrl, ProvidersCtrl, MainCtrl, LoginCtrl, ProviderCtrl, UsersCtrl, UserCtrl, RolesCtrl, RoleCtrl, RPAWorkflowsCtrl, RPAWorkflowCtrl, WorkflowsCtrl, ReportsCtrl, jslogCtrl, EditFormCtrl, FormsCtrl, FormCtrl, FilesCtrl, EntitiesCtrl, EntityCtrl, HistoryCtrl, SocketCtrl, NoderedCtrl, hdrobotsCtrl, RobotsCtrl, AuditlogsCtrl, SignupCtrl, PaymentCtrl, QueuesCtrl, SocketsCtrl, QueueCtrl, CredentialsCtrl, CredentialCtrl, DuplicatesCtrl } from "./Controllers";

/**
 * @type {angular.Module}
 */
module openflow {
    "use strict";
    // .config(function (ChartJsProvider) {
    //     ChartJsProvider.setOptions({ responsive: true });
    //     ChartJsProvider.setOptions('Line', { responsive: true });
    // })
    var webApp: any = angular.module("webApp", ['ngRoute', 'chart.js', 'ngLocalize', 'ngLocalize.Config'])
        .controller("MenuCtrl", MenuCtrl)
        .controller("Providers", ProvidersCtrl)
        .directive("timesince", timesince.factory())
        .directive("translate", translate.factory())
        .directive("textarea", textarea.factory())
        .directive("fileread", fileread.factory())
        .service("userdata", userdata)
        .service("WebSocketClientService", WebSocketClientService)


        .directive('autoComplete', function ($timeout) {
            return function (scope, iElement, iAttrs) {
                (iElement as any).autocomplete({
                    source: scope[iAttrs.uiItems],
                    select: function () {
                        $timeout(function () {
                            iElement.trigger('input');
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
                .when('/jslog', { templateUrl: 'jslog.html', controller: jslogCtrl, controllerAs: 'ctrl' })

                .when('/EditForm/:id', { templateUrl: 'EditForm.html', controller: EditFormCtrl, controllerAs: 'ctrl' })
                .when('/EditForm', { templateUrl: 'EditForm.html', controller: EditFormCtrl, controllerAs: 'ctrl' })
                .when('/Forms', { templateUrl: 'Forms.html', controller: FormsCtrl, controllerAs: 'ctrl' })
                .when('/Form/:id', { templateUrl: 'Form.html', controller: FormCtrl, controllerAs: 'ctrl' })
                .when('/Form/:id/:instance', { templateUrl: 'Form.html', controller: FormCtrl, controllerAs: 'ctrl' })

                .when('/Files', { templateUrl: 'Files.html', controller: FilesCtrl, controllerAs: 'ctrl' })
                .when('/Entities', { templateUrl: 'Entities.html', controller: EntitiesCtrl, controllerAs: 'ctrl' })
                .when('/Entities/:collection', { templateUrl: 'Entities.html', controller: EntitiesCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection/:id', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })

                .when('/Duplicates/:collection', { templateUrl: 'Duplicates.html', controller: DuplicatesCtrl, controllerAs: 'ctrl' })

                .when('/History/:collection/:id', { templateUrl: 'History.html', controller: HistoryCtrl, controllerAs: 'ctrl' })

                .when('/Socket', { templateUrl: 'Socket.html', controller: SocketCtrl, controllerAs: 'ctrl' })
                .when('/Nodered', { templateUrl: 'Nodered.html', controller: NoderedCtrl, controllerAs: 'ctrl' })
                .when('/Nodered/:id', { templateUrl: 'Nodered.html', controller: NoderedCtrl, controllerAs: 'ctrl' })

                .when('/hdrobots', { templateUrl: 'hdrobots.html', controller: hdrobotsCtrl, controllerAs: 'ctrl' })
                .when('/Robots', { templateUrl: 'Robots.html', controller: RobotsCtrl, controllerAs: 'ctrl' })

                .when('/Auditlogs', { templateUrl: 'Auditlogs.html', controller: AuditlogsCtrl, controllerAs: 'ctrl' })

                .when('/Signup', { templateUrl: 'Signup.html', controller: SignupCtrl, controllerAs: 'ctrl' })
                .when('/Payment', { templateUrl: 'Payment.html', controller: PaymentCtrl, controllerAs: 'ctrl' })
                .when('/Payment/:userid', { templateUrl: 'Payment.html', controller: PaymentCtrl, controllerAs: 'ctrl' })

                .when('/Queue', { templateUrl: 'Queue.html', controller: QueueCtrl, controllerAs: 'ctrl' })
                .when('/Queue/:id', { templateUrl: 'Queue.html', controller: QueueCtrl, controllerAs: 'ctrl' })
                .when('/Queues', { templateUrl: 'Queues.html', controller: QueuesCtrl, controllerAs: 'ctrl' })
                .when('/Sockets', { templateUrl: 'Sockets.html', controller: SocketsCtrl, controllerAs: 'ctrl' })

                .when('/Credentials', { templateUrl: 'Credentials.html', controller: CredentialsCtrl, controllerAs: 'ctrl' })
                .when('/Credential', { templateUrl: 'Credential.html', controller: CredentialCtrl, controllerAs: 'ctrl' })
                .when('/Credential/:id', { templateUrl: 'Credential.html', controller: CredentialCtrl, controllerAs: 'ctrl' })

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
