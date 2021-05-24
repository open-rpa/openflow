import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import * as jsonwebtoken from "jsonwebtoken";
import { Config } from "../Config";
import { TokenUser } from "@openiap/openflow-api";

export class Crypt {
    // static encryption_key:string = Config.aes_secret.substr(0,32); // must be 256 bytes (32 characters)
    static iv_length: number = 16; // for AES, this is always 16
    static bcrypt_salt_rounds: number = 12;

    static encryption_key(): string {
        return Config.aes_secret.substr(0, 32);
    }
    /**
     * @deprecated The method should not be used
     */
    static createToken(user: TokenUser): string {
        const token: string = jsonwebtoken.sign({ data: user }, Crypt.encryption_key(),
            { expiresIn: "1h" }); // 60 (seconds), "2 days", "10h", "7d"
        return token;
    }
}