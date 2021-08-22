import { libmailserver } from "./libmailserver";
import { NoderedUtil } from "@openiap/openflow-api";

module.exports = function (RED) {
    "use strict";

    RED.nodes.registerType("smtpserver in", function (n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || n.email;
        this.email = n.email;
        this.port = n.port;
        const node = this;
        let mailserver: libmailserver;

        const onEmail = (email) => {
            try {
                let sendit: boolean = false;
                if (node.email == null || node.email == '' || node.email == '*') {
                    sendit = true;
                }
                if (email.to) {
                    if (email.to.value.filter(addr => addr.address == node.email).length > 0) {
                        sendit = true;
                    }
                }
                if (email.bcc) {
                    if (email.bcc.value.filter(addr => addr.address == node.email).length > 0) {
                        sendit = true;
                    }
                }
                if (sendit) {
                    const msg = { payload: email, instanceid: null };
                    let instanceid = email.headers.get('instanceid');
                    if (!instanceid) {
                        instanceid = email.headers.get('XREF');
                    }
                    if (!instanceid) {
                        const startindex = email.text.indexOf('instanceid');
                        //const endindex = email.text.indexOf('instanceid', startindex+10) + 10;
                        //const text = email.text.substring(startindex, endindex - startindex);
                        const text = email.text.substring(startindex);
                        const arr = text.split(':');
                        instanceid = arr[1];
                    }

                    msg.instanceid = instanceid;
                    node.send(msg);
                    // } else {
                    //     config.log(1, email);
                }
            } catch (error) {
                NoderedUtil.HandleError(this, error, null);
            }
        }
        async function init(port: number) {
            try {
                mailserver = await libmailserver.setupSMTP(port);
                mailserver.on('email', onEmail);
                //mailserver.on('email', onEmail);
                //libmailserver.current.on('email', onEmail);
            } catch (error) {
                NoderedUtil.HandleError(this, error, null);
            }
        }

        // const port = node.port;
        // if(port && port !='') {
        //     port = parseInt(node.port);
        // } else {
        //     port = config.mailserver_port;
        // }
        // port = config.mailserver_port;


        let port = 25;
        if (this.port) port = this.port;
        init(port);

        this.on("close", function () {
            //mailserver.removeAllListeners(node.endpointname);
            mailserver.removeListener('email', onEmail);
        });

    });

}
