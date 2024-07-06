import express from "express";
import { User } from "@openiap/openflow-api";
import { Auth } from "../Auth.js";

export function expressAuthentication(request: express.Request, securityName: string, scopes?: string[]): Promise<any> {
  if (securityName === "api_key") {
    let token;
    if (request.query && request.query.access_token) {
      token = request.query.access_token;
    }
  }

  if (securityName === "jwt" || securityName === "oidc") {
    let token =
      request.body.token ||
      request.query.token ||
      request.headers["x-access-token"] ||
      request.headers["authorization"];
    token = token?.replace("Bearer ", "");

    return new Promise(async (resolve, reject) => {
      if (!token) {
        return reject(new Error("No token provided"));
      }
      let user: User = null;
      try {
        user = await Auth.Token2User(token, null);
        if(user == null) return reject(new Error("Access denied"));
        resolve(user);
      } catch (error) {
        reject(error);        
      }
    });
  }
}
