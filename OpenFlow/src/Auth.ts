import { Crypt } from "./Crypt";
import { User } from "@openiap/openflow-api";
import { DBHelper } from "./DBHelper";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
export class Auth {
    public static async ValidateByPassword(username: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("Auth.ValidateByPassword", parent);
        try {
            if (username === null || username === undefined || username === "") { throw Error("Username cannot be null"); }
            span.setAttribute("username", username);
            if (password === null || password === undefined || password === "") { throw Error("Password cannot be null"); }
            const user: User = await DBHelper.FindByUsername(username, null, span);
            if (user === null || user === undefined) { return null; }
            if ((await Crypt.compare(password, user.passwordhash, span)) !== true) { return null; }
            return user;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}