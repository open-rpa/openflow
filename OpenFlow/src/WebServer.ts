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

export class WebServer {
    private static _logger: winston.Logger;
    public static app: express.Express;

    static async configure(logger: winston.Logger, baseurl: string): Promise<http.Server> {
        this._logger = logger;

        this.app = express();
        // this.app.use(morgan('combined', { stream: (winston.stream as any).write }));
        var loggerstream = {
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
            name: "session",
            keys: ["key1", "key2"]
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
        //     private async _GetFile(id: string): Promise<string> {
        //     return new Promise<string>(async (resolve, reject) => {
        //         try {
        //             var bucket = new GridFSBucket(Config.db.db);
        //             let downloadStream = bucket.openDownloadStream(safeObjectID(id));
        //             var bufs = [];
        //             downloadStream.on('data', (chunk) => {
        //                 bufs.push(chunk);
        //             });
        //             downloadStream.on('error', (error) => {
        //                 reject(error);
        //             });
        //             downloadStream.on('end', () => {

        //                 // var contentLength = bufs.reduce(function(sum, buf){
        //                 //     return sum + buf.length;
        //                 //   }, 0);
        //                 var buffer = Buffer.concat(bufs);
        //                 //writeFileSync('/home/allan/Documents/data.png', result.body);
        //                 //result.body = Buffer.from(result.body).toString('base64');
        //                 var result = buffer.toString('base64');
        //                 resolve(result);
        //             });
        //         } catch (err) {
        //             reject(err);
        //         }
        //     });
        // }




        await LoginProvider.configure(this._logger, this.app, baseurl);
        await SamlProvider.configure(this._logger, this.app, baseurl);
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
                    ca = Buffer.from(Config.tls_ca, 'base64').toString('ascii');
                }
                options.ca = ca;
                // options.cert += "\n" + ca;
            }
            if (Config.tls_passphrase !== "") {
                // options.cert = [options.cert, Config.tls_passphrase];
                // options.key = [options.key, Config.tls_passphrase];
                options.passphrase = Config.tls_passphrase;
            }
            server = https.createServer(options, this.app);

            // var redirapp = express();
            // var _http = http.createServer(redirapp);
            // redirapp.get('*', function (req, res) {
            //     //res.redirect('https://' + req.headers.host + req.url);
            //     res.status(200).json({ status: "ok" });
            // })
            // _http.listen(80);
        } else {
            server = http.createServer(this.app);
        }

        var port = Config.port;
        server.listen(port);
        return server;
    }
}