import { Base, NoderedUser, NoderedUtil, ResourceUsage, TokenUser } from "@openiap/openflow-api";
import { iAgent, i_nodered_driver } from "./commoninterfaces";
import { Logger } from "./Logger";
import { Span } from "@opentelemetry/api";
import { Crypt } from "./Crypt";
import { Config } from "./Config";
import * as url from "url";
const Docker = require("dockerode");
import Dockerode = require("dockerode");
export class dockerdriver implements i_nodered_driver {
    public async detect(): Promise<boolean> {
        try {
            const docker = new Docker();
            await docker.listContainers();
            return true;
        } catch (error) {
            Logger.instanse.info("Docker not detected: " + error.message, null);
            // Logger.instanse.error(error, null);
        }
        return false;
    }
    public async EnsureNoderedInstance(jwt: string, tuser: TokenUser, _id: string, name: string, skipcreate: boolean, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.EnsureNoderedInstance", parent);
        Logger.instanse.debug("[" + tuser.username + "] EnsureNoderedInstance", span);
        if (_id === null || _id === undefined || _id === "") _id = tuser._id;

        const users = await Config.db.query<NoderedUser>({ query: { _id: _id }, top: 1, collectionname: "users", jwt: jwt }, span);
        if (users.length == 0) {
            throw new Error("Unknown userid " + _id);
        }
        const user: NoderedUser = NoderedUser.assign(users[0]);

        const docker: Dockerode = new Docker();
        const myhostname = require('os').hostname();
        let me = null;
        let list = await docker.listContainers({ all: 1 });
        let instance: any = null;
        for (let item of list) {
            var Created = new Date(item.Created * 1000);
            (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
            (item as any).status = { phase: item.State }
            if (item.Names[0] == "/" + name) {
                instance = item;
            }
            if (item.Names[0] == "/" + myhostname || item.Id.startsWith(myhostname)) {
                me = item;
            }
            if (me == null && item.Labels["com.docker.compose.project"] == Config.namespace) {
                me = item;
            }
        }

        if (NoderedUtil.IsNullUndefinded(instance)) {

            let nodered_domain_schema = Config.nodered_domain_schema;
            if (NoderedUtil.IsNullEmpty(nodered_domain_schema)) {
                nodered_domain_schema = "$nodered_id$." + Config.domain;
            }
            const hostname = nodered_domain_schema.replace("$nodered_id$", name);


            let nodered_image_name = Config.nodered_images[0].name;
            let tzvolume: string = null;
            let tz: string = undefined;
            if (user.nodered) {
                try {
                    if (user.nodered.api_allow_anonymous == null) user.nodered.api_allow_anonymous = false;
                    if (user.nodered.function_external_modules == null) user.nodered.function_external_modules = false;
                    if (user.nodered.nodered_image_name == null) user.nodered.nodered_image_name = nodered_image_name;
                    if (!NoderedUtil.IsNullEmpty(user.nodered.tz)) {
                        tz = user.nodered.tz;
                        tzvolume = "/usr/share/zoneinfo/" + user.nodered.tz
                    }
                } catch (error) {
                    user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
                }
            } else {
                user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
            }
            const _nodered_image = Config.nodered_images.filter(x => x.name == user.nodered.nodered_image_name);
            let nodered_image = Config.nodered_images[0].image;
            if (_nodered_image.length == 1) { nodered_image = _nodered_image[0].image; }

            let hasbilling: boolean = false;
            let assigned = await Config.db.GetResourceUserUsage("Nodered Instance", user._id, span);
            if (assigned != null) {
                hasbilling = true;
            }


            // "com.docker.compose.project": Config.namespace,
            // "com.docker.compose.service": Config.namespace,
            const Labels = {
                "userid": _id,
                "billed": hasbilling.toString(),
            };
            let NetworkingConfig: Dockerode.EndpointsConfig = undefined;
            let HostConfig: Dockerode.HostConfig = undefined;
            HostConfig = {};
            if (me != null) {
                if (Config.nodered_docker_use_project) {
                    if (me.Labels["com.docker.compose.config-hash"]) Labels["com.docker.compose.config-hash"] = me.Labels["com.docker.compose.config-hash"];
                    if (me.Labels["com.docker.compose.project"]) Labels["com.docker.compose.project"] = me.Labels["com.docker.compose.project"];
                    if (me.Labels["com.docker.compose.project.config_files"]) Labels["com.docker.compose.project.config_files"] = me.Labels["com.docker.compose.project.config_files"];
                    if (me.Labels["com.docker.compose.project.working_dir"]) Labels["com.docker.compose.project.working_dir"] = me.Labels["com.docker.compose.project.working_dir"];
                    if (me.Labels["com.docker.compose.service"]) Labels["com.docker.compose.service"] = me.Labels["com.docker.compose.service"];
                    if (me.Labels["com.docker.compose.version"]) Labels["com.docker.compose.version"] = me.Labels["com.docker.compose.version"];
                }
                if (me.NetworkSettings && me.NetworkSettings.Networks) {
                    const keys = Object.keys(me.NetworkSettings.Networks);
                    HostConfig.NetworkMode = keys[0];
                }
            }
            // docker-compose -f docker-compose-traefik.yml -p demo up -d
            Labels["traefik.enable"] = "true";
            Labels["traefik.http.routers." + name + ".entrypoints"] = Config.nodered_docker_entrypoints;
            Labels["traefik.http.routers." + name + ".rule"] = "Host(`" + hostname + "`)";
            Labels["traefik.http.services." + name + ".loadbalancer.server.port"] = Config.port.toString();
            if (!NoderedUtil.IsNullEmpty(Config.nodered_docker_certresolver)) {
                Labels["traefik.http.routers." + name + ".tls.certresolver"] = Config.nodered_docker_certresolver;
            }
            let openiapagent = nodered_image;
            if(openiapagent.indexOf(":")> - 1) openiapagent = openiapagent.substring(0, openiapagent.indexOf(":"))
            if(openiapagent.indexOf("/")> - 1) openiapagent = openiapagent.substring(openiapagent.lastIndexOf("/") + 1)
            Labels["openiapagent"] = openiapagent;

            // HostConfig.PortBindings = { "5859/tcp": [{ HostPort: '5859' }] }

            let api_ws_url = Config.basewsurl();
            if (!NoderedUtil.IsNullEmpty(Config.api_ws_url)) api_ws_url = Config.api_ws_url;
            if (!NoderedUtil.IsNullEmpty(Config.nodered_ws_url)) api_ws_url = Config.nodered_ws_url;
            if (!api_ws_url.endsWith("/")) api_ws_url += "/";

            const nodereduser = await Logger.DBHelper.FindById(_id, span);
            const tuser: TokenUser = TokenUser.From(nodereduser);
            const nodered_jwt: string = Crypt.createToken(tuser, Config.personalnoderedtoken_expires_in);

            var saml_federation_metadata = Config.saml_federation_metadata;
            if (saml_federation_metadata == "https://pc.openiap.io/issue/FederationMetadata/2007-06/FederationMetadata.xml") {
                saml_federation_metadata = "https://demo.openiap.io/issue/FederationMetadata/2007-06/FederationMetadata.xml"
            }

            await Logger.DBHelper.EnsureNoderedRoles(tuser, jwt, true, span);
            let saml_baseurl = Config.protocol + "://" + hostname + "/";
            let _samlparsed = url.parse(saml_federation_metadata);
            if (_samlparsed.protocol == "http:" || _samlparsed.protocol == "ws:") {
                saml_baseurl = "http://" + hostname
                if (_samlparsed.port && _samlparsed.port != "80" && _samlparsed.port != "3000") {
                    saml_baseurl += ":" + _samlparsed.port;
                }
            } else {
                saml_baseurl = "https://" + hostname
                if (_samlparsed.port && _samlparsed.port != "443" && _samlparsed.port != "3000") {
                    saml_baseurl += ":" + _samlparsed.port;
                }
            }
            saml_baseurl += "/";
            // https://demo.openiap.io/issue
            // "saml_baseurl=" + saml_baseurl,
            var nodered_saml_entrypoint = saml_federation_metadata.split("/FederationMetadata/2007-06/FederationMetadata.xml").join("");
            if (!NoderedUtil.IsNullEmpty(Config.nodered_saml_entrypoint)) nodered_saml_entrypoint = Config.nodered_saml_entrypoint
            // "saml_entrypoint=" + Config.baseurl() + 'issue',
            const Env = [
                "saml_federation_metadata=" + saml_federation_metadata,
                "saml_issuer=" + Config.saml_issuer,
                "saml_entrypoint=" + nodered_saml_entrypoint,
                "nodered_id=" + name,
                "nodered_sa=" + nodereduser.username,
                "jwt=" + nodered_jwt,
                "queue_prefix=" + user.nodered.queue_prefix,
                "api_ws_url=" + api_ws_url,
                "domain=" + hostname,
                "protocol=" + Config.protocol,
                "port=" + Config.port.toString(),
                "noderedusers=" + (name + "noderedusers"),
                "noderedadmins=" + (name + "noderedadmins"),
                "noderedapiusers=" + (name + "nodered api users"),
                "api_allow_anonymous=" + user.nodered.api_allow_anonymous.toString(),
                "function_external_modules=" + user.nodered.function_external_modules.toString(),
                "otel_measure_nodeid=" + Config.otel_measure_nodeid.toString(),
                "otel_measure_queued_messages=" + Config.otel_measure_queued_messages.toString(),
                "NODE_ENV=" + Config.NODE_ENV,
                "HTTP_PROXY=" + Config.HTTP_PROXY,
                "HTTPS_PROXY=" + Config.HTTPS_PROXY,
                "NO_PROXY=" + Config.NO_PROXY,
                "otel_expose_metric=" + "false",
                "enable_analytics=" + Config.enable_analytics.toString(),
                "tours=" + Config.enable_nodered_tours.toString(),
                "otel_trace_url=" + Config.otel_trace_url,
                "otel_metric_url=" + Config.otel_metric_url,
                "otel_trace_interval=" + Config.otel_trace_interval.toString(),
                "otel_metric_interval=" + Config.otel_metric_interval.toString(),
                "amqp_enabled_exchange=" + Config.amqp_enabled_exchange.toString(),
                "noderedcatalogues=" + Config.noderedcatalogues,
                "log_with_colors=" + Config.log_with_colors.toString(),
                "TZ=" + tz,
                "allow_start_from_cache=false"
            ]

            if (tzvolume != null) {
                HostConfig.Binds = ["/etc/localtime", tzvolume]
            }
            await this._pullImage(docker, nodered_image, span);
            instance = await docker.createContainer({
                Image: nodered_image, name, Labels, Env, NetworkingConfig, HostConfig
            })
            await instance.start();
        } else {
            const container = docker.getContainer(instance.Id);
            if (instance.State != "running") {
                container.start();
            }

        }
    }
    public async GetNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, parent: Span): Promise<any[]> {
        const span: Span = Logger.otel.startSubSpan("message.EnsureNoderedInstance", parent);
        const rootjwt = Crypt.rootToken()
        const rootuser = TokenUser.From(Crypt.rootUser());
        try {
            const noderedresource: any = await Config.db.GetResource("Nodered Instance", span);
            let runtime: number = noderedresource?.defaultmetadata?.runtime_hours;
            if (NoderedUtil.IsNullUndefinded(runtime)) {
                // If nodered resource does not exists, dont turn off nodereds
                runtime = 0;
                // If nodered resource does exists, but have no default, use 24 hours
                if (!NoderedUtil.IsNullUndefinded(noderedresource)) runtime = 24;
            }

            span?.addEvent("init Docker()");
            const docker = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            var result = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                item.metadata = { creationTimestamp: Created, name: (item.Names[0] as string).substr(1) };
                item.status = { phase: item.State }
                const image = item.Image;
                const userid = item.Labels["userid"];
                const billed = item.Labels["billed"];
                let deleted: boolean = false;
                if ((image.indexOf("openflownodered") > -1 || image.indexOf("openiap/nodered") > -1) && !NoderedUtil.IsNullEmpty(userid)) {
                    if (!NoderedUtil.IsNullUndefinded(noderedresource) && runtime > 0) {
                        const date = new Date();
                        const a: number = (date as any) - (Created as any);
                        const diffhours = a / (1000 * 60 * 60);
                        if (billed != "true" && diffhours > runtime) {
                            Logger.instanse.warn("[" + tokenUser.username + "] Remove un billed nodered instance " + name + " that has been running for " + diffhours + " hours", span);
                            await this.DeleteNoderedInstance(rootjwt, rootuser, _id, name, span);
                            deleted = true;
                        }
                    }
                    if (item.Names[0] == "/" + name && deleted == false) {
                        span?.addEvent("getContainer(" + item.Id + ")");
                        const container = docker.getContainer(item.Id);
                        span?.addEvent("stats()");
                        var stats = await container.stats({ stream: false });
                        let cpu_usage: 0;
                        let memory: 0;
                        let memorylimit: 0;
                        if (stats && stats.cpu_stats && stats.cpu_stats.cpu_usage && stats.cpu_stats.cpu_usage.usage_in_usermode) cpu_usage = stats.cpu_stats.cpu_usage.usage_in_usermode;
                        if (stats && stats.memory_stats && stats.memory_stats.usage) memory = stats.memory_stats.usage;
                        if (stats && stats.memory_stats && stats.memory_stats.limit) memorylimit = stats.memory_stats.limit;
                        item.metrics = {
                            cpu: parseFloat((cpu_usage / 1024 / 1024).toString()).toFixed(2) + "n",
                            memory: parseFloat((memory / 1024 / 1024).toString()).toFixed(2) + "Mi",
                            memorylimit: parseFloat((memorylimit / 1024 / 1024).toString()).toFixed(2) + "Mi"
                        };
                        result.push(item);
                    }
                }
            }
            return result;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RestartNoderedInstance(jwt: string, tuser: TokenUser, _id: string, name: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.DockerRestartNoderedInstance", parent);
        try {
            span?.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            var instance = null;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + name) {
                    instance = item;
                }
            }
            if (instance != null) {
                span?.addEvent("getContainer(" + instance.Id + ")");
                const container = docker.getContainer(instance.Id);
                if (instance.State == "running") await container.stop({t: 0});
                await container.restart();
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async _pullImage(docker: Dockerode, imagename: string, span: Span) {
        var imageep = docker.getImage(imagename)
        var image
        try {
            image = await imageep.inspect()
        } catch (error) {
        }
        if(image == null) {
            console.log("Pull image " + imagename)
            await docker.pull(imagename)
        }
        // return new Promise<void>((resolve, reject) => {
        //     docker.pull(imagename, function (err, stream) {
        //         if (err)
        //             return reject(err);

        //         docker.modem.followProgress(stream, onFinished, onProgress);

        //         function onFinished(err2, output) {
        //             Logger.instanse.debug(output, span);
        //             if (err2) {
        //                 Logger.instanse.error(err2, null);
        //                 return reject(err2);
        //             }
        //             return resolve();
        //         }
        //         function onProgress(event) {
        //             Logger.instanse.debug(event, span);
        //         }
        //     });
        // })
    }
    public async GetNoderedInstanceLog(jwt: string, user: TokenUser, _id: string, name: string, podname: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstanceLog", parent);
        try {
            var result: string = null;
            const docker: Dockerode = new Docker();
            let me = null;
            let list = await docker.listContainers({ all: 1 });
            let instance: Dockerode.ContainerInfo = null;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
                (item as any).status = { phase: item.State }
                if (item.Names[0] == "/" + podname) {
                    instance = item;
                }
            }
            if (instance != null) {
                var logOpts = {
                    stdout: 1,
                    stderr: 1,
                    tail: 50,
                    follow: 0
                };
                const container = docker.getContainer(instance.Id);
                var s = await container.logs((logOpts as any) as Dockerode.ContainerLogsOptions);
                result = s.toString();
            }
            if (result == null) result = "";
            return result;
        } finally {
            Logger.otel.endSpan(span);
        }

    }
    public async DeleteNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, parent: Span): Promise<void> {
        this.DeleteNoderedPod(jwt, tokenUser, _id, name, null, parent);
    }
    public async DeleteNoderedPod(jwt: string, user: TokenUser, _id: string, name: string, podname: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.dockerDeleteNoderedPod", parent);
        try {
            Logger.instanse.debug("[" + user.username + "] dockerDeleteNoderedPod", span);

            if (NoderedUtil.IsNullEmpty(podname)) podname = name;

            span?.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + podname) {
                    span?.addEvent("getContainer(" + item.Id + ")");
                    const container = docker.getContainer(item.Id);
                    if (item.State == "running") await container.stop({t: 0});
                    span?.addEvent("remove()");
                    await container.remove();
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async NodeLabels(parent: Span): Promise<any> {
        return null;
    }

    public async EnsureInstance(tokenUser: TokenUser, jwt: string, agent: iAgent, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.EnsureInstance", parent);
        Logger.instanse.debug("[" + agent.slug + "] EnsureInstance", span);

        var apiurl = "grpc://api:50051"
        if(Config.domain == "pc.openiap.io") apiurl = "grpc://grpc.demo.openiap.io:443"
        let hasbilling = false;

        var agentjwt = "";
        if(NoderedUtil.IsNullEmpty(agent.runas)) {
            agentjwt = Crypt.createToken(tokenUser, Config.personalnoderedtoken_expires_in);
        } else {
            var agentuser = await Config.db.GetOne<any>({ query: { _id: agent.runas }, collectionname: "users", jwt }, parent);
            if(agentuser!= null){
                agentuser = TokenUser.From(agentuser);
                agentjwt = Crypt.createToken(agentuser, Config.personalnoderedtoken_expires_in);
            } else {
                agentjwt = Crypt.createToken(tokenUser, Config.personalnoderedtoken_expires_in);
            }
        }

        const docker: Dockerode = new Docker();
        const myhostname = require('os').hostname();
        let me = null;
        let list = await docker.listContainers({ all: 1 });
        let instance: any = null;
        for (let item of list) {
            var Created = new Date(item.Created * 1000);
            (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
            (item as any).status = { phase: item.State }
            if (item.Names[0] == "/" + agent.slug || item.Labels["agentid"] == agent._id) {
                instance = item;
            }
            if (item.Names[0] == "/" + myhostname || item.Id.startsWith(myhostname)) {
                me = item;
            }
            if (me == null && item.Labels["com.docker.compose.project"] == Config.namespace) {
                me = item;
            }
        }

        if (NoderedUtil.IsNullUndefinded(instance)) {

            let domain_schema = Config.nodered_domain_schema;
            if (NoderedUtil.IsNullEmpty(domain_schema)) {
                domain_schema = "$nodered_id$." + Config.domain;
            }
            domain_schema = domain_schema.split("$nodered_id$").join("$slug$")
            const hostname = domain_schema.replace("$slug$", agent.slug);

            let tzvolume: string = null;
            if (!NoderedUtil.IsNullEmpty(agent.tz)) {
                tzvolume = "/usr/share/zoneinfo/" + agent.tz
            }
            const Labels = {
                "billed": hasbilling.toString(),
                "agentid": agent._id
            };
            let NetworkingConfig: Dockerode.EndpointsConfig = undefined;
            let HostConfig: Dockerode.HostConfig = undefined;
            HostConfig = {};
            if (me != null) {
                if (Config.nodered_docker_use_project) {
                    if (me.Labels["com.docker.compose.config-hash"]) Labels["com.docker.compose.config-hash"] = me.Labels["com.docker.compose.config-hash"];
                    if (me.Labels["com.docker.compose.project"]) Labels["com.docker.compose.project"] = me.Labels["com.docker.compose.project"];
                    if (me.Labels["com.docker.compose.project.config_files"]) Labels["com.docker.compose.project.config_files"] = me.Labels["com.docker.compose.project.config_files"];
                    if (me.Labels["com.docker.compose.project.working_dir"]) Labels["com.docker.compose.project.working_dir"] = me.Labels["com.docker.compose.project.working_dir"];
                    if (me.Labels["com.docker.compose.service"]) Labels["com.docker.compose.service"] = me.Labels["com.docker.compose.service"];
                    if (me.Labels["com.docker.compose.version"]) Labels["com.docker.compose.version"] = me.Labels["com.docker.compose.version"];
                }
                if (me.NetworkSettings && me.NetworkSettings.Networks) {
                    const keys = Object.keys(me.NetworkSettings.Networks);
                    HostConfig.NetworkMode = keys[0];
                }
            }
            let openiapagent = agent.image;
            if(openiapagent.indexOf(":")> - 1) openiapagent = openiapagent.substring(0, openiapagent.indexOf(":"))
            if(openiapagent.indexOf("/")> - 1) openiapagent = openiapagent.substring(openiapagent.lastIndexOf("/") + 1)
            Labels["openiapagent"] = openiapagent;
            Labels["agentid"] = agent.agentid;
            if(agent.webserver) {
                Labels["traefik.enable"] = "true";
                Labels["traefik.http.routers." + agent.slug + ".entrypoints"] = Config.nodered_docker_entrypoints;
                Labels["traefik.http.routers." + agent.slug + ".rule"] = "Host(`" + hostname + "`)";
                Labels["traefik.http.services." + agent.slug + ".loadbalancer.server.port"] = Config.port.toString()
                if (!NoderedUtil.IsNullEmpty(Config.nodered_docker_certresolver)) {
                    Labels["traefik.http.routers." + agent.slug + ".tls.certresolver"] = Config.nodered_docker_certresolver;
                }
            }
            const Env = [
                "jwt=" + agentjwt,
                "apiurl=" + apiurl,
                "domain=" + hostname,
                "protocol=" + Config.protocol,
                "port=" + Config.port.toString(),
                "NODE_ENV=" + Config.NODE_ENV,
                "HTTP_PROXY=" + Config.HTTP_PROXY,
                "HTTPS_PROXY=" + Config.HTTPS_PROXY,
                "NO_PROXY=" + Config.NO_PROXY,
                "enable_analytics=" + Config.enable_analytics.toString(),
                "otel_trace_url=" + Config.otel_trace_url,
                "otel_metric_url=" + Config.otel_metric_url,
                "TZ=" + agent.tz,
                "log_with_colors=false",
                "oidc_config=" + Config.protocol + "://" + Config.domain + "/oidc/.well-known/openid-configuration",
            ]
            if(agent.environment != null) {
                var keys = Object.keys(agent.environment);
                for(var i = 0; i < keys.length; i++) {
                    var exists = Env.find(x => x.startsWith(keys[i] + "="));
                    if(exists == null) {
                        Env.push(keys[i] + "=" + agent.environment[keys[i]]);
                    }                    
                }
            }

            if (tzvolume != null) {
                HostConfig.Binds = ["/etc/localtime", tzvolume]
            }
            let Cmd:any = undefined;
            if(agent.sleep == true) {
                Cmd = ["/bin/sh", "-c", "while true; do echo sleep 10; sleep 10;done"]
            }
            await this._pullImage(docker, agent.image, span);
            instance = await docker.createContainer({
                Cmd, Image: agent.image, name: agent.slug, Labels, Env, NetworkingConfig, HostConfig
            })
            await instance.start();
        } else {
            const container = docker.getContainer(instance.Id);
            if (instance.State != "running") {
                container.start();
            }

        }
    }
    public async RemoveInstance(tokenUser: TokenUser, jwt: string, agent: iAgent, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.RemoveInstance", parent);
        try {
            Logger.instanse.debug("[" + agent.slug + "] RemoveInstance", span);

            span?.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + agent.slug || item.Labels["agentid"] == agent._id) {
                    span?.addEvent("getContainer(" + item.Id + ")");
                    const container = docker.getContainer(item.Id);
                    if (item.State == "running") await container.stop({t: 0});
                    span?.addEvent("remove()");
                    await container.remove();
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async GetInstanceLog(tokenUser: TokenUser, jwt: string, agent: iAgent, podname: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("message.GetInstanceLog", parent);
        try {
            var result: string = null;
            const docker: Dockerode = new Docker();
            let me = null;
            let list = await docker.listContainers({ all: 1 });
            let instance: Dockerode.ContainerInfo = null;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
                (item as any).status = { phase: item.State }
                if (item.Names[0] == "/" + podname || item.Labels["agentid"] == agent._id) {
                    instance = item;
                }
            }
            if (instance != null) {
                var logOpts = {
                    stdout: 1,
                    stderr: 1,
                    tail: 50,
                    follow: 0
                };
                const container = docker.getContainer(instance.Id);
                var s = await container.logs((logOpts as any) as Dockerode.ContainerLogsOptions);
                result = s.toString();
            }
            if (result == null) result = "";
            return result;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async InstanceCleanup(parent: Span): Promise<void> {
        const noderedresource: any = await Config.db.GetResource("Nodered Instance", parent);
        let runtime: number = noderedresource?.defaultmetadata?.runtime_hours;
        if (NoderedUtil.IsNullUndefinded(runtime)) {
            // If nodered resource does not exists, dont turn off nodereds
            runtime = 0;
            // If nodered resource does exists, but have no default, use 24 hours
            if (!NoderedUtil.IsNullUndefinded(noderedresource)) runtime = 24;
        }
        parent?.addEvent("init Docker()");
        const docker = new Docker();
        parent?.addEvent("listContainers()");
        var list = await docker.listContainers({ all: 1 });
        const rootjwt = Crypt.rootToken()
        const rootuser = TokenUser.From(Crypt.rootUser());
        var result = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            var Created = new Date(item.Created * 1000);
            item.metadata = { creationTimestamp: Created, name: (item.Names[0] as string).substr(1) };
            item.status = { phase: item.State }
            const image = item.Image;
            const openiapagent = item.Labels["openiapagent"];
            const billed = item.Labels["billed"];
            if (!NoderedUtil.IsNullEmpty(openiapagent)) {
                if (!NoderedUtil.IsNullUndefinded(noderedresource) && runtime > 0) {
                    const date = new Date();
                    const a: number = (date as any) - (Created as any);
                    const diffhours = a / (1000 * 60 * 60);
                    if (billed != "true" && diffhours > runtime) {
                        Logger.instanse.warn("[" + item.metadata.name + "] Remove un billed nodered instance " + item.metadata.name + " that has been running for " + diffhours + " hours", parent);
                        var agent = await Config.db.GetOne<iAgent>({ query: { slug: item.metadata.name }, collectionname: "agents", jwt: rootjwt }, parent);
                        if(agent != null) {
                            await this.RemoveInstance(rootuser, rootjwt, agent, parent);
                        } else {
                            Logger.instanse.debug("Cannot remove un billed instance " + item.metadata.name + " that has been running for " + diffhours + " hours, unable to find agent with slug " + item.metadata.name , parent, { user: item.metadata.name });
                        }
                    }
                }
            }
        }
    }
    public async GetInstancePods(tokenUser: TokenUser, jwt: string, agent: iAgent, getstats:boolean, parent: Span): Promise<any[]> {
        const span: Span = Logger.otel.startSubSpan("message.EnsureNoderedInstance", parent);
        try {

            span?.addEvent("init Docker()");
            const docker = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            var result = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                item.metadata = { creationTimestamp: Created, name: (item.Names[0] as string).substr(1) };
                item.status = { phase: item.State }
                const image = item.Image;
                const openiapagent = item.Labels["openiapagent"];
                const billed = item.Labels["billed"];
                let deleted: boolean = false;
                if (!NoderedUtil.IsNullEmpty(openiapagent)) {
                    if ((item.Names[0] == "/" + agent.slug || item.Labels["agentid"] == agent._id) && deleted == false) {
                        if(getstats) {
                            span?.addEvent("getContainer(" + item.Id + ")");
                            const container = docker.getContainer(item.Id);
                            span?.addEvent("stats()");
                            var stats = await container.stats({ stream: false });
                            let cpu_usage: 0;
                            let memory: 0;
                            let memorylimit: 0;
                            if (stats && stats.cpu_stats && stats.cpu_stats.cpu_usage && stats.cpu_stats.cpu_usage.usage_in_usermode) cpu_usage = stats.cpu_stats.cpu_usage.usage_in_usermode;
                            if (stats && stats.memory_stats && stats.memory_stats.usage) memory = stats.memory_stats.usage;
                            if (stats && stats.memory_stats && stats.memory_stats.limit) memorylimit = stats.memory_stats.limit;
                            item.metrics = {
                                cpu: parseFloat((cpu_usage / 1024 / 1024).toString()).toFixed(2) + "n",
                                memory: parseFloat((memory / 1024 / 1024).toString()).toFixed(2) + "Mi",
                                memorylimit: parseFloat((memorylimit / 1024 / 1024).toString()).toFixed(2) + "Mi"
                            };
                        }
                        result.push(item);
                    }
                }
            }
            return result;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RemoveInstancePod(tokenUser: TokenUser, jwt: string, agent: iAgent, podname: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.RemoveInstancePod", parent);
        try {
            Logger.instanse.debug("[" + agent.slug + "] RemoveInstancePod", span);

            span?.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span?.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + podname || item.Labels["agentid"] == agent._id) {
                    span?.addEvent("getContainer(" + item.Id + ")");
                    const container = docker.getContainer(item.Id);
                    if (item.State == "running") await container.stop({t: 0});
                    span?.addEvent("remove()");
                    await container.remove();
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}