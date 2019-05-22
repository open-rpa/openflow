import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as nodered from "node-red";

import * as samlauth from "node-red-contrib-auth-saml";
import * as cookieSession from "cookie-session";

import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient } from "./WebSocketClient";
import { noderedcontribopenflowstorage } from "./node-red-contrib-openflow-storage";
import { SigninMessage, Message } from "./Message";
import { noderedcontribmiddlewareauth } from "./node-red-contrib-middleware-auth";

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
            if (this.app === null) {
                this.app = express();
                this.app.use(compression());
                this.app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
                this.app.use(bodyParser.json({ limit: '10mb' }))
                this.app.use(cookieParser());
                this.app.use("/", express.static(path.join(__dirname, "/public")));
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
                } else {
                    server = http.createServer(this.app);
                }
                server.on("error", (error) => {
                    this._logger.error(error);
                    console.error(error);
                    process.exit(404);
                });

                this.settings = new nodered_settings();
                this.settings.userDir = path.join(__dirname, "./nodered");
                this.settings.nodesDir = path.join(__dirname, "./nodered");

                Config.DumpConfig();

                // this.settings.adminAuth = new googleauth.noderedcontribauthgoogle(Config.baseurl(), Config.consumer_key, Config.consumer_secret, 
                // (profile:string | any, done:any)=> {
                //     profile.permissions = "*";
                //     done(profile);
                // });
                this.settings.adminAuth = await samlauth.noderedcontribauthsaml.configure(Config.baseurl(), Config.saml_federation_metadata, Config.saml_issuer,
                    (profile: string | any, done: any) => {
                        // profile.permissions = "*";
                        done(profile);
                    }, "");
                // this.settings.adminAuth = await noderedcontribauthsaml.configure(this._logger, Config.baseurl());clear

                // settings.adminAuth = new noderedcontribauthopenid(this._logger, Config.baseurl());

                this.settings.httpNodeMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                };

                this.settings.storageModule = new noderedcontribopenflowstorage(logger, socket);

                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);

                server.listen(Config.port);
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