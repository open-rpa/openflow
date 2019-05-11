function locationTracker(Longitude, Latitude) {
    console.log(Longitude + " "+ Latitude);
}
/**
 * @type {angular.Module}
 */
module openflow {
    "use strict";
    var webApp:any = angular.module("webApp", ['ngRoute', 'chart.js', 'ngLocalize', 'ngLocalize.Config'])
        .controller("MenuCtrl", MenuCtrl)
        .controller("Providers", ProvidersCtrl)
        .directive("timesince", timesince.factory())
        .directive("translate", translate.factory())
        .service("WebSocketClient", WebSocketClient)
        .service("api", api);
        // .directive("todoBlur", todoBlur)
        // .directive("todoFocus", todoFocus)
        // .directive("todoEscape", todoEscape)
        // .service("todoStorage", TodoStorage);
        webApp.config([
            <any>'$routeProvider', 
            ($routeProvider:angular.route.IRouteProvider) => {
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

                .when('/Entities/:collection', { templateUrl: 'Entities.html', controller: EntitiesCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })
                .when('/Entity/:collection/:id', { templateUrl: 'Entity.html', controller: EntityCtrl, controllerAs: 'ctrl' })

                .when('/Socket', { templateUrl: 'Socket.html', controller: SocketCtrl, controllerAs: 'ctrl' })

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
