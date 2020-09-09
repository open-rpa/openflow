import * as oauthServer from "oauth2-server";
import * as winston from "winston";
import * as express from "express";
export class OAuthProvider {
    private _logger: winston.Logger;
    private app: express.Express;
    private clients = [{ clientId: 'thom', clientSecret: 'nightworld', redirectUris: [''] }];
    private tokens = [];
    private users = [{ id: '123', username: 'thomseddon', password: 'nightworld' }];
    static configure(logger: winston.Logger, app: express.Express): OAuthProvider {
        var instance = new OAuthProvider();
        instance._logger = logger;
        instance.app = app;

        (app as any).oauth = oauthServer({
            model: instance
        });
        app.post('/oauth/token', (app as any).oauth.token());
        return instance;
    }
    public getAccessToken(bearerToken) {
        var tokens = this.tokens.filter(function (token) {
            return token.accessToken === bearerToken;
        });
        return tokens.length ? tokens[0] : false;
    }
    public getRefreshToken(bearerToken) {
        var tokens = this.tokens.filter(function (token) {
            return token.refreshToken === bearerToken;
        });
        return tokens.length ? tokens[0] : false;
    }
    public getClient(clientId, clientSecret) {
        var clients = this.clients.filter(function (client) {
            return client.clientId === clientId && client.clientSecret === clientSecret;
        });
        return clients.length ? clients[0] : false;
    }
    public saveToken(token, client, user) {
        this.tokens.push({
            accessToken: token.accessToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            clientId: client.clientId,
            refreshToken: token.refreshToken,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt,
            userId: user.id
        });
    }
    public getUser(username, password) {
        var users = this.users.filter(function (user) {
            return user.username === username && user.password === password;
        });
        return users.length ? users[0] : false;
    };
}
