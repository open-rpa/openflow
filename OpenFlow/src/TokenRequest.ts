import { Base, NoderedUtil } from "@openiap/openflow-api";

export class TokenRequest extends Base {
    constructor(code: string) {
        super();
        this._type = "tokenrequest";
        if (NoderedUtil.IsNullEmpty(code)) this.code = "";
    }
    public code: string;
    public jwt: string;
}