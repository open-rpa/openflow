import * as RED from "node-red";
export class Util {
    public static EvaluateNodeProperty<T>(node: any, msg: any, name: string, ignoreerrors: boolean = false) {
        return new Promise<T>((resolve, reject) => {
            const _name = node.config[name];
            let _type = node.config[name + "type"];
            if (_name == null) return resolve(null);
            // if (_type == null) _type = "msg";
            RED.util.evaluateNodeProperty(_name, _type, node, msg, (err, value) => {
                if (err && !ignoreerrors) {
                    reject(err);
                } else {
                    resolve(value);
                }
            })
        });
    }
    public static SetMessageProperty(msg: any, name: string, value: any) {
        RED.util.setMessageProperty(msg, name, value);
    }

}