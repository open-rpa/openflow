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
        let url = Config.baseurl() + "download/" + pack.fileid + "?jwt=" + jwt;
        image = await KubeUtil.CreateImage(Config.namespace, Config.namespace, "demo-builder", pack.name, url);
        let start = new Date();

        while (new Date().getTime() - start.getTime() < 5 * 60 * 1000) {
            image = await KubeUtil.GetImage(Config.namespace, pack.name);
            if (!image?.status?.conditions) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        
            const ready = image.status.conditions.find(c => c.type === "Ready");
            const failed = image.status.conditions.find(c => c.type === "Failed");
        
            if (ready?.message && Date.now() % 10000 < 1000) {
                console.log(`[build status] ${ready.status}: ${ready.message}`);
            }
            
            if (failed?.status === "True") {
                throw new Error("Image build failed: " + (failed.message || "Unknown failure"));
            }
        
            if (ready?.status === "True") {
                console.log("Image build complete");
                return image;
            }
        
            if (ready?.status === "False") {
                throw new Error("Image build failed: " + (ready.message || "Build marked as not ready"));
            }
        
            // Still building (status == "Unknown" or not set yet)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        throw new Error("Timed out waiting for image to be built");
    }
    public static async DeleteImage(tuser: User, jwt: string, pack: any) {
        let image = await KubeUtil.GetImage(Config.namespace, pack.name);
        if(image != null) {
            await KubeUtil.DeleteImage(Config.namespace, pack.name);
        }
    }
}
