import { Config } from "../Config.js";
import express from "express";
import { Span } from "@opentelemetry/api";
import hjson from "hjson";
import fs from "fs";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { amqpwrapper } from "../amqpwrapper.js";
import { NoderedUtil, User } from "@openiap/openflow-api";
import { WebServer } from "../WebServer.js";
import swaggerUi from "swagger-ui-express";
let schema2 = {}
try {
  var dir = fs.readdirSync(".");
  if(fs.existsSync("OpenFlow/src/public/swagger.json") == true) {
    const json = fs.readFileSync("OpenFlow/src/public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if(fs.existsSync("../public/swagger.json") == true) {
    const json = fs.readFileSync("../public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else if(fs.existsSync("./public/swagger.json") == true) {
    const json = fs.readFileSync("./public/swagger.json", "utf8");
    schema2 = JSON.parse(json);
  } else {
    Logger.instanse.warn("swagger.json not found", null, { cls: "OpenAPIProxy" });
    console.warn("swagger.json not found");
 
  }
} catch (error) {
  Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });  
}

import { RegisterRoutes } from "./build/routes.js";
import { ValidateError } from "tsoa";
import { NextFunction } from "express";
import { Auth } from "../Auth.js";
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
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
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
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
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
          if(body.robotid != null && body.robotid != "") {
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
          if(body.robotid != null && body.robotid != "") {
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
          if(tuser == null) { res.status(401).json({ error: "Access denied" }); return; }
          let result = await WebServer.ProcessMessage(req, tuser, jwt);
          res.json(result.data);
        } catch (error) {
          Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: error.message });
        }
      }
      next();
    });

    app.all("/rest2/v1/ListCollections", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      Logger.instanse.debug("[GET] /rest/v1/ListCollections", null, { cls: "OpenAPIProxy" });
      try {
        var jwt = await OpenAPIProxy.GetToken(req);
        var collections = await Config.db.ListCollections(false, jwt);
        var collectioninfo = await Config.db.GetOne<any>({ collectionname: "config", query: { "_type": "collectioninfo" } }, null)
        // var collectioninfo= {}
        if (collectioninfo == null) collectioninfo = {}
        collections = collections.filter(x => x.name != "fs.chunks");
        collections = collections.filter(x => x.name != "uploads.files");
        collections = collections.filter(x => x.name != "uploads.chunks");
        collections = collections.filter(x => !x.name.endsWith("_hist"));
        for (var i = 0; i < collections.length; i++) {
          const collectionname = collections[i].name
          delete collections[i].idIndex;
          delete collections[i].info;
          delete collections[i].options;
          if (collectioninfo[collectionname] != null) {
            if (collectioninfo[collectionname].description_for_model != null || collectioninfo[collectionname].description != null || collectioninfo[collectionname].schema != null) {
              collections[i] = Object.assign(collections[i], collectioninfo[collectionname])
            } else {
              collections[i].description_for_model = collectioninfo[collectionname]
            }
            continue;
          }
          switch (collectionname) {
            case "agents":
              collections[i].description_for_model = "Contains all packages with custom code and agents connected to this openflow instance. Agents are docker instances running custom code, or deamons installed on premise running multiple packages or assisnt applications users can install to run custom code at their desktop."
              break;
            case "audit":
              collections[i].description_for_model = `The audit model contains all audit logs for all users, agents, and customers. Each document in this model has a 'userid' property that corresponds to the '_id' field of the user. This 'userid' property is crucial when retrieving statistics for a specific user. Additionally, the audit logs often contain details about the agent, the remote IP address, and the type of action that triggered the audit log. These details provide valuable insights into the activities and behaviors of the users and agents.`
              break;
            case "dbusage":
              collections[i].description_for_model = "Contains performance metrics based on each user and customers database diskusage. contains timestamp, userid, username and collection and size"
              break;
            case "forms":
              collections[i].description_for_model = "Contains forms created by users, who can be used as part of BPM processes, defined in the workflow collection, and _id is is realted to the form property in the workflow_instances collection"
              break;
            case "fs.files":
              collections[i].description_for_model = "is mongodbs gridfs collection, used to store files in the database. Can be used for many things including rpa workflows from openrpa collection, packages with custom code from the agents collection and so on"
              break;
            case "mailhist":
              collections[i].description_for_model = "contains a log over all emails sent to users when validating new user accounts or asking for a password reset. Contains many field inclding userid, from, to, read, readcount, response. opened is a property array with a log over when users opened the mail "
              break;
            case "mq":
              collections[i].description_for_model = "contains defenition of all workitem queues ( related to workitems collection ) and message queues registered in rabbitmq ( used for sending message to agents and openflow )"
              break;
            case "nodered":
              collections[i].description_for_model = "contains _type flow, npmrc, credential, setting and session used by all NodeRED agents connected to this openflow instance"
              break;
            case "openrpa":
              collections[i] = {
                "description_for_model": "Contains workflows/projects. Fields: _id (unique ID), _type (type: workflow/project), name (name), RelativeFilename (file path). contains _type workflow, project, credential, detector for all openrpa agents connected to this openflow instance. Also contains _type unattendedserver, unattendedclient used for High-Density openrpa Robots running on terminal servers",
                "name": "openrpa",
                "schema": [
                  {
                    "name": "Credential name",
                    "_type": "credential",
                    "_id": "object id",
                    "username": "username",
                    "password": "username"
                  },
                  {
                    "name": "Detector name",
                    "_type": "detector",
                    "_id": "object id",
                    "Plugin": "OpenRPA.Interfaces.KeyboardDetectorPlugin",
                    "projectid": "5de398f9533a963365e8a735",
                    "detectortype": "exchange or queue",
                    "Properties": {
                      "Keys": "{LMENU down}2{LMENU up}"
                    }
                  },
                  {
                    "name": "New Project",
                    "_type": "project",
                    "_id": "object id",
                    "disable_local_caching": false,
                    "save_output": false,
                    "send_output": false,
                    "Filename": "New_Project.rpaproj",
                    "dependencies": {
                      "nugetid": "verson"
                    }
                  },
                  {
                    "name": "Workflow name",
                    "_type": "workflow",
                    "_id": "object id",
                    "disable_local_caching": false,
                    "Xaml": "XML containgn workflow. This filed is very big and shuuld normally be expluded from projection to save bandwidth",
                    "send_output": false,
                    "Parameters": [
                      {
                        "name": "result",
                        "type": "System.String",
                        "direction": "in"
                      },
                      {
                        "name": "origin",
                        "type": "System.String",
                        "direction": "inout"
                      },
                      {
                        "name": "route",
                        "type": "System.String",
                        "direction": "out"
                      }
                    ],
                    "Serializable": true,
                    "Filename": "New_Workflow8.xaml",
                    "projectandname": "Examples/html-email",
                    "FilePath": "C:\\Users\\allan\\Documents\\OpenRPA\\Examples\\New_Workflow8.xaml",
                    "projectid": "5e0e399f033c39ce8a5a933a"
                  }
                ]
              }
              break;
            case "openrpa_instances":
              collections[i] = {
                "description_for_model": "Contains workflow instances. Fields: _id (unique ID), _createdbyid (robot/user ID), RelativeFilename (workflow name), state (status), isCompleted (completion status), hasError (error status). contains an entry for every time an openrpa robot has run a workflow. WorkflowId ( WorkflowId bane is case sensetiv ) related to _id on _type workflow objects in  openrpa collection. _createdbyid relates to the _id of the user from the users collection that started the workflow. projectid related to the _id of the _type project object in the openrpa collection and so on. Always use projection to exclude the Xaml field to save bandwidth. Expect ekstra long response times on this collection since its very very big, when not using name or state in the query. Expect each workflow to have been started at _created and completed at _modified",
                "name": "openrpa_instances",
                "schema": [
                  {
                    "name": "workflow name",
                    "_type": "workflowinstance",
                    "_id": "object id",

                    "InstanceId": "Guied representing instance id in Microsoft Wokkflow Foundation",
                    "WorkflowId": "id of openrpa workflow that this instance is running. Matched _id from openrpa collection where _type is workflow",
                    "caller": "id of user who initiated this workflow. Matched _id from users collection where _type is user",
                    "RelativeFilename": "project name/workflow file name of this workflow. Matches projectandname from openrpa collection where _type is workflow",
                    "projectid": "project to who the workflow belings. Matches _id from openrpa collection where _type is project",
                    "projectname": "project name to who the workflow belings. Matches name from openrpa collection where _type is project",

                    "ownerid": "id of robot who is running this workflow. Matched _id from users collection where _type is user",
                    "owner": "name of robot who is running this workflow. Matched name from users collection where _type is user",
                    "host": "host name of robot who is running this workflow",
                    "fqdn": "fully qualified domain name of robot who is running this workflow",
                    "errormessage": "error message if workflow has failed",
                    "errorsource": "error source (activity id) if workflow has failed",
                    "isCompleted": "booleaner representing wether workflow has completed or not",
                    "hasError": "booleaner representing wether workflow has failed or not",
                    "state": "string representing current state of workflow. idle, running, aborted, failed, completed",
                    "queuename": "If initialed remotly, contains queue of caller who must be notified of status of workflow",
                    "correlationId": "If initialed remotly, contains correlationId of caller messages, used when sending statof messages of workflow",
                    "console": "if console logging has been enabled for workflow or project, will contain console outout from workflow",


                    "_createdby": "username of who created this user",
                    "_createdbyid": "6204f49ffef414dc6f9ded5f",
                    "_created": "2022-06-14T09:44:11.126Z",
                    "_modifiedby": "Username of who last edited this user",
                    "_modifiedbyid": "6204f49ffef414dc6f9ded5f",
                    "_modified": "2022-06-14T09:44:11.126Z",
                    "_version": "integer value, shows number of version of this document saved in history collection"
                  }
                ]
              }
              break;
            case "users":
              collections[i] = {
                "description_for_model": "Contains all users, roles and customers found by _type eq user, role or customer. Use the _id field to join with realted collections",
                "name": "users",
                "schema": [
                  {
                    "name": "Users fullname",
                    "username": "Users username will often be email",
                    "email": "Users email address",
                    "_type": "user",
                    "_id": "object id",
                    "dblocked": "Is user dblocked for exceeding diskusage",
                    "dbusage": "dbusage in bytes",
                    "emailvalidated": "boolen, if user has received and clicked an confirmation email, or signed in using federation",
                    "formvalidated": "boolen, if form validation is requered, has user filled out the registration form",
                    "validated": "boolean, only validated users can sign in, depends on emailvalidated and formvalidated if relevant",
                    "_createdby": "username of who created this user",
                    "_createdbyid": "6204f49ffef414dc6f9ded5f",
                    "_created": "2022-06-14T09:44:11.126Z",
                    "_modifiedby": "Username of who last edited this user",
                    "_modifiedbyid": "6204f49ffef414dc6f9ded5f",
                    "_modified": "2022-06-14T09:44:11.126Z",
                    "_version": "integer value, shows number of version of this document saved in history collection"
                  },
                  {
                    "name": "Role name",
                    "_type": "role",
                    "members": [
                      {
                        "_id": "id of a user or role",
                        "name": "the name of the user or role"
                      }
                    ],
                    "_id": "object id",
                    "_createdby": "username of who created this user",
                    "_createdbyid": "6204f49ffef414dc6f9ded5f",
                    "_created": "2022-06-14T09:44:11.126Z",
                    "_modifiedby": "Username of who last edited this user",
                    "_modifiedbyid": "6204f49ffef414dc6f9ded5f",
                    "_modified": "2022-06-14T09:44:11.126Z",
                    "_version": "integer value, shows number of version of this document saved in history collection"
                  },
                  {
                    "name": "Customer name",
                    "_type": "customer",
                    "_id": "object id",
                    "country": "Country",
                    "email": "Contact and/or billing email",
                    "stripeid": "Stripe customer id if stripe has been enabled",
                    "vatnumber": "vatnumber for company, if stripe has been enabled",
                    "admins": "id of role with admin rights over this customer",
                    "users": "id of role that contains all users of this customer",
                    "userid": "User id who created this customer",
                    "dblocked": "Is customer dblocked for exceeding diskusage",
                    "domains": ["array of domains owned by customer, so new users will be automatically added to this customer"],
                    "dbusage": "dbusage in bytes",
                    "_created": "2022-06-14T09:44:11.126Z",
                    "_modified": "2022-06-14T09:44:11.126Z",
                    "_version": "integer value, shows number of version of this document saved in history collection"
                  }

                ]
              }
              break;
            default:
              if (collections[i].type == "timeseries") {
                collections[i].description_for_model = "Use getquery to get a few documents and inspect all properties, then use aggregate on metadata._type to learn more about the tyoe of documents found in this collection"
              } else {
                collections[i].description_for_model = "Use getquery to get a few documents and inspect all properties, then use aggregate on _type to learn more about the tyoe of documents found in this collection"
              }
              break;
          }
        }
        Logger.instanse.debug("Returned " + collections.length + " collections to OpenAI", null, { cls: "OpenAPIProxy" });
        res.json(collections);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });
    app.post("/rest2/v1/aggregate/:collection", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["Aggregate"]
      // #swagger.operationId = "postaggregate"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Run the mongodb aggregate pipeline on a collection. Plugin supports all MongoDB aggregation stages, not just $group for instance $match, $project, $unwind, $sort, $limit and many more."
      /*
      #swagger.parameters["queryas"] = {
          in: "query",
          description: "Make query on behalf of a, using the _id of a specefic user, customer, role, agent or robot.",
          required: false
      }
      */

      Logger.instanse.debug("[POST] /rest/v1/aggregate/" + req.params.collection, null, { cls: "OpenAPIProxy" });
      try {
        if (req.params.collection == null || req.params.collection == "") {
          Logger.instanse.error("Missing collection name", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Missing collection name" });
          return;
        }
        if (collections.find(c => c.name == req.params.collection) == null) {
          Logger.instanse.error("Collection " + req.params.collection + " not found", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Collection " + req.params.collection + " not found" });
          return;
        }
        var jwt = await OpenAPIProxy.GetToken(req);

        var queryas: string = req.query.queryas as any;
        if (queryas == null) queryas = "";

        var pipeline: any = req.body.pipeline;
        if (pipeline == null || pipeline == "") pipeline = [];
        if (typeof pipeline === "string" || (pipeline instanceof String)) {
          pipeline = hjson.parse(pipeline as any);
        }
        var results = await Config.db.aggregate<any>(pipeline, req.params.collection, jwt, null, queryas, false, null);
        Logger.instanse.debug("Returned " + results.length + " results for pipeline: " + JSON.stringify(pipeline) + " from collection " + req.params.collection, null, { cls: "OpenAPIProxy" });
        for (var i = 0; i < results.length; i++) {
          delete results[i]._acl;
          delete results[i].roles;
          delete results[i].nodered;
        }
        res.json(results);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });
    app.get("/rest2/v1/query/:collection", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["Query"]
      // #swagger.operationId = "getquery"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Return a list of objects from a collection. Use top and skip to page results. Use query to filter results. All mongodb operators are supported, inclduing but not limited to $and, $or, $in, $nin."

      /*
      #swagger.parameters["query"] = {
          in: "query",
          description: "Filter result based on a mongodb query, query can be on any field, including name, _id, _type, _createdby, _createdbyid, _created, _modifiedby, _modifiedbyid, _modified, _version but wil always contain more data related to the _type so roles have a members, users have username and email, openrpa workflows will have a projectid and so on ",
          required: false

      }
      #swagger.parameters["projection"] = {
          in: "query",
          description: "Use projection on result from database. use this to limit the amount of fields returned. Example: {name: 1, _id: 1} will only return name and _id fields.",
          required: false

      }
      
      #swagger.parameters["top"] = {
          in: "query",
          description: "Return the top X results, by default it will return top 10",
          required: false,
          "schema": { "type": "number" }
      }
      #swagger.parameters["skip"] = {
          in: "query",
          description: "Skip X results, by default it will skip 0, used for pagination",
          required: false,
          "schema": { "type": "number" }
      }
      #swagger.parameters["queryas"] = {
          in: "query",
          description: "Make query on behalf of a, using the _id of a specefic user, customer, role, agent or robot.",
          required: false,
          "schema": { "type": "string" }
      }

      #swagger.responses[200] = {
          description: "Array of objects, each object will have many different properties depending on the collection, but all objects will have the following properties: name, _id, _type, _createdby, _createdbyid, _created, _modifiedby, _modifiedbyid, _modified, _version"
      }
      */
      Logger.instanse.debug("[GET] /rest/v1/query/" + req.params.collection, null, { cls: "OpenAPIProxy" });
      try {
        if (req.params.collection == null || req.params.collection == "") {
          Logger.instanse.error("Missing collection name", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Missing collection name" });
          return;
        }
        if (collections.find(c => c.name == req.params.collection) == null) {
          Logger.instanse.error("Collection " + req.params.collection + " not found", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Collection " + req.params.collection + " not found" });
          return;
        }
        var jwt = await OpenAPIProxy.GetToken(req);
        var query: any = req.query.query;
        if (query == null || query == "") query = {};
        if (typeof query === "string" || (query instanceof String)) {
          query = hjson.parse(query as any);
        }

        if (query.type != null && query._type == null) {
          query._type = query.type;
          delete query.type;
        }
        if (query._type != null) {
          query._type = query._type.toLowerCase();
        }

        var projection = null;
        if (req.query.projection != null) {
          projection = req.query.projection;
          if (typeof projection === "string" || (projection instanceof String)) {
            projection = hjson.parse(projection as any);
          }
        }
        var top: number = req.query.top as any;
        if (top == null) top = 5;
        top = parseInt(top as any);
        var skip: number = req.query.skip as any;
        if (skip == null) skip = 0;
        skip = parseInt(skip as any);

        var queryas: string = req.query.queryas as any;
        if (queryas == null) queryas = "";


        var results = await Config.db.query({ collectionname: req.params.collection, jwt: jwt, query, top, skip, projection, queryas }, null);
        Logger.instanse.debug("Returned " + results.length + " results for query: " + JSON.stringify(query) + " top: " + top + " skip: " + skip + " from collection " + req.params.collection + " on behalf of " + queryas, null, { cls: "OpenAPIProxy" });
        for (var i = 0; i < results.length; i++) {
          delete results[i]._acl;
        }
        res.json(results);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });
    app.get("/rest2/v1/count/:collection", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["Count"]
      // #swagger.operationId = "getcount"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Return the number of objects in a  collection. Use query to filter results. All mongodb operators are supported, inclduing but not limited to $and, $or, $in, $nin."

      /*
      #swagger.parameters["query"] = {
          in: "query",
          description: "Filter result based on a mongodb query, query can be on any field, including name, _id, _type, _createdby, _createdbyid, _created, _modifiedby, _modifiedbyid, _modified, _version but wil always contain more data related to the _type so roles have a members, users have username and email, openrpa workflows will have a projectid and so on ",
          required: false

      }

      #swagger.responses[200] = {
          description: "Array of objects, each object will have many different properties depending on the collection, but all objects will have the following properties: name, _id, _type, _createdby, _createdbyid, _created, _modifiedby, _modifiedbyid, _modified, _version"
      }
      */
      Logger.instanse.debug("[GET] /rest/v1/count/" + req.params.collection, null, { cls: "OpenAPIProxy" });
      try {
        if (req.params.collection == null || req.params.collection == "") {
          Logger.instanse.error("Missing collection name", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Missing collection name" });
          return;
        }
        if (collections.find(c => c.name == req.params.collection) == null) {
          Logger.instanse.error("Collection " + req.params.collection + " not found", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Collection " + req.params.collection + " not found" });
          return;
        }
        var jwt = await OpenAPIProxy.GetToken(req);
        var query: any = req.query.query;
        if (query == null || query == "") query = {};
        if (typeof query === "string" || (query instanceof String)) {
          query = hjson.parse(query as any);
        }

        if (query.type != null && query._type == null) {
          query._type = query.type;
          delete query.type;
        }
        if (query._type != null) {
          query._type = query._type.toLowerCase();
        }


        var result = await Config.db.count({ collectionname: req.params.collection, jwt: jwt, query }, null);
        Logger.instanse.debug("Returned " + result + " results for query: " + JSON.stringify(query) + " from collection " + req.params.collection, null, { cls: "OpenAPIProxy" });
        res.json(result);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });
    app.get("/rest2/v1/distinct/:collection", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["Distinct"]
      // #swagger.operationId = "getdistinct"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Return a list of distinct values from a collection. Use top and skip to page results. Use query to filter results. All mongodb operators are supported, inclduing but not limited to $and, $or, $in, $nin."

      /*
      #swagger.parameters["field"] = {
          in: "query",
          description: "Field to return distinct values from",
          required: true

      }
      #swagger.parameters["query"] = {
          in: "query",
          description: "Filter result based on a mongodb query, query can be on any field, including name, _id, _type, _createdby, _createdbyid, _created, _modifiedby, _modifiedbyid, _modified, _version but wil always contain more data related to the _type so roles have a members, users have username and email, openrpa workflows will have a projectid and so on ",
          required: false

      }

      #swagger.responses[200] = {
          description: "Array of strings with the distinct values"
      }
      */
      Logger.instanse.debug("[GET] /rest/v1/distinct/" + req.params.collection, null, { cls: "OpenAPIProxy" });
      try {
        if (req.params.collection == null || req.params.collection == "") {
          Logger.instanse.error("Missing collection name", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Missing collection name" });
          return;
        }
        if (collections.find(c => c.name == req.params.collection) == null) {
          Logger.instanse.error("Collection " + req.params.collection + " not found", null, { cls: "OpenAPIProxy" });
          res.status(500).json({ error: "Collection " + req.params.collection + " not found" });
          return;
        }
        var jwt = await OpenAPIProxy.GetToken(req);
        var query: any = req.query.query;
        if (query == null || query == "") query = {};
        if (typeof query === "string" || (query instanceof String)) {
          query = hjson.parse(query as any);
        }

        if (query.type != null && query._type == null) {
          query._type = query.type;
          delete query.type;
        }
        if (query._type != null) {
          query._type = query._type.toLowerCase();
        }

        var projection = null;
        if (req.query.projection != null) {
          projection = req.query.projection;
          if (typeof projection === "string" || (projection instanceof String)) {
            projection = hjson.parse(projection as any);
          }
        }
        var field: string = req.query.column as any;

        var results = await Config.db.distinct({ collectionname: req.params.collection, jwt: jwt, query, field, queryas: null }, null);
        Logger.instanse.debug("Returned " + results.length + " results for query: " + JSON.stringify(query) + " field: " + field + " from collection " + req.params.collection, null, { cls: "OpenAPIProxy" });
        res.json(results);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });
    app.get("/rest2/v1/rpaworkflows", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["OpenRPA", "workflows"]
      // #swagger.operationId = "getrpaworkflows"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Return a list of OpenRPA workflows. If UserID was supplied will filter the list of workflow for those aviable to that user"

      /*
      #swagger.parameters["userid"] = {
          in: "query",
          description: "Filter list of workflows for those aviable to user",
          required: false

      }
      #swagger.responses[200] = {
          description: "Array of workflows"
      }
      */
      Logger.instanse.debug("[GET] /rest/v1/rpaworkflows", null, { cls: "OpenAPIProxy" });
      try {
        var jwt = await OpenAPIProxy.GetToken(req);
        var queryas: string = req.query.userid as any;
        if (queryas == null) queryas = "";

        var results = await Config.db.query({ collectionname: "openrpa", query: { "_type": "workflow" }, top: 1000, projection: { name: 1, projectandname: 1, Parameters: 1 }, queryas, jwt }, null);
        Logger.instanse.debug("Returned " + results.length + " results for query: " + JSON.stringify(queryas) + " from collection openrpa", null, { cls: "OpenAPIProxy" });
        res.json(results);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/rest2/v1/invokeopenrpa", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["Aggregate"]
      // #swagger.operationId = "invokeopenrpa"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Execute a workflow on a OpenRPA robot. If rpc is true, will wait for reply and return reply ( this can take a long time !)"
      /*
          #swagger.parameters["body"] = {
              in: "body",
              description: "JSON object containing user and workflow information",
              required: true,
              schema: {
                  robotid: {
                      type: "string",
                      description: "_id or username of a robot, robot is found in users collection with _tyoe=user",
                  },
                  workflowid: {
                      type: "string",
                      description: "_id or username of a robot, robot is found in users collection with _tyoe=user",
                  },
                  rpc: {
                      type: "boolean",
                      description: "A Boolean indicating if the call should be synchronous or asynchronous, default is false",
                  },
                  parameters: {
                      type: "object",
                      properties: {
                          argument1: {
                              type: "string",
                              description: "Value for argument1",
                          },
                          argument2: {
                              type: "string",
                              description: "Value for argument2",
                          },
                      },
                  },
              },
          }
          */

      Logger.instanse.debug("[POST] /rest/v1/invokeopenrpa", null, { cls: "OpenAPIProxy" });
      let body = req.body;
      if (body != null && body.body != null) body = body.body;
      try {
        var jwt = await OpenAPIProxy.GetToken(req);
        var result = { status: "ok", reply: undefined, error: undefined }
        if (typeof body === "string" || (body instanceof String)) {
          body = hjson.parse(body as any);
        }

        if (body.parameters === null || body.parameters === undefined) { body.parameters = {}; }
        body.rpc = Config.parseBoolean(body.rpc as any);
        const rpacommand = {
          command: "invoke",
          workflowid: body.workflowid,
          data: body.parameters
        }
        var robotuser = await Config.db.getbyid(body.userid, "users", jwt, true, null)
        if (robotuser == null) {
          robotuser = await Config.db.GetOne({
            collectionname: "users", query: {
              "_type": "user",
              "$or": [{ "name": { "$regex": "^" + body.userid + ".$", "$options": "i" } },
              { "username": { "$regex": "^" + body.userid + ".$", "$options": "i" } }]
            }, jwt
          }, null);
        }
        var workflow = await Config.db.getbyid(body.workflowid, "openrpa", jwt, true, null)
        if (workflow == null) {
          workflow = await Config.db.GetOne({
            collectionname: "openrpa", query: {
              "_type": "workflow",
              "$or": [{ "name": { "$regex": "^" + body.workflowid + ".$", "$options": "i" } },
              { "projectandname": { "$regex": "^" + body.workflowid + ".$", "$options": "i" } }]
            }, jwt
          }, null);
        }
        if (robotuser == null) {
          result.status = "error";
          result.error = "No such robot, please make sure userid is a valid user _id from users collection";
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

    });
    app.post("/rest2/v1/send-to-messagequeue/:queue", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["MessageQueue", "amqp", "openrpa", "nodered", "agent"]
      // #swagger.operationId = "queuemessage"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Send message to a message queue. If rpc is truy, will wait for reply and return reply ( this can take a long time !)"

      /*
      #swagger.parameters["rpc"] = {
          in: "query",
          description: "If true, will wait for reply and send reply back to caller. This can take a long time !, default is false",
          required: false
      }
      #swagger.responses[200] = {
          description: "JSON response. If rpc is false, will return {status: "ok"} if message was sent to queue. If rpc is true, will return {status: "ok", reply: "reply from agent"}"
      }
      */
      Logger.instanse.debug("[POST] /rest/v1/send-to-messagequeue/" + req.params.queue, null, { cls: "OpenAPIProxy" });
      try {
        if (req.params.queue == null || req.params.queue == "") {
          res.status(500).json({ error: "Queue name is missing" });
          return;
        }
        const queuename = req.params.queue;

        var jwt = await OpenAPIProxy.GetToken(req);
        var payload: any = req.body;
        if (payload == null || payload == "") payload = {};
        if (typeof payload === "string" || (payload instanceof String)) {
          payload = hjson.parse(payload as any);
        }
        var rpc: boolean = req.query.rpc as any;
        if (rpc == null || (rpc as any) == "") rpc = false;
        rpc = Config.parseBoolean(rpc as any);

        var result = { status: "ok", reply: undefined }
        if (rpc == true) {
          const promise = OpenAPIProxy.createPromise();
          // @ts-ignore
          const correlationId = promise.correlationId;

          await amqpwrapper.Instance().sendWithReplyTo("", queuename, "openapi", payload, 5000, correlationId, "", null);
          result.reply = await promise;
        } else {
          const correlationId = NoderedUtil.GetUniqueIdentifier();
          await amqpwrapper.Instance().send("", queuename, payload, 5000, correlationId, "", null);
        }
        Logger.instanse.debug("Returned " + JSON.stringify(result) + " for payload: " + JSON.stringify(payload) + " to queue  " + req.params.queue, null, { cls: "OpenAPIProxy" });
        res.json(result);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }



    });
    app.get("/rest2/v1/workitemqueue", async (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.tags = ["WorkItemQueue"]
      // #swagger.operationId = "getworkitemqueues"
      // #swagger.security = [{ "OAuth2": [] }]
      // #swagger.summary = "Return a list of workitem queues. If queryas was supplied will filter the list of workitems for those aviable to that user/role/customer"

      /*
      #swagger.parameters["queues"] = {
          in: "query",
          description: "Filter list of workitems for those aviable to user/role/customer",
          required: false

      }
      #swagger.responses[200] = {
          description: "Array of workitemqueue"
      }
      */
      Logger.instanse.debug("[GET] /rest/v1/workitemqueue", null, { cls: "OpenAPIProxy" });
      try {
        var jwt = await OpenAPIProxy.GetToken(req);
        var queryas: string = req.query.userid as any;
        if (queryas == null) queryas = "";

        var results = await Config.db.query({ collectionname: "mq", query: { "_type": "workitemqueue" }, top: 1000, projection: {}, queryas, jwt }, null);
        Logger.instanse.debug("Returned " + results.length + " workitemqueues", null, { cls: "OpenAPIProxy" });
        res.json(results);
      } catch (error) {
        Logger.instanse.error(error, null, { cls: "OpenAPIProxy" });
        res.status(500).json({ error: error.message });
      }
    });

    // var paths = Object.keys(schema.paths)
    // for (let i = 0; i < paths.length; i++) {
    //     var path = paths[i]
    //     const removeendpoints = [
    //         "/rest/v1/SetupStream",
    //         "/rest/v1/Signin",
    //         "/rest/v1/Download",
    //         "/rest/v1/Upload"
    //     ]
    //     if (removeendpoints.includes(path)) {
    //         delete schema.paths[path];
    //         continue;
    //     }
    //     var methods = Object.keys(schema.paths[path])
    //     for (var j = 0; j < methods.length; j++) {
    //         const methodkey = methods[j];
    //         const method = schema.paths[path][methodkey];
    //         var parameters = schema.paths[path][methodkey].parameters
    //         method.operationId =  method.operationId.replace("openiap.FlowService.", "");
    //         method.security = [
    //           {
    //             OAuth2: [],
    //           },
    //         ];

    //         if (parameters != null) {
    //             for (var n = parameters.length - 1; n >= 0; n--) {
    //                 var param = parameters[n];
    //                 if (param.name == "authorization" || param.in == "header") {
    //                     // remove
    //                     parameters.splice(n, 1);
    //                 }
    //                 param.required = true;
    //             }
    //         }
    //     }
    // }

    var url = Config.externalbaseurl()
    if (Config.domain == "localhost" && Config.port != 80) {
      url = "http://" + Config.domain + ":" + Config.port
    }
    if (url.endsWith("/")) {
      url = url.substring(0, url.length - 1)
    }
    Logger.instanse.debug("Updating servers to " + url, null, { cls: "OpenAPIProxy" });
    // schema["servers"] = [{ url }]
    schema2["servers"] = [{ url }]
    // @ts-ignore
    let components:any = schema2?.components;
    if(components?.securitySchemes?.oidc?.openIdConnectUrl != null) {
      components.securitySchemes.oidc.openIdConnectUrl = Config.baseurl() + "oidc/.well-known/openid-configuration";
    }
    var options = {
      explorer: true
    };

    app.use("/docs", swaggerUi.serve, async (_req: any, res: any) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      Logger.instanse.debug("Serving /docs", null, { cls: "OpenAPIProxy" });
      return res.send(
        swaggerUi.generateHTML(schema2)
      );
    });
    app.get("/openapi.json", (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.ignore = true
      Logger.instanse.debug("[GET] /openapi.json", null, { cls: "OpenAPIProxy" });
      // res.json(schema);
      res.json(schema2);
    });
    app.get("/swagger_output.json", (req, res) => {
      if(Config.enable_openapi == false) return res.status(404).json({ error: "openapi not enabled" });
      // #swagger.ignore = true
      Logger.instanse.debug("[GET] /swagger_output.json", null, { cls: "OpenAPIProxy" });
      // res.json(schema);
      res.json(schema2);
    });

  } // constructor
  static async GetToken(req) {
    let authorization = "";
    let jwt = "";
    if (req.headers["authorization"]) {
      // authorization = req.headers["authorization"].replace("Bearer ", "");
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
  } // GetToken

} // class
