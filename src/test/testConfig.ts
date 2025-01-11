// import wtf from "wtfnode";
import { suite } from "@testdeck/mocha";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Logger } from "../Logger.js";
import { User } from "../commoninterfaces.js";
@suite
export class testConfig {
    static db: DatabaseConnection;
    static testUser: User;
    static userToken: string;
    public static async configure() {
        if (Config.db != null) return;
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
        await Config.Load(null);
        try {
            testConfig.testUser = await Logger.DBHelper.FindByUsername("testuser", Crypt.rootToken(), null)
            testConfig.userToken = Crypt.createSlimToken(testConfig.testUser._id, null, Config.shorttoken_expires_in);
        } catch (error) {
            console.error("Error finding testuser: " + error);
        }
    }
    public static async cleanup() {
        //     Config_test.amqp?.shutdown();
        //     Logger.License.shutdown();
        //     // if (Config.db != null) await Config.db.shutdown();
        //     await Logger.otel.shutdown();
        //     // wtf.dump();
        // await Logger.shutdown();
        // Config.db = null;
    }
}
