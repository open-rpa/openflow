import { ResourceUsage, User } from '../commoninterfaces.js';
import { Config } from '../Config.js';
let KubeUtil: any = null;

async function init() {
    try {
        // @ts-ignore
        let _driver: any = await import("./KubeUtil.js");
        KubeUtil =  _driver.KubeUtil.instance();
    } catch (error) {
        console.error(error.message);
    }
}
init();
export class FaaS {
    public static async GetImage(tuser: User, jwt: string, pack: any) {
        let image = await KubeUtil.GetImage(Config.namespace, pack.name);
        return image;
    }
    public static async BuildImage(tuser: User, jwt: string, pack: any) {
        let image = await KubeUtil.GetImage(Config.namespace, pack.name);
        if(image != null) {
            await KubeUtil.DeleteImage(Config.namespace, pack.name);
        }
        let url = Config.baseurl() + "download/" + pack._id + "?jwt=" + jwt;
        image = await KubeUtil.CreateImage(Config.namespace, Config.namespace, "demo-builder", pack.name, url);
        let start = new Date();
        do {
            image = await KubeUtil.GetImage(Config.namespace, pack.name);
            if (image == null) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
                throw new Error("Failed to find image after it was created");
            }
            let complete = true;
            for(let i = 0; i < image.status.conditions.length; i++) {
                const condition = image.status.conditions[i];
                if (condition.type == "Ready" && condition.status != "True") {
                    complete = false;
                }
                if((condition.type == "Failed" && condition.status == "True") || (condition.message.indexOf("failed") > -1)) {
                    complete = false;
                    console.log("Image build failed");
                    throw new Error("Image build failed: " + condition.message);
                }
                console.log(condition.type, condition.status, condition.message);
            }
            if(image.status.conditions.length <= 3) {
                complete = false;
            }
            if (complete) {
                console.log("Image build complete");
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } while (new Date().getTime() - start.getTime() < (60000 * 5)); // wait for 5 minutes
        return image;
    }
    public static async DeleteImage(tuser: User, jwt: string, pack: any) {
        let image = await KubeUtil.GetImage(Config.namespace, pack.name);
        if(image != null) {
            await KubeUtil.DeleteImage(Config.namespace, pack.name);
        }
    }
}
