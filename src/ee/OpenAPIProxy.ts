import { NoderedUtil, User } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import express from "express";
import fs from "fs";
import hjson from "hjson";
import swaggerUi from "swagger-ui-express";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { WebServer } from "../WebServer.js";
import { amqpwrapper } from "../amqpwrapper.js";
let schema2 = {}
try {
  if (fs.existsSync("src/public/swagger.json") == true) {
    const json = fs.readFileSync("src/public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if (fs.existsSync("../public/swagger.json") == true) {
    const json = fs.readFileSync("../public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if (fs.existsSync("./public/swagger.json") == true) {
    const json = fs.readFileSync("./public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if (fs.existsSync("src/public.template/swagger.json") == true) {
    const json = fs.readFileSync("src/public.template/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if (fs.existsSync("../public.template/swagger.json") == true) {
    const json = fs.readFileSync("../public.template/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if (fs.existsSync("./public.template/swagger.json") == true) {
    const json = fs.readFileSync("./public.template/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else {
    Logger.instanse.warn("swagger.json not found", null, { cls: "OpenAPIProxy" });
    console.warn("swagger.json not found");

  }
} catch (error) {
  Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
}

import { NextFunction } from "express";
import { ValidateError } from "tsoa";
import { Auth } from "../Auth.js";
import { RegisterRoutes } from "./build/routes.js";
export class OpenAPIProxy {
  public static amqp_promises = [];
  public static createPromise = () => {
    const correlationId = NoderedUtil.GetUniqueIdentifier();
    var promise = new Promise((resolve, reject) => {
      const promise = {
        correlationId: correlationId,
        resolve: resolve, // Store the resolve function
        reject: reject, // Store the reject function
      };
      OpenAPIProxy.amqp_promises.push(promise);
    });
    return { correlationId, promise };
  }

  public static queue
  static async configure(app: express.Express, parent: Span): Promise<void> {

    const openapiuser: User = { "username": "OpenAPI" } as any;
    OpenAPIProxy.queue = amqpwrapper.Instance().AddQueueConsumer(openapiuser, "openapi", null, null, async (data: any, options: any, ack: any, done: any) => {
      try {
        var promise = OpenAPIProxy.amqp_promises.find(x => x.correlationId == options.correlationId);
        if (promise != null) {
          Logger.instanse.debug("[" + options.correlationId + "] " + data, null, { cls: "OpenAPIProxy" });

          if (typeof data === "string" || (data instanceof String)) {
            data = hjson.parse(data as any);
          }

          if (data.command == "invokecompleted") {
            promise.resolve(data.data);
            OpenAPIProxy.amqp_promises.splice(OpenAPIProxy.amqp_promises.indexOf(promise), 1);
          } else if (data.command == "invokefailed") {
            promise.reject(data.data);
            OpenAPIProxy.amqp_promises.splice(OpenAPIProxy.amqp_promises.indexOf(promise), 1);
          } else if (data.command == "timeout") {
            promise.reject(new Error("Unknown queue or timeout. Either target is not valid or noone was online to answer."));
            OpenAPIProxy.amqp_promises.splice(OpenAPIProxy.amqp_promises.indexOf(promise), 1);
          }

        } else {
          Logger.instanse.warn("[" + options.correlationId + "] No promise found for correlationId: " + options.correlationId, null, { cls: "OpenAPIProxy" });
        }
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
      }
      ack();
    }, null);

    app.all("/api/v1/*", async (req, res, next) => {
      if (Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      const urlPath = req.path;
      const method = req.method.toUpperCase();
      const remoteip = WebServer.remoteip(req as any);
      Logger.instanse.debug("[" + method + "] " + urlPath + " from " + remoteip, null, { cls: "OpenAPIProxy" });
      next();
    });

    RegisterRoutes(app);


    app.use(function errorHandler(
      err: unknown,
      req: any,
      res: any,
      next: NextFunction
    ): any | void {
      if (err instanceof ValidateError) {
        console.warn(`Caught Validation Error for ${req.path}:`, err.fields);
        return res.status(422).json({
          message: "Validation Failed",
          details: err?.fields,
        });
      }
      if (err instanceof Error) {
        console.warn(`Caught Error for ${req.path}:`, err.message);
        var message = err.message;
        var stack = err.stack;
        return res.status(500).json({
          error: message, message, stack
        });
      }

      next();
    });

    var collections = await Config.db.ListCollections(false, Crypt.rootToken());
    collections = collections.filter(x => x.name != "fs.chunks");
    collections = collections.filter(x => x.name != "uploads.files");
    collections = collections.filter(x => x.name != "uploads.chunks");
    collections = collections.filter(x => !x.name.endsWith("_hist"));

    app.all("/rest/v1/*", async (req, res, next) => {
      if (Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      const urlPath = req.path;
      const method = req.method.toUpperCase();
      Logger.instanse.debug("[" + method + "] " + urlPath, null, { cls: "OpenAPIProxy" });

      if (urlPath == "/rest/v1/InvokeOpenRPA") {
        let body = req.body;
        if (body != null && body.body != null) body = body.body;
        try {
          var jwt = await OpenAPIProxy.GetToken(req);
          let result = { status: "ok", reply: undefined, error: undefined }
          if (typeof body === "string" || (body instanceof String)) {
            body = hjson.parse(body as any);
          }

          if (body.payload === null || body.payload === undefined) { body.payload = {}; }
          body.rpc = Config.parseBoolean(body.rpc as any);
          const rpacommand = {
            command: "invoke",
            workflowid: body.workflowid,
            data: body.payload
          }
          var robotuser = null;
          if (body.robotid != null && body.robotid != "") {
            robotuser = await Config.db.getbyid(body.robotid, "users", jwt, true, null)
            if (robotuser == null) {
              robotuser = await Config.db.GetOne({
                collectionname: "users", query: {
                  "_type": "user",
                  "$or": [{ "name": { "$regex": "^" + body.robotid + ".$", "$options": "i" } },
                  { "username": { "$regex": "^" + body.robotid + ".$", "$options": "i" } }]
                }, jwt
              }, null);
            }
          }
          var workflow = null;
          if (body.robotid != null && body.robotid != "") {
            workflow = await Config.db.getbyid(body.workflowid, "openrpa", jwt, true, null)
            if (workflow == null) {
              workflow = await Config.db.GetOne({
                collectionname: "openrpa", query: {
                  "_type": "workflow",
                  "$or": [{ "name": { "$regex": "^" + body.workflowid + ".$", "$options": "i" } },
                  { "projectandname": { "$regex": "^" + body.workflowid + ".$", "$options": "i" } }]
                }, jwt
              }, null);
            }
          }
          if (robotuser == null) {
            result.status = "error";
            result.error = "No such robot, please make sure robotid is a valid user _id from users collection";
          } else if (workflow == null) {
            result.status = "error";
            result.error = "No such workflow, please make sure workflowid is a valid workflow _id from openrpa collection";
          } else if (body.rpc == true) {
            body.userid = robotuser._id;
            const { correlationId, promise } = OpenAPIProxy.createPromise();
            Logger.instanse.debug("Send message to openrpa with correlationId: " + correlationId + " and message: " + JSON.stringify(rpacommand), null, { cls: "OpenAPIProxy" });
            try {
              await amqpwrapper.Instance().sendWithReplyTo("", body.userid, "openapi", rpacommand, 5000, correlationId, "", null);
              result.reply = await promise;
              var b = true;
            } catch (error) {
              result.status = "error";
              result.error = (error.message != null ? error.message : error);
              if (result.error == null) {
                result.error = (error.Message != null ? error.Message : error);
              }
            }

          } else {
            const correlationId = NoderedUtil.GetUniqueIdentifier();
            Logger.instanse.debug("Send message to openrpa with correlationId: " + correlationId + " and message: " + JSON.stringify(rpacommand), null, { cls: "OpenAPIProxy" });
            await amqpwrapper.Instance().send("", body.userid, rpacommand, 5000, correlationId, "", null);
          }
          Logger.instanse.debug("Returned " + JSON.stringify(result) + " for body: " + JSON.stringify(body), null, { cls: "OpenAPIProxy" });
          res.json(result);

        } catch (error) {
          Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
          Logger.instanse.debug(JSON.stringify(body), null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: error.message });
        }
      } else {
        try {
          var jwt = await OpenAPIProxy.GetToken(req);
          const tuser = await Auth.Token2User(jwt, null);
          let result = await WebServer.ProcessMessage(req, tuser, jwt);
          res.json(result.data);
        } catch (error) {
          Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: error.message });
        }
      }
      next();
    });

    var url = Config.externalbaseurl()
    if (Config.domain == "localhost" && Config.port != 80) {
      url = "http://" + Config.domain + ":" + Config.port
    }
    if (url.endsWith("/")) {
      url = url.substring(0, url.length - 1)
    }
    Logger.instanse.debug("Updating servers to " + url, null, { cls: "OpenAPIProxy" });
    schema2["servers"] = [{ url }]
    // @ts-ignore
    let components: any = schema2?.components;
    if (components?.securitySchemes?.oidc?.openIdConnectUrl != null) {
      components.securitySchemes.oidc.openIdConnectUrl = Config.baseurl() + "oidc/.well-known/openid-configuration";
    }
    var options = {
      explorer: true
    };

    app.use("/docs", swaggerUi.serve, async (_req: any, res: any) => {
      if (Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      Logger.instanse.debug("Serving /docs", null, { cls: "OpenAPIProxy" });
      return res.send(
        swaggerUi.generateHTML(schema2)
      );
    });
    app.get("/openapi.json", (req, res) => {
      if (Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.ignore = true
      Logger.instanse.debug("[GET] /openapi.json", null, { cls: "OpenAPIProxy" });
      res.json(schema2);
    });
    app.get("/swagger_output.json", (req, res) => {
      if (Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.ignore = true
      Logger.instanse.debug("[GET] /swagger_output.json", null, { cls: "OpenAPIProxy" });
      res.json(schema2);
    });

  }
  static async GetToken(req) {
    let authorization = "";
    let jwt = "";
    if (req.headers["authorization"]) {
      authorization = req.headers["authorization"];
    }
    if (authorization != null && authorization != "") {
      var user = await Auth.Token2User(authorization, null);
      if (user != null) {
        jwt = await Auth.User2Token(user, Config.shorttoken_expires_in, null);
      } else {
        throw new Error("Valid authorization header is required");
      }
    } else {
      throw new Error("Authorization header is required");
    }
    return jwt;
  }

}
