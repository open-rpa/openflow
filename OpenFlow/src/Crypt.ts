import crypto from "crypto";
import bcrypt from "bcryptjs";
import jsonwebtoken from "jsonwebtoken";
import { Config } from "./Config.js";
import { NoderedUtil, TokenUser, WellknownIds, Rolemember, User } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
export class Crypt {
    static encryption_key: string = null; // must be 256 bytes (32 characters))
    static iv_length: number = 16; // for AES, this is always 16
    static bcrypt_salt_rounds: number = 12;
    static rootUser(): User {
        const result: User = new User();
        result._type = "user"; result.name = "root"; result.username = "root"; result._id = WellknownIds.root;
        result.roles = []; result.roles.push(new Rolemember("admins", WellknownIds.admins));
        return result;
    }
    static guestUser(): User {
        const result: User = new User();
        result._type = "user"; result.name = "guest"; result.username = "guest"; result._id = "65cb30c40ff51e174095573c";
        result.roles = [];
        return result;
    }
    static rootToken(): string {
        return Crypt.createToken(this.rootUser(), Config.shorttoken_expires_in);
    }
    public static async SetPassword(user: User, password: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Crypt.SetPassword", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(user)) throw new Error("user is mandatody")
            if (NoderedUtil.IsNullEmpty(password)) throw new Error("password is mandatody")
            user.passwordhash = await Crypt.hash(password);
            if (!(this.ValidatePassword(user, password, span))) { throw new Error("Failed validating password after hasing"); }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async ValidatePassword(user: User, password: string, parent: Span): Promise<boolean> {
        const span: Span = Logger.otel.startSubSpan("Crypt.ValidatePassword", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(user)) throw new Error("user is mandatody")
            if (NoderedUtil.IsNullEmpty(password)) throw new Error("password is mandatody")
            return await Crypt.compare(password, user.passwordhash, span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static encrypt(text: string): string {
        let iv: Buffer = crypto.randomBytes(Crypt.iv_length);
        if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
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
        if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
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
                if (NoderedUtil.IsNullEmpty(password)) { return reject("Password cannot be empty"); }
                if (NoderedUtil.IsNullEmpty(passwordhash)) { return reject("Passwordhash cannot be empty"); }
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
        if (NoderedUtil.IsNullEmpty(id)) throw new Error("id is mandatory");
        if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        const key = Crypt.encryption_key;
        if (NoderedUtil.IsNullEmpty(Config.aes_secret)) throw new Error("Config missing aes_secret");
        if (NoderedUtil.IsNullEmpty(key)) throw new Error("Config missing aes_secret");
        const user = {_id: id, impostor: impostor}
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

        if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        const key = Crypt.encryption_key;
        if (NoderedUtil.IsNullEmpty(Config.aes_secret)) throw new Error("Config missing aes_secret");
        if (NoderedUtil.IsNullEmpty(key)) throw new Error("Config missing aes_secret");
        return jsonwebtoken.sign({ data: user }, key,
            { expiresIn: expiresIn }); // 60 (seconds), "2 days", "10h", "7d"
    }
    static async verityToken(token: string, cli?: WebSocketServerClient, ignoreExpiration: boolean = false): Promise<TokenUser> {
        try {
            if (NoderedUtil.IsNullEmpty(token)) {
                throw new Error("jwt must be provided");
            }
            if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
            if(Config.allow_signin_with_expired_jwt == false) ignoreExpiration = false;
            const o: any = jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: ignoreExpiration });
            let impostor: string = null;
            if (!NoderedUtil.IsNullUndefinded(o) && !NoderedUtil.IsNullUndefinded(o.data) && !NoderedUtil.IsNullEmpty(o.data._id)) {
                if (!NoderedUtil.IsNullEmpty(o.data.impostor)) {
                    impostor = o.data.impostor;
                }
            }
            if (!NoderedUtil.IsNullUndefinded(o) && !NoderedUtil.IsNullUndefinded(o.data) && !NoderedUtil.IsNullEmpty(o.data._id) && o.data._id != WellknownIds.root) {
                var id = o.data._id;
                o.data = await Logger.DBHelper.FindById(o.data._id, null);
                if (NoderedUtil.IsNullUndefinded(o) || NoderedUtil.IsNullUndefinded(o.data)) {
                    throw new Error("Token signature valid, but unable to find user with id " + id);
                }
            }
            if (!NoderedUtil.IsNullEmpty(impostor)) o.data.impostor = impostor;
            return TokenUser.assign(o.data);
        } catch (error) {
            var e = error;
            try {
                if (!NoderedUtil.IsNullEmpty(token)) {
                    const o: any = jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: true });
                    if (!NoderedUtil.IsNullUndefinded(o) && !NoderedUtil.IsNullUndefinded(o.data) && !NoderedUtil.IsNullEmpty(o.data._id)) {
                        // fake login, so we can track who was trying to login with an expired token
                        if (cli != null && cli.user == null) { 
                            cli.user = TokenUser.assign(o.data);
                            cli.username = cli.user?.username;
                        }
                        e = new Error(error.message + " for token with exp " + o.exp + " for " + o.data.name + " username: " + o.data.username + " and id: " + o.data._id);
                        // Logger.instanse.error(JSON.stringify(o));
                    }
                }
            } catch (error) {
            }
            throw e
        }
    }
    static decryptToken(token: string): any {
        if (NoderedUtil.IsNullEmpty(Crypt.encryption_key)) Crypt.encryption_key = Config.aes_secret.substring(0, 32);
        return jsonwebtoken.verify(token, Crypt.encryption_key, { ignoreExpiration: Config.allow_signin_with_expired_jwt });
    }
}