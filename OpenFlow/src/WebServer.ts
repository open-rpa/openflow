import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as cookieSession from "cookie-session";
import * as crypto from "crypto";
import * as flash from "flash";
import * as morgan from "morgan";

import * as samlp from "samlp";
import { SamlProvider } from "./SamlProvider";
import { LoginProvider } from "./LoginProvider";
import { DatabaseConnection } from "./DatabaseConnection";
import { Config } from "./Config";

import * as promBundle from "express-prom-bundle";
import * as client from "prom-client";
import { NoderedUtil } from "openflow-api";

export class WebServer {
    private static _logger: winston.Logger;
    public static app: express.Express;

    static async configure(logger: winston.Logger, baseurl: string, register: client.Registry): Promise<http.Server> {
        this._logger = logger;

        this.app = express();
        if (!NoderedUtil.IsNullUndefinded(register)) {
            const metricsMiddleware = promBundle({ includeMethod: true, includePath: true, promRegistry: register, autoregister: true });
            this.app.use(metricsMiddleware);
        }

        const loggerstream = {
            write: function (message, encoding) {
                logger.silly(message);
            }
        };
        this.app.use(morgan('combined', { stream: loggerstream }));
        this.app.use(compression());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.use(bodyParser.json());
        this.app.use(cookieParser());
        this.app.use(cookieSession({
            name: "session", secret: Config.cookie_secret
        }));
        this.app.use(flash());


        // Add headers
        this.app.use(function (req, res, next) {

            // Website you wish to allow to connect
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Request methods you wish to allow
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

            // Request headers you wish to allow
            res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

            // Set to true if you need the website to include cookies in the requests sent
            // to the API (e.g. in case you use sessions)
            res.setHeader('Access-Control-Allow-Credentials', "true");

            // Pass to next layer of middleware
            next();
        });
        this.app.use("/", express.static(path.join(__dirname, "/public")));
        await LoginProvider.configure(this._logger, this.app, baseurl);
        await SamlProvider.configure(this._logger, this.app, baseurl);
        let server: http.Server = null;
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
                    ca = Buffer.from(Config.tls_ca, 'base64').toString('ascii');
                }
                options.ca = ca;
                // options.cert += "\n" + ca;
            }
            if (Config.tls_passphrase !== "") {
                options.passphrase = Config.tls_passphrase;
            }
            server = https.createServer(options, this.app);
        } else {
            server = http.createServer(this.app);
        }

        const port = Config.port;
        server.listen(port);
        return server;
    }
}