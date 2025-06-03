import { Span } from "@opentelemetry/api";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jsonwebtoken from "jsonwebtoken";
import { Config } from "./Config.js";
import { Logger } from "./Logger.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
import { Util, Wellknown } from "./Util.js";
import { Rolemember, TokenUser, User } from "./commoninterfaces.js";
export class Crypt {
    static encryption_key: string = null; // must be 256 bytes (32 characters))
    static iv_length: number = 16; // for AES, this is always 16
    static bcrypt_salt_rounds: number = 12;
    static rootUser(): User {
        const result: User = new User();
        result._type = "user"; result.name = Wellknown.root.name; result.username = Wellknown.root.name; result._id = Wellknown.root._id;
        result.roles = []; result.roles.push(new Rolemember(Wellknown.admins.name, Wellknown.admins._id));
        return result;
    }
    static async guestUser(): Promise<User> {
        let result: User = new User();
        result.validated = true;
        result.formvalidated = true;
        result.emailvalidated = true;
        result._type = "user"; result.name = Wellknown.guest.name; result.username = Wellknown.guest.name; result._id = Wellknown.guest._id;
        result.roles = [];
        Logger.instanse.verbose(`Decorating guest user with roles`, null, { cls: "Crypt", func: "guestUser" });
        result = await Logger.DBHelper.DecorateWithRoles(result, null);
        return result;
    }
    static rootToken(): string {
        return Crypt.createToken(this.rootUser(), Config.shorttoken_expires_in);
    }
    public static async SetPassword(user: User, password: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Crypt.SetPassword", parent);
        try {
            if (Util.IsNullUndefinded(user)) throw new Error("user is mandatody")
            if (Util.IsNullEmpty(password)) throw new Error("password is mandatody")
            user.passwordhash = await Crypt.hash(password);
            if (!(this.ValidatePassword(user, password, span))) { throw new Error("Failed validating password after hasing"); }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static GetUniqueIdentifier(length: number = 16): string {
        return crypto.randomBytes(16).toString("hex")
    }
    public static async ValidatePassword(user: User, password: string, parent: Span): Promise<boolean> {
        const span: Span = Logger.otel.startSubSpan("Crypt.ValidatePassword", parent);
        try {
            if (Util.IsNullUndefinded(user)) throw new Error("user is mandatody")
            if (Config.enable_guest && user.username == "guest") return true;
            if (Util.IsNullEmpty(password)) throw new Error("password is mandatody")
            return await Crypt.compare(password, user.passwordhash, span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static encrypt(text: string): string {
        let iv: Buffer = crypto.randomBytes(Crypt.iv_length);
        if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        let cipher: crypto.CipherGCM = crypto.createCipheriv("aes-256-gcm", Buffer.from(Crypt.encryption_key), iv);
        let encrypted: Buffer = cipher.update((text as any));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag()
        return iv.toString("hex") + ":" + encrypted.toString("hex") + ":" + authTag.toString("hex");
    }
    static decrypt(text: string): string {
        let textParts: string[] = text.split(":");
        let iv: Buffer = Buffer.from(textParts.shift(), "hex");
        let encryptedText: Buffer = Buffer.from(textParts.shift(), "hex");
        let authTag: Buffer = null;
        if (textParts.length > 0) authTag = Buffer.from(textParts.shift(), "hex");
        let decrypted: Buffer;
        if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        if (authTag != null) {
            let decipher: crypto.DecipherGCM = crypto.createDecipheriv("aes-256-gcm", Buffer.from(Crypt.encryption_key), iv);
            decipher.setAuthTag(authTag);
            decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
        } else {
            let decipher2: crypto.Decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(Crypt.encryption_key), iv);
            decrypted = decipher2.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher2.final()]);
        }
        return decrypted.toString();
    }
    static async hash(password: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                bcrypt.hash(password, Crypt.bcrypt_salt_rounds, async (error, hash) => {
                    if (error) { return reject(error); }
                    resolve(hash);
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    static async compare(password: string, passwordhash: string, parent: Span): Promise<boolean> {
        const span: Span = Logger.otel.startSubSpan("Crypt.compare", parent);
        return new Promise<boolean>((resolve, reject) => {
            try {
                if (Util.IsNullEmpty(password)) { return reject("Password cannot be empty"); }
                if (Util.IsNullEmpty(passwordhash)) { return reject("Passwordhash cannot be empty"); }
                bcrypt.compare(password, passwordhash, (error, res) => {
                    if (error) { Logger.otel.endSpan(span); return reject(error); }
                    Logger.otel.endSpan(span);
                    resolve(res);
                });
            } catch (error) {
                reject(error);
                Logger.otel.endSpan(span);
            }
        });
    }
    static createSlimToken(id: string, impostor: string, expiresIn: string): string {
        if (Util.IsNullEmpty(id)) throw new Error("id is mandatory");
        if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        const key = Crypt.encryption_key;
        if (Util.IsNullEmpty(Config.aes_secret)) throw new Error("Config missing aes_secret");
        if (Util.IsNullEmpty(key)) throw new Error("Config missing aes_secret");
        const user = { _id: id, impostor: impostor }
        return jsonwebtoken.sign({ data: user }, key,
            { expiresIn: expiresIn }); // 60 (seconds), "2 days", "10h", "7d"
    }
    static createToken(item: User | TokenUser, expiresIn: string): string {
        const user: TokenUser = new TokenUser();
        user._type = (item as User)._type;
        user._id = item._id;
        user.impostor = (item as TokenUser).impostor;
        user.name = item.name;
        user.username = item.username;
        user.roles = item.roles;
        user.customerid = item.customerid;
        user.selectedcustomerid = item.selectedcustomerid;
        user.dblocked = item.dblocked;

        if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        const key = Crypt.encryption_key;
        if (Util.IsNullEmpty(Config.aes_secret)) throw new Error("Config missing aes_secret");
        if (Util.IsNullEmpty(key)) throw new Error("Config missing aes_secret");
        return jsonwebtoken.sign({ data: user }, key,
            { expiresIn: expiresIn }); // 60 (seconds), "2 days", "10h", "7d"
    }
    static async verityToken(token: string, cli?: WebSocketServerClient, ignoreExpiration: boolean = false): Promise<TokenUser> {
        try {
            if (Util.IsNullEmpty(token)) {
                throw new Error("jwt must be provided");
            }
            if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
            if (Config.allow_signin_with_expired_jwt == false) ignoreExpiration = false;
            const o: any = jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: ignoreExpiration });
            let impostor: string = null;
            if (!Util.IsNullUndefinded(o) && !Util.IsNullUndefinded(o.data) && !Util.IsNullEmpty(o.data._id)) {
                if (!Util.IsNullEmpty(o.data.impostor)) {
                    impostor = o.data.impostor;
                }
            }
            if (!Util.IsNullUndefinded(o) && !Util.IsNullUndefinded(o.data) && !Util.IsNullEmpty(o.data._id) && o.data._id != Wellknown.root._id) {
                var id = o.data._id;
                o.data = await Logger.DBHelper.FindById(o.data._id, null);
                if (Util.IsNullUndefinded(o) || Util.IsNullUndefinded(o.data)) {
                    throw new Error("Token signature valid, but unable to find user with id " + id);
                }
            }
            if (!Util.IsNullEmpty(impostor)) o.data.impostor = impostor;
            return TokenUser.assign(o.data);
        } catch (error) {
            var e = error;
            try {
                if (!Util.IsNullEmpty(token)) {
                    const o: any = jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: true });
                    if (!Util.IsNullUndefinded(o) && !Util.IsNullUndefinded(o.data) && !Util.IsNullEmpty(o.data._id)) {
                        // fake login, so we can track who was trying to login with an expired token
                        if (cli != null && cli.user == null) {
                            cli.user = TokenUser.assign(o.data);
                            cli.username = cli.user?.username;
                        }
                        e = new Error(error.message + " for token with exp " + o.exp + " for " + o.data.name + " username: " + o.data.username + " and id: " + o.data._id);
                    }
                }
            } catch (error) {
            }
            throw e
        }
    }
    static decryptToken(token: string): any {
        if (Util.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        return jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: Config.allow_signin_with_expired_jwt });
    }
}