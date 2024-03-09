import { Base, NoderedUtil, Rights, TokenUser, User } from "@openiap/openflow-api";
import { JSONPath } from "jsonpath-plus";
import { DatabaseConnection } from "./DatabaseConnection.js";
import { Logger } from "./Logger.js";

export class EntityRestriction extends Base {
    public collection: string;
    public copyperm: boolean;
    public paths: string[];
    constructor(
    ) {
        super();
        this._type = "restriction";
    }
    static assign<EntityRestriction>(o: any): EntityRestriction {
        if (typeof o === 'string' || o instanceof String) {
            return Object.assign(new EntityRestriction(), JSON.parse(o.toString()));
        }
        return Object.assign(new EntityRestriction(), o);
    }
    public IsMatch(object: object): boolean {
        if (NoderedUtil.IsNullUndefinded(object)) {
            return false;
        }
        for (let path of this.paths) {
            if (!NoderedUtil.IsNullEmpty(path)) {
                var json = { a: object };
                Logger.instanse.verbose(path, null);
                Logger.instanse.silly(JSON.stringify(json, null, 2), null);
                try {
                    const result = JSONPath({ path, json });
                    if (result && result.length > 0) {
                        Logger.instanse.verbose("true", null);
                        return true;
                    }
                } catch (error) {
                }
            }
        }
        Logger.instanse.verbose("false", null);
        return false;
    }
    public IsAuthorized(user: TokenUser | User): boolean {
        return DatabaseConnection.hasAuthorization(user as TokenUser, this, Rights.create);
    }
}