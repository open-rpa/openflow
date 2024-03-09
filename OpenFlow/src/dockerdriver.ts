import { Base, NoderedUser, NoderedUtil, ResourceUsage, User, WellknownIds } from "@openiap/openflow-api";
import { iAgent, i_agent_driver } from "./commoninterfaces.js";
import { Logger } from "./Logger.js";
import { Span } from "@opentelemetry/api";
import { Crypt } from "./Crypt.js";
import { Config } from "./Config.js";
import os from 'os';
import Docker from 'dockerode';
// const { Docker, Dockerode } = dockerode;
import { Audit } from "./Audit.js";
import { Auth } from "./Auth.js";
export class dockerdriver implements i_agent_driver {
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
    async _pullImage(docker: Docker, imagename: string, span: Span) {
        var imageep = docker.getImage(imagename)
        var image
        try {
            image = await imageep.inspect()
        } catch (error) {
        }
        var pull: boolean = false;
        if(image == null) pull = true;
        if(imagename.indexOf(":") == -1) {
            pull = true;
        } else if(imagename.indexOf(":latest") > -1) {
            pull = true;
        } else if(imagename.indexOf(":edge") > -1) {
            pull = true;
        }

        if(pull) {
            Logger.instanse.info("Pull image " + imagename, span);
            await docker.pull(imagename)
        }
    }
    public async NodeLabels(parent: Span): Promise<any> {
        return null;
    }
    public async EnsureInstance(user: User, jwt: string, agent: iAgent, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.EnsureInstance", parent);
        Logger.instanse.debug("[" + agent.slug + "] EnsureInstance", span);

        var agent_grpc_apihost = "api";
        if(Config.agent_grpc_apihost != null && Config.agent_grpc_apihost != "") {
            agent_grpc_apihost = Config.agent_grpc_apihost;
        }
        var grpcapiurl = "grpc://" + agent_grpc_apihost + ":50051"
        var agent_ws_apihost = "api";
        if(Config.agent_ws_apihost != null && Config.agent_ws_apihost != "") {
            agent_ws_apihost = Config.agent_ws_apihost;
        }
        var wsapiurl = "ws://" + agent_ws_apihost + ":3000/ws/v2"
        let hasbilling = false;

        var agentjwt = "";
        if(NoderedUtil.IsNullEmpty(agent.runas)) {
            agentjwt = await Auth.User2Token(user, Config.personalnoderedtoken_expires_in, parent);
        } else {
            var agentuser = await Config.db.GetOne<any>({ query: { _id: agent.runas }, collectionname: "users", jwt }, parent);
            if(agentuser!= null){
                agentuser = agentuser;
                agentjwt = await Auth.User2Token(agentuser, Config.personalnoderedtoken_expires_in, parent);
            } else {
                agentjwt = await Auth.User2Token(user, Config.personalnoderedtoken_expires_in, parent);
            }
        }

        const docker: Docker = new Docker();
        const myhostname = os.hostname();
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

            let domain_schema = Config.agent_domain_schema;
            if (NoderedUtil.IsNullEmpty(domain_schema)) {
                domain_schema = "$slug$." + Config.domain;
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
            let NetworkingConfig: Docker.EndpointsConfig = undefined;
            let HostConfig: Docker.HostConfig = undefined;
            HostConfig = {
                "RestartPolicy": {
                    "Name": "always"
                }
            };
            if (me != null) {
                if (Config.agent_docker_use_project) {
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
            var agentport:number = agent.port as any;
            if(agentport == null || (agentport as any) == "") agentport = Config.port

            if(agent.webserver) {
                Labels["traefik.enable"] = "true";
                Labels["traefik.http.routers." + agent.slug + ".entrypoints"] = Config.agent_docker_entrypoints;
                Labels["traefik.http.routers." + agent.slug + ".rule"] = "Host(`" + hostname + "`)";
                Labels["traefik.http.services." + agent.slug + ".loadbalancer.server.port"] = agentport.toString()
                if (!NoderedUtil.IsNullEmpty(Config.agent_docker_certresolver)) {
                    Labels["traefik.http.routers." + agent.slug + ".tls.certresolver"] = Config.agent_docker_certresolver;
                }
            }
            let oidc_config: string = Config.agent_oidc_config;
            if((oidc_config == null || oidc_config == "") && Config.agent_oidc_issuer == "") {
                if(Config.domain != "localhost.openiap.io") oidc_config = Config.protocol + "://" + Config.domain + "/oidc/.well-known/openid-configuration"
            }
            var HTTP_PROXY = Config.HTTP_PROXY;
            var HTTPS_PROXY = Config.HTTPS_PROXY;
            var NO_PROXY = Config.NO_PROXY;
            var NPM_REGISTRY = Config.agent_NPM_REGISTRY;
            var NPM_TOKEN = Config.agent_NPM_TOKEN;

            if(HTTP_PROXY == null) HTTP_PROXY = "";
            if(Config.agent_HTTP_PROXY != null && Config.agent_HTTP_PROXY != "") HTTP_PROXY = Config.agent_HTTP_PROXY;
            if(HTTPS_PROXY == null) HTTPS_PROXY = "";
            if(Config.agent_HTTPS_PROXY != null && Config.agent_HTTPS_PROXY != "") HTTPS_PROXY = Config.agent_HTTPS_PROXY;
            if(NO_PROXY == null) NO_PROXY = "";
            if(Config.agent_NO_PROXY != null && Config.agent_NO_PROXY != "") NO_PROXY = Config.agent_NO_PROXY;
            if(NPM_REGISTRY == null) NPM_REGISTRY = "";
            if(NPM_TOKEN == null) NPM_TOKEN = "";
            const Env = [
                "jwt=" + agentjwt,
                "agentid=" + agent._id,
                // "apiurl=" + apiurl,
                "grpcapiurl=" + grpcapiurl,
                "wsapiurl=" + wsapiurl,
                "domain=" + hostname,
                "protocol=" + Config.protocol,
                "port=" + agentport.toString(),
                "NODE_ENV=" + Config.NODE_ENV,
                "HTTP_PROXY=" + HTTP_PROXY,
                "HTTPS_PROXY=" + HTTPS_PROXY,
                "NO_PROXY=" + NO_PROXY,
                "NPM_REGISTRY=" + NPM_REGISTRY,
                "NPM_TOKEN=" + NPM_TOKEN,
                "enable_analytics=" + Config.enable_analytics.toString(),
                "enable_detailed_analytic=" + Config.enable_detailed_analytic.toString(),
                "otel_trace_url=" + Config.otel_trace_url,
                "otel_metric_url=" + Config.otel_metric_url,
                "TZ=" + agent.tz,
                "log_with_colors=true",
                "oidc_config=" + oidc_config,
                "oidc_client_id=" + Config.agent_oidc_client_id,
                "oidc_client_secret=" + Config.agent_oidc_client_secret,
                "oidc_userinfo_endpoint=" + Config.agent_oidc_userinfo_endpoint,
                "oidc_issuer=" + Config.agent_oidc_issuer,
                "oidc_authorization_endpoint=" + Config.agent_oidc_authorization_endpoint,
                "oidc_token_endpoint=" + Config.agent_oidc_token_endpoint,
            ]
            let packageid = agent.package || "";
            if(packageid != "") {
                Env.push("packageid=" + packageid);
            }
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
            Audit.NoderedAction(user, true, "Created agent " + agent.name, "ensureagent", agent.image, agent.slug, parent);
        } else {
            const container = docker.getContainer(instance.Id);
            if (instance.State != "running") {
                container.start();
                Audit.NoderedAction(user, true, "Updated agent " + agent.name, "ensureagent", agent.image, agent.slug, parent);
            }

        }
    }
    public async RemoveInstance(user: User, jwt: string, agent: iAgent, removevolumes: boolean, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.RemoveInstance", parent);
        try {
            Logger.instanse.debug("[" + agent.slug + "] RemoveInstance", span);

            span?.addEvent("init Docker()");
            const docker: Docker = new Docker();
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
                    Audit.NoderedAction(user, true, "Removed agent " + agent.name, "removeagent", agent.image, agent.slug, parent);
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async GetInstanceLog(user: User, jwt: string, agent: iAgent, podname: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("message.GetInstanceLog", parent);
        try {
            var result: string = null;
            const docker: Docker = new Docker();
            let me = null;
            let list = await docker.listContainers({ all: 1 });
            let instance: Docker.ContainerInfo = null;
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
                var s = await container.logs((logOpts as any) as Docker.ContainerLogsOptions);
                result = s.toString();
                Audit.NoderedAction(user, true, "Get agentlog " + agent.name, "getagentlog", agent.image, agent.slug, parent);
            }
            if (result == null) result = "";
            return result;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async InstanceCleanup(parent: Span): Promise<void> {
        const resource: any = await Config.db.GetResource("Agent Instance", parent);
        if (NoderedUtil.IsNullUndefinded(resource)) return;
        let runtime: number = resource?.defaultmetadata?.runtime_hours;
        if (NoderedUtil.IsNullUndefinded(runtime)) {
            // If agent resource does not exists, dont turn off agents
            runtime = 0;
        }
        if (runtime < 1) return;
        parent?.addEvent("init Docker()");
        const docker = new Docker();
        parent?.addEvent("listContainers()");
        var list = await docker.listContainers({ all: 1 });
        const rootjwt = Crypt.rootToken()
        const rootuser = Crypt.rootUser();
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
                const date = new Date();
                const a: number = (date as any) - (Created as any);
                const diffhours = a / (1000 * 60 * 60);
                if (billed != "true" && diffhours > runtime) {
                    Logger.instanse.warn("[" + item.metadata.name + "] Remove un billed agent instance " + item.metadata.name + " that has been running for " + diffhours + " hours", parent);
                    var agent = await Config.db.GetOne<iAgent>({ query: { slug: item.metadata.name }, collectionname: "agents", jwt: rootjwt }, parent);
                    if(agent != null) {
                        await this.RemoveInstance(rootuser, rootjwt, agent, false, parent);
                    } else {
                        Logger.instanse.debug("Cannot remove un billed instance " + item.metadata.name + " that has been running for " + diffhours + " hours, unable to find agent with slug " + item.metadata.name , parent, { user: item.metadata.name });
                    }
                }
            }
        }
    }
    public async GetInstancePods(user: User, jwt: string, agent: iAgent, getstats:boolean, parent: Span): Promise<any[]> {
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
                    let addit: boolean = false;

                    if(agent == null) {
                        var _slug = item.Names[0];
                        if(_slug != null) {
                            if(_slug.startsWith("/")) { _slug = _slug.substr(1); }
                            var _agent = await Config.db.GetOne<iAgent>({ query: { slug: _slug }, collectionname: "agents", jwt }, parent);
                            if(_agent != null) { addit = true; }
                        }
                    } else if ((item.Names[0] == "/" + agent.slug || item.Labels["agentid"] == agent._id) && deleted == false) {
                        addit = true;
                    }

                    if(addit) {
                        if(getstats) {
                            span?.addEvent("getContainer(" + item.Id + ")");
                            const container = docker.getContainer(item.Id);
                            span?.addEvent("stats()");
                            var stats = await container.stats({ stream: false });
                            let cpu_usage = 0;
                            let memory = 0;
                            let memorylimit = 0;
                            if(stats && stats.memory_stats && stats.memory_stats.usage) memory = stats.memory_stats.usage;
                            if(stats.memory_stats.stats && stats.memory_stats.stats.inactive_file) {
                                if(memory - stats.memory_stats.stats.inactive_file > 1000) {
                                    // is this correct ? usage is wrong when comparing to docker stats
                                    // but docs say usage-cache, but cache does not exists ...
                                    // my last test shows usage - inactive_file was correct, but needs more tests
                                    memory = memory - stats.memory_stats.stats.inactive_file;
                                }
                                
                            }
                            if (stats && stats.cpu_stats && stats.cpu_stats.cpu_usage && stats.cpu_stats.cpu_usage.usage_in_usermode) {
                                cpu_usage = stats.cpu_stats.cpu_usage.usage_in_usermode;
                            }
                            // if (stats && stats.memory_stats && stats.memory_stats.usage) memory = stats.memory_stats.usage;
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
    public async RemoveInstancePod(user: User, jwt: string, agent: iAgent, podname: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.RemoveInstancePod", parent);
        try {
            Logger.instanse.debug("[" + agent.slug + "] RemoveInstancePod", span);

            span?.addEvent("init Docker()");
            const docker: Docker = new Docker();
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
                    Audit.NoderedAction(user, true, "Removed agent " + agent.name, "removeagent", agent.image, agent.slug, parent);
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}