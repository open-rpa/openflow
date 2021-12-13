import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import * as jsonwebtoken from "jsonwebtoken";
import { Config } from "./Config";
import { NoderedUtil, TokenUser, WellknownIds, Rolemember, User } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
export class Crypt {
    static encryption_key: string = Config.aes_secret.substr(0, 32); // must be 256 bytes (32 characters)
    static iv_length: number = 16; // for AES, this is always 16
    static bcrypt_salt_rounds: number = 12;
    static rootUser(): User {
        const result: User = new User();
        result._type = "user"; result.name = "root"; result.username = "root"; result._id = WellknownIds.root;
        result.roles = []; result.roles.push(new Rolemember("admins", WellknownIds.admins));
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
        } catch (error) {
            span?.recordException(error);
            throw error;
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
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static encrypt(text: string): string {
        let iv: Buffer = crypto.randomBytes(Crypt.iv_length);
        let cipher: crypto.CipherGCM = crypto.createCipheriv('aes-256-gcm', Buffer.from(Crypt.encryption_key), iv);
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
        let decrypted: Buffer
        if (authTag != null) {
            let decipher: crypto.DecipherGCM = crypto.createDecipheriv('aes-256-gcm', Buffer.from(Crypt.encryption_key), iv);
            decipher.setAuthTag(authTag);
            decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
        } else {
            let decipher2: crypto.Decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(this.encryption_key), iv);
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
        return new Promise<boolean>(async (resolve, reject) => {
            try {
                if (NoderedUtil.IsNullEmpty(password)) { span?.recordException("Password cannot be empty"); return reject("Password cannot be empty"); }
                if (NoderedUtil.IsNullEmpty(passwordhash)) { span?.recordException("Passwordhash cannot be empty"); return reject("Passwordhash cannot be empty"); }
                bcrypt.compare(password, passwordhash, async (error, res) => {
                    if (error) { span?.recordException(error); Logger.otel.endSpan(span); return reject(error); }
                    Logger.otel.endSpan(span);
                    resolve(res);
                });
            } catch (error) {
                span?.recordException(error);
                reject(error);
                Logger.otel.endSpan(span);
            }
        });
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

        const key = Crypt.encryption_key;
        if (NoderedUtil.IsNullEmpty(Config.aes_secret)) throw new Error("Config missing aes_secret");
        if (NoderedUtil.IsNullEmpty(key)) throw new Error("Config missing aes_secret");
        return jsonwebtoken.sign({ data: user }, key,
            { expiresIn: expiresIn }); // 60 (seconds), "2 days", "10h", "7d"
    }
    static verityToken(token: string): TokenUser {
        if (NoderedUtil.IsNullEmpty(token)) {
            throw new Error('jwt must be provided');
        }
        const o: any = jsonwebtoken.verify(token, Crypt.encryption_key);
        return TokenUser.assign(o.data);

    }
    static decryptToken(token: string): any {
        return jsonwebtoken.verify(token, Crypt.encryption_key);
    }
}