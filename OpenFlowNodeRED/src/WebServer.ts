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

// import * as samlauth from "./node-red-contrib-auth-saml";
import * as cookieSession from "cookie-session";

import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { noderedcontribopenflowstorage, noderednpmrc } from "./node-red-contrib-openflow-storage";
import { noderedcontribmiddlewareauth } from "./node-red-contrib-middleware-auth";

import * as passport from "passport";
import { noderedcontribauthsaml } from "./node-red-contrib-auth-saml";
import { WebSocketClient, NoderedUtil } from "openflow-api";
import * as client from "prom-client";
import * as promBundle from "express-prom-bundle";

export class WebServer {
    private static _logger: winston.Logger;
    private static app: express.Express = null;

    private static settings: nodered_settings = null;
    static async configure(logger: winston.Logger, socket: WebSocketClient): Promise<http.Server> {
        this._logger = logger;

        const options: any = null;
        const RED: nodered.Red = nodered;

        if (this.app !== null) { return; }

        try {
            this._logger.debug("WebServer.configure::begin");
            let server: http.Server = null;
            if (this.app === null) {
                this.app = express();

                const register = new client.Registry()
                const hostname = Config.getEnv("HOSTNAME", null);
                const defaultLabels: any = {};
                if (!NoderedUtil.IsNullEmpty(hostname)) defaultLabels["hostname"] = hostname;
                register.setDefaultLabels(defaultLabels);
                client.collectDefaultMetrics({ register })

                const metricsMiddleware = promBundle({ includeMethod: true, includePath: true, promRegistry: register, autoregister: true });
                this.app.use(metricsMiddleware);
                // this.app.use(morgan('combined', { stream: (winston.stream as any).write }));
                const loggerstream = {
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
                if (Config.tls_crt != '' && Config.tls_key != '') {
                    let options: any = {
                        cert: Config.tls_crt,
                        key: Config.tls_key
                    };
                    if (Config.tls_crt.indexOf("---") == -1) {
                        options = {
                            cert: Buffer.from(Config.tls_crt, 'base64').toString('ascii'),
                            key: Buffer.from(Config.tls_key, 'base64').toString('ascii')
                        };
                    }
                    let ca: string = Config.tls_ca;
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

                    const redirapp = express();
                    // const _http = http.createServer(redirapp);
                    redirapp.get('*', function (req, res) {
                        // res.redirect('https://' + req.headers.host + req.url);
                        res.status(200).json({ status: "ok" });
                    })
                    // _http.listen(80);
                } else {
                    server = http.createServer(this.app);
                }
                server.on("error", (error) => {
                    this._logger.error(error.message ? error.message : error);
                    process.exit(404);
                });

                this.settings = new nodered_settings();
                const c = Config;
                if (Config.nodered_port > 0) {
                    this.settings.uiPort = Config.nodered_port;
                }
                else {
                    this.settings.uiPort = Config.port;
                }



                // this.settings.userDir = path.join(__dirname, "./nodered");
                this.settings.userDir = path.join(Config.logpath, '.nodered-' + Config.nodered_id)
                this.settings.nodesDir = path.join(__dirname, "./nodered");

                // this.settings.adminAuth = new googleauth.noderedcontribauthgoogle(Config.baseurl(), Config.consumer_key, Config.consumer_secret, 
                // (profile:string | any, done:any)=> {
                //     profile.permissions = "*";
                //     done(profile);
                // });
                const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
                this.settings.adminAuth = await noderedcontribauthsaml.configure(baseurl, Config.saml_federation_metadata, Config.saml_issuer,
                    (profile: string | any, done: any) => {
                        const roles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
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
                    }, "", Config.saml_entrypoint, null);
                // this.settings.adminAuth = await noderedcontribauthsaml.configure(this._logger, Config.baseurl());clear

                // settings.adminAuth = new noderedcontribauthopenid(this._logger, Config.baseurl());

                this.settings.httpNodeMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                };

                this.settings.storageModule = new noderedcontribopenflowstorage(logger, socket);
                const n: noderednpmrc = await this.settings.storageModule._getnpmrc();
                if (!NoderedUtil.IsNullUndefinded(n) && !NoderedUtil.IsNullUndefinded(n.catalogues)) {
                    this.settings.editorTheme.palette.catalogues = n.catalogues;
                } else {
                    this.settings.editorTheme.palette.catalogues = ['https://catalogue.nodered.org/catalogue.json'];
                }

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
                    name: 'session', secret: Config.cookie_secret
                }))

                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);

                this.app.get("/livenessprobe", (req: any, res: any, next: any): void => {
                    res.end(JSON.stringify({ "success": "true" }));
                    res.end();
                });

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

            let hasErrors: boolean = true, errorCounter: number = 0, err: any;
            while (hasErrors) {
                try {
                    RED.start();
                    hasErrors = false;
                } catch (error) {
                    err = error;
                    errorCounter++;
                    hasErrors = true;
                    this._logger.error(error.message ? error.message : error);
                }
                if (errorCounter == 10) {
                    throw err;
                } else if (hasErrors) {
                    const wait = ms => new Promise((r, j) => setTimeout(r, ms));
                    await wait(2000);
                }
            }
            return server;
        } catch (error) {
            this._logger.error(error.message ? error.message : error);
            process.exit(404);
        }
        return null;
    }
}