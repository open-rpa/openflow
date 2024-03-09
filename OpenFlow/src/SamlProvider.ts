import express from "express";
import samlp from "samlp";
import { Config } from "./Config.js";
import { Audit } from "./Audit.js";
import { NoderedUtil, User } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger.js";

export class SamlProvider {
    public static profileMapper(pu: any): any {
        return {
            pu: pu,
            getClaims: function (): any {
                const claims: any = {};
                const k: string[] = Object.keys(this.pu);
                k.forEach(key => {
                    if (key.indexOf("http://") === 0) {
                        claims[key] = this.pu[key];
                    } else {
                        switch (key) {
                            case "id":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] = this.pu[key]; break;
                            case "displayName":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] = this.pu[key]; break;
                            case "name":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] = this.pu[key]; break;
                            case "mobile":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"] = this.pu[key]; break;
                            case "username":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] = this.pu[key]; break;
                            case "emails":
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] = this.pu[key][0];
                                claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] = this.pu[key][0]; break;
                            case "roles":
                                const roles: string[] = [];
                                this.pu[key].forEach(role => {
                                    roles.push(role.name);
                                });
                                claims["http://schemas.xmlsoap.org/claims/Group"] = roles;
                        }
                    }
                });
                return claims;
            },
            getNameIdentifier: function (): any {
                const claims: any = this.getClaims();
                return {
                    nameIdentifier: claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ||
                        claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
                        claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]
                };
            }
        };
    }
    public static remoteip(req: express.Request) {
        let remoteip: string = req.socket.remoteAddress;
        if (req.headers["X-Forwarded-For"] != null) remoteip = req.headers["X-Forwarded-For"] as string;
        if (req.headers["X-real-IP"] != null) remoteip = req.headers["X-real-IP"] as string;
        if (req.headers["x-forwarded-for"] != null) remoteip = req.headers["x-forwarded-for"] as string;
        if (req.headers["x-real-ip"] != null) remoteip = req.headers["x-real-ip"] as string;
        return remoteip;
    }

    static configure(app: express.Express, baseurl: string): void {
        const cert: string = Buffer.from(Config.signing_crt, "base64").toString("ascii");
        const key: string = Buffer.from(Config.singing_key, "base64").toString("ascii");

        if(cert != null && cert != "") {
            let saml_issuer: string = Config.saml_issuer;
            if(saml_issuer == null || saml_issuer == "") saml_issuer = "uri:" + Config.domain;
            const samlpoptions: any = {
                issuer: saml_issuer,
                cert: cert,
                key: key,
                getPostURL: (wtrealm: any, wreply: any, req: any, callback: any) => {
                    (async () => {
                        if (typeof wreply === "object") {
                            wreply = wreply.documentElement.getAttribute("AssertionConsumerServiceURL");
                        }
                        return callback(null, wreply);
                    })();
    
                },
                getUserFromRequest: (req: any) => {
                    const span: Span = Logger.otel.startSpanExpress("SAML.getUserFromRequest", req);
                    try {
                        const tuser: User = req.user;
                        const remoteip = SamlProvider.remoteip(req);
                        span?.setAttribute("remoteip", remoteip);
                        Audit.LoginSuccess(tuser,  "tokenissued", "saml", remoteip, "unknown", "unknown", span).catch((e) => {
                            Logger.instanse.error(e, span);
                        });
                    } catch (error) {
                        Logger.instanse.error(error, span);
                    } finally {
                        Logger.otel.endSpan(span);
                    }
                    return req.user;
                },
                profileMapper: SamlProvider.profileMapper,
                lifetimeInSeconds: (3600 * 24)
            };
    
            app.get("/issue/", (req: any, res: any, next: any): void => {
                if (req.query.SAMLRequest !== undefined && req.query.SAMLRequest !== null) {
                    if ((req.user === undefined || req.user === null)) {
                        try {
                            // tslint:disable-next-line: max-line-length
                            samlp.parseRequest(req, samlpoptions, async (_err: any, samlRequestDom: any): Promise<void> => {
                                try {
                                    res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });    
                                } catch (error) {                                    
                                }                                
                                res.redirect("/");
                            });
                        } catch (error) {
                            res.body(error.message ? error.message : error);
                            res.end();
                            Logger.instanse.error(error, null);
                        }
                    } else {
                        // continue with issuing token using samlp
                        next();
                    }
                } else {
                    res.send("Please login again");
                    res.end();
                }
            });
    
            try {
                app.get("/issue/", samlp.auth(samlpoptions));
                app.get("/issue/FederationMetadata/2007-06/FederationMetadata.xml", samlp.metadata({
                    issuer: saml_issuer,
                    cert: cert,
                }));
            } catch (error) {
                Logger.instanse.error(error, null);
            }
            // TODO: FIX !!!!
            app.get('/wssignout', async (req: any, res: any, next: any) => {
                req.logout();
                let html = "<html><head></head><body>";
                html += "<h1>Du er nu logget ud</h1><br>";
                // html += "<br/><p><a href='/'>Til login</ifarame></p>";
                html += "</body></html>";
                res.send(html);
            });
            app.post('/wssignout', async (req: any, res: any, next: any) => {
                req.logout();
                let html = "<html><head></head><body>";
                html += "<h1>Du er nu logget ud</h1><br>";
                // html += "<br/><p><a href='/'>Til login</ifarame></p>";
                html += "</body></html>";
                res.send(html);
            });
        } else {
            Logger.instanse.warn("SAML signing certificate is not configured, saml not possible", null);
        }
        app.get('/logout', async (req: any, res: any, next: any) => {
            const referer: string = req.headers.referer;
            const providerid: any = req.cookies.provider;
            req.logout();

            if (!NoderedUtil.IsNullEmpty(providerid)) {
                var providers = await Logger.DBHelper.GetProviders(null);
                const p = providers.filter(x => x.id == providerid);
                if (p.length > 0) {
                    const provider = p[0];
                    if (!NoderedUtil.IsNullEmpty(provider.saml_signout_url)) {
                        let html = "<html><head></head><body>";
                        html += "<h1>Logud</h1><br>";
                        if (!NoderedUtil.IsNullEmpty(referer)) {
                            html += "<br/><p><a href='" + encodeURI(referer) + "'>Til login</a></p>";
                        } else {
                            html += "<br/><p><a href='/'>Til login</a></p>";
                        }
                        html += "<iframe src='" + encodeURI(provider.saml_signout_url) + "'></iframe>";
                        if (!NoderedUtil.IsNullEmpty(referer)) {
                            html += "<br/><p><a href='" + encodeURI(referer) + "'>Til login</a></p>";
                        } else {
                            html += "<br/><p><a href='/'>Til login</a></p>";
                        }
                        html += "</body></html>";
                        res.send(html);
                        return;
                    }
                }
            }
            if (!NoderedUtil.IsNullEmpty(referer)) {
                res.redirect(referer);
            } else {
                res.redirect("/");
            }
        });
        app.post('/logout', (req: any, res: any, next: any): void => {
            if(cert != null && cert != "") {
                let saml_issuer: string = Config.saml_issuer;
                if(saml_issuer == null || saml_issuer == "") saml_issuer = "uri:" + Config.domain;
                samlp.logout({
                    issuer: saml_issuer,
                    protocolBinding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
                    cert: cert,
                    key: key
                })(req, res, next);
            } else {
                req.logout();
                res.redirect("/");
            }
        });

    }
}