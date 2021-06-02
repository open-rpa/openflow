import * as RED from "node-red";
export class Util {
    public static EvaluateNodeProperty<T>(node: any, msg: any, name: string) {
        return new Promise<T>((resolve, reject) => {
            RED.util.evaluateNodeProperty(node.config[name], node.config[name + "type"], node, msg, (err, value) => {
                if (err) {
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