import { Config } from "./Config.js";
import url from "url";
import { AssertQueue } from "./amqpwrapper.js";
import { NoderedUtil } from "@openiap/openflow-api";
import { Logger, promiseRetry } from "./Logger.js";
import got from "got";

export class rabbitmq {
    static parseurl(amqp_url): url.UrlWithParsedQuery {
        const q = url.parse(amqp_url, true);
        if (q.port == null || q.port == "") { q.port = "15672"; }
        if (q.auth != null && q.auth != "") {
            const arr = q.auth.split(':');
            (q as any).username = arr[0];
            (q as any).password = arr[1];
        } else {
            (q as any).username = Config.amqp_username;
            (q as any).password = Config.amqp_password;
        }
        q.protocol = 'http://';
        return q;
    }

    // This will crash the channel, that does not seem scalable
    async checkQueue(queuename: string): Promise<boolean> {
        if (Config.amqp_check_for_consumer) {
            let test: AssertQueue = null;
            try {
                if (Config.amqp_check_for_consumer_count) {
                    return this.checkQueueConsumerCount(queuename);
                }
                test = await rabbitmq.getqueue(Config.amqp_url, '/', queuename);
                if (test == null) {
                    return false;
                }
            } catch (error) {
                test = null;
            }
            if (test == null || test.consumerCount == 0) {
                return false;
            }
        }
        return true;
    }
    async checkQueueConsumerCount(queuename: string): Promise<boolean> {
        let result: boolean = false;
        try {
            result = await promiseRetry(async () => {
                const queue = await rabbitmq.getqueue(Config.amqp_url, '/', queuename);
                // const queue = await amqpwrapper.getqueue(queuename);
                let hasConsumers: boolean = false;
                if (queue.consumers > 0) {
                    hasConsumers = true;
                }
                if (!hasConsumers) {
                    if (queue.consumer_details != null && queue.consumer_details.length > 0) {
                        hasConsumers = true;
                    } else {
                        hasConsumers = false;
                    }
                }
                if (hasConsumers == false) {
                    hasConsumers = false;
                    throw new Error("No consumer listening at " + queuename);
                    // return bail();
                }
                return hasConsumers;
            }, 10, 1000);
        } catch (error) {
            Logger.instanse.error(error, null);
        }
        if (result == true) {
            return result;
        }
        return false;
    }
    static async getvhosts(amqp_url) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/vhosts';
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async getqueues(amqp_url: string, vhost: string = null) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        let _url = 'http://' + q.host + ':' + q.port + '/api/queues';
        if (!NoderedUtil.IsNullEmpty(vhost)) _url += '/' + encodeURIComponent(vhost);
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async getqueue(amqp_url: string, vhost: string, queuename) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password,
            timeout: 500, retry: 1
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(queuename);
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async deletequeue(amqp_url: string, vhost: string, queuename) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password,
            timeout: 500, retry: 1
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(queuename);
        const response = await got.delete(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
}