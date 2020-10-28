/**
 * MIT License
 *
 * Copyright (c) 2019 Marcos Caputo <caputo.marcos@gmail.com> https://github.com/caputomarcos/node-red-contrib-oauth2
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 **/

import * as request from 'request';
import * as querystring from 'querystring';
import * as RED from "node-red";
import { Red } from "node-red";
import { Logger } from "../../Logger";
import { NoderedUtil } from "openflow-api";

export interface Ioauth2 {
    name: string;
    container: string;
    access_token_url: string;
    grant_type: string;
    username: string;
    password: string;
    client_id: string;
    client_secret: string;
    scope: string;
}
export class oauth2 {
    public node: Red = null;
    public name: string = "";
    public restKey: string;
    public appID: string;
    constructor(public config: Ioauth2) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});

            config.name = config.name || "";
            config.container = config.container || "oauth2Response";
            config.access_token_url = config.access_token_url || "";
            config.grant_type = config.grant_type || "password";
            config.username = config.username || "";
            config.password = config.password || "";
            config.client_id = config.client_id || "";
            config.client_secret = config.client_secret || "";
            config.scope = config.scope || "";

            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async oninput(msg: any) {
        // set an empty form
        let Form = {};

        // TODO - ??? =)
        let Method = "Post";
        let Authorization = '';
        // Choice a grant_type
        if ((this.node.grant_type === "set_by_credentials" || this.node.grant_type == null) && msg.oauth2Request) {
            this.node.access_token_url = msg.oauth2Request.access_token_url;
            this.node.client_id = msg.oauth2Request.credentials.client_id;
            this.node.client_secret = msg.oauth2Request.credentials.client_secret;
            Form = msg.oauth2Request.credentials;
            if (msg.oauth2Request.username && msg.oauth2Request.password) {
                // TODO - ??? =)
                Authorization = 'Basic ' + Buffer.from(`${msg.oauth2Request.username}:${msg.oauth2Request.password}`).toString('base64');
            } else {
                // TODO - ??? =)
                Authorization = 'Basic ' + Buffer.from(`${this.node.client_id}:${this.node.client_secret}`).toString('base64');
            }
        } else if (this.node.grant_type === "password") {
            Form = {
                'username': this.node.username,
                'password': this.node.password,
                'grant_type': this.node.grant_type,
                'client_id': this.node.client_id,
                'client_secret': this.node.client_secret
            };
            // TODO - ??? =)
            Authorization = 'Basic ' + Buffer.from(`${this.node.client_id}:${this.node.client_secret}`).toString('base64');
        } else if (this.node.grant_type === "client_credentials") {
            Form = {
                'grant_type': this.node.grant_type,
                'client_id': this.node.client_id,
                'client_secret': this.node.client_secret,
                'scope': this.node.scope
            };
            // TODO - ??? =)
            Authorization = 'Basic ' + Buffer.from(`${this.node.client_id}:${this.node.client_secret}`).toString('base64');
        }

        let Body = querystring.stringify(Form);

        // set Headers
        // TODO - improve 'Authorization': 'Basic ' ??? =)
        let Headers = {
            // 'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(Body),
            'Authorization': Authorization
        };

        // Put all together
        let Options = {
            method: Method,
            url: this.node.access_token_url,
            headers: Headers,
            body: Body,
            json: false
        };

        // make a post request
        request.post(Options, (err, response, body) => {
            if (msg.oauth2Request) delete msg.oauth2Request;
            let oauth2Body: any = null;
            try {
                oauth2Body = JSON.parse(body ? body : JSON.stringify("{}"));
                if (response && response.statusCode && response.statusCode === 200) {
                    msg[this.node.container] = {
                        authorization: `${oauth2Body.token_type} ${oauth2Body.access_token}`,
                        oauth2Response: {
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            body: oauth2Body
                        }
                    };

                    this.node.status({
                        fill: "green",
                        shape: "dot",
                        text: `HTTP ${response.statusCode}, has token!`
                    });
                } else if (response && response.statusCode && response.statusCode !== 200) {
                    msg[this.node.container] = {
                        oauth2Response: {
                            statusCode: response.statusCode,
                            statusMessage: response.statusMessage,
                            body: oauth2Body
                        }
                    };
                    this.node.status({
                        fill: "red",
                        shape: "dot",
                        text: `HTTP ${response.statusCode}, hasn't token!`
                    });
                }
            } catch (error) {
                const errormessage = error.message ? error.message : error;
                msg[this.node.container] = {
                    oauth2Response: {
                        statusCode: response.statusCode,
                        statusMessage: errormessage,
                        body: oauth2Body
                    }
                };
                this.node.status({
                    fill: "red",
                    shape: "dot",
                    text: `HTTP ${response.statusCode}, hasn't token!`
                });

            }
            if (err && err.code) {
                this.node.status({ fill: "red", shape: "dot", text: `ERR ${err.code}` });
                msg.err = JSON.parse(JSON.stringify(err));
            } else if (err && err.message && err.stack) {
                this.node.status({ fill: "red", shape: "dot", text: `ERR ${err.message}` });
                msg.err = { message: err.message, stack: err.stack };
            }
            this.node.send(msg);
        });
    }
    async onclose(removed: boolean, done: any) {
        done();
    }
}
