import { Base } from "./commoninterfaces.js";
import { Util } from "./Util.js";

export class TokenRequest extends Base {
    constructor(code: string) {
        super();
        this._type = "tokenrequest";
        if (Util.IsNullEmpty(code)) this.code = "";
    }
    public code: string;
    public jwt: string;
}