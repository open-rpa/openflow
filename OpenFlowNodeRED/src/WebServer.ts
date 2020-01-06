import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as nodered from "node-red";
import * as morgan from "morgan";

import * as samlauth from "node-red-contrib-auth-saml";
import * as cookieSession from "cookie-session";

import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient } from "./WebSocketClient";
import { noderedcontribopenflowstorage } from "./node-red-contrib-openflow-storage";
import { noderedcontribmiddlewareauth } from "./node-red-contrib-middleware-auth";

import * as passport from "passport";
import { NoderedUtil } from "./nodered/nodes/NoderedUtil";

export class WebServer {
    private static _logger: winston.Logger;
    private static app: express.Express = null;

    private static settings: nodered_settings = null;
    static async configure(logger: winston.Logger, socket: WebSocketClient): Promise<http.Server> {
        this._logger = logger;

        var options: any = null;
        var RED: nodered.Red = nodered;

        if (this.app !== null) { return; }

        try {
            this._logger.debug("WebServer.configure::begin");
            if (this.app === null) {
                this.app = express();
                // this.app.use(morgan('combined', { stream: (winston.stream as any).write }));
                var loggerstream = {
                    write: function (message, encoding) {
                        logger.silly(message);
                    }
                };
                this.app.use(morgan('combined', { stream: loggerstream }));
                this.app.use(compression());
                this.app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
                this.app.use(bodyParser.json({ limit: '10mb' }))
                this.app.use(cookieParser());
                this.app.use("/", express.static(path.join(__dirname, "/public")));

                this.app.use(passport.initialize());
                this.app.use(passport.session());
                passport.serializeUser(async function (user: any, done: any): Promise<void> {
                    done(null, user);
                });
                passport.deserializeUser(function (user: any, done: any): void {
                    done(null, user);
                });
                var server: http.Server = null;
                if (Config.tls_crt != '' && Config.tls_key != '') {
                    var options: any = {
                        cert: Config.tls_crt,
                        key: Config.tls_key
                    };
                    if (Config.tls_crt.indexOf("---") == -1) {
                        options = {
                            cert: Buffer.from(Config.tls_crt, 'base64').toString('ascii'),
                            key: Buffer.from(Config.tls_key, 'base64').toString('ascii')
                        };
                    }
                    var ca: string = Config.tls_ca;
                    if (ca !== "") {
                        if (ca.indexOf("---") === -1) {
                            ca = Buffer.from(ca, 'base64').toString('ascii');
                        }
                        if (ca.indexOf("---") > -1) {
                            options.ca = ca;
                        }
                        // options.cert += "\n" + ca;
                    }
                    if (Config.tls_passphrase !== "") {
                        options.passphrase = Config.tls_passphrase;
                    }
                    server = https.createServer(options, this.app);

                    var redirapp = express();
                    var _http = http.createServer(redirapp);
                    redirapp.get('*', function (req, res) {
                        // res.redirect('https://' + req.headers.host + req.url);
                        res.status(200).json({ status: "ok" });
                    })
                    _http.listen(80);
                } else {
                    server = http.createServer(this.app);
                }
                server.on("error", (error) => {
                    this._logger.error(error);
                    console.error(error);
                    process.exit(404);
                });

                this.settings = new nodered_settings();
                var c = Config;
                if (Config.nodered_port > 0) {
                    this.settings.uiPort = Config.nodered_port;
                }
                else {
                    this.settings.uiPort = Config.port;
                }



                this.settings.userDir = path.join(__dirname, "./nodered");
                this.settings.nodesDir = path.join(__dirname, "./nodered");

                // this.settings.adminAuth = new googleauth.noderedcontribauthgoogle(Config.baseurl(), Config.consumer_key, Config.consumer_secret, 
                // (profile:string | any, done:any)=> {
                //     profile.permissions = "*";
                //     done(profile);
                // });
                var baseurl = Config.saml_baseurl;
                if (NoderedUtil.IsNullEmpty(baseurl)) {
                    baseurl = Config.baseurl();
                }
                this.settings.adminAuth = await samlauth.noderedcontribauthsaml.configure(baseurl, Config.saml_federation_metadata, Config.saml_issuer,
                    (profile: string | any, done: any) => {
                        var roles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
                        if (roles !== undefined) {
                            if (Config.noderedusers !== "") {
                                if (roles.indexOf(Config.noderedusers) !== -1 || roles.indexOf(Config.noderedusers) !== -1) { profile.permissions = "read"; }
                            }
                            if (Config.noderedadmins !== "") {
                                if (roles.indexOf(Config.noderedadmins) !== -1 || roles.indexOf(Config.noderedadmins) !== -1) { profile.permissions = "*"; }
                            }
                        }
                        // profile.permissions = "*";
                        done(profile);
                    }, "", Config.saml_entrypoint);
                // this.settings.adminAuth = await noderedcontribauthsaml.configure(this._logger, Config.baseurl());clear

                // settings.adminAuth = new noderedcontribauthopenid(this._logger, Config.baseurl());

                this.settings.httpNodeMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                };

                this.settings.storageModule = new noderedcontribopenflowstorage(logger, socket);

                this.settings.ui.path = "ui";
                // this.settings.ui.middleware = new dashboardAuth();
                this.settings.ui.middleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                    // if (req.isAuthenticated()) {
                    //     next();
                    // } else {
                    //     passport.authenticate("uisaml", {
                    //         successRedirect: '/ui/',
                    //         failureRedirect: '/uisaml/',
                    //         failureFlash: false
                    //     })(req, res, next);
                    // }
                };


                this.app.use(cookieSession({
                    name: 'session',
                    keys: ['key1', 'key2']
                }))

                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);

                if (Config.nodered_port > 0) {
                    server.listen(Config.nodered_port);
                }
                else {
                    server.listen(Config.port);
                }

            } else {
                await RED.stop();
                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);
            }

            var hasErrors: boolean = true; var errorCounter: number = 0;
            var err: any;
            while (hasErrors) {
                try {
                    RED.start();
                    hasErrors = false;
                } catch (error) {
                    err = error;
                    errorCounter++;
                    hasErrors = true;
                    console.error(error);
                }
                if (errorCounter == 10) {
                    throw err;
                } else if (hasErrors) {
                    var wait = ms => new Promise((r, j) => setTimeout(r, ms));
                    await wait(2000);
                }
            }
            return server;
        } catch (error) {
            console.error(JSON.stringify(options));
            this._logger.error(error);
            console.error(error);
            process.exit(404);
        }
        return null;
    }
}