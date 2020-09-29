import * as OAuthServer from "oauth2-server";
import * as winston from "winston";
import * as express from "express";
import { TokenUser } from "openflow-api";
const Request = OAuthServer.Request;
const Response = OAuthServer.Response;
export class OAuthProvider {
    private _logger: winston.Logger;
    private app: express.Express;
    public static instance: OAuthProvider = null;
    private clients = [{
        id: 'application',	// TODO: Needed by refresh_token grant, because there is a bug at line 103 in https://github.com/oauthjs/node-oauth2-server/blob/v3.0.1/lib/grant-types/refresh-token-grant-type.js (used client.id instead of client.clientId)
        clientId: 'application',
        clientSecret: 'secret',
        grants: [
            'password',
            'refresh_token',
            'authorization_code'
        ],
        redirectUris: []
    }];
    private tokens = [];
    private codes = {};
    public oauthServer: any = null;
    private authorizationCodeStore: any = {};

    static configure(logger: winston.Logger, app: express.Express): OAuthProvider {
        var instance = new OAuthProvider();
        try {
            OAuthProvider.instance = instance;
            instance._logger = logger;
            instance.app = app;
            instance.oauthServer = new OAuthServer({
                model: instance,
                grants: ['authorization_code', 'refresh_token'],
                accessTokenLifetime: 60 * 60 * 24, // 24 hours, or 1 day
                allowEmptyState: true,
                allowExtendedTokenAttributes: true
            });
            (app as any).oauth = instance.oauthServer;
            app.all('/oauth/token', instance.obtainToken.bind(instance));
            app.get('/oauth/login', (req, res) => {
                let state = req.params.state;
                if (state == null) state = encodeURIComponent(req.query.state as any);
                const access_type = req.query.access_type;
                const client_id = req.query.client_id;
                const redirect_uri = req.query.redirect_uri;
                const response_type = req.query.response_type;
                const scope = req.query.scope;
                if (req.user) {
                    // TODO: Add logic for configurering redirect url's !!!!!!!!
                    if (instance.clients[0].redirectUris.indexOf(redirect_uri) == -1) {
                        instance.clients[0].redirectUris.push(redirect_uri);
                    }

                    instance._logger.info("[OAuth][" + (req.user as any).username + "] /oauth/login " + state);
                    instance.codes["cc536d98d27750394a87ab9d057016e636a8ac31"] = req.user;
                    instance.codes["cc536d98d27750394a87ab9d057016e636a8ac31"].redirect_uri = redirect_uri;
                    // res.redirect(`${GRAFANA_URI}/login/generic_oauth?state=${state}&code=cc536d98d27750394a87ab9d057016e636a8ac31`);
                    res.redirect(`${redirect_uri}?state=${state}&code=cc536d98d27750394a87ab9d057016e636a8ac31`);
                } else {
                    instance._logger.info("[OAuth][anon] /oauth/login " + state);
                    res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                    res.redirect("/login");
                }
            });
            // app.get('/oauth/authorize', instance.authorize.bind(instance));
            app.all('/oauth/authorize', (req, res) => {
                var request = new Request(req);
                var response = new Response(res);
                return instance.oauthServer.authenticate(request, response)
                    .then((token) => {
                        res.json(token.user);
                    }).catch((err) => {
                        console.error(err);
                        res.status(err.code || 500).json(err);
                    });
            });
            // app.all('/oauth/authorize', instance.oauthServer.authenticate.bind(instance));
            // app.all('/oauth/authorize/emails', instance.oauthServer.authenticate.bind(instance));
        } catch (error) {
            console.error(error);
            var json = JSON.stringify(error, null, 3);
            console.error(json);
            throw error;
        }
        return instance;
    }
    authorize(req, res) {
        this._logger.info("[OAuth] authorize");
        var request = new Request(req);
        var response = new Response(res);
        console.log(request.headers);
        return this.oauthServer.authorize(request, response)
            .then((token) => {
                res.json(token);
            }).catch((err) => {
                console.error(err);
                res.status(err.code || 500).json(err);
            });

    }
    authenticateHandler() {
        return {
            handle: (request, response) => {
                //in this example, we store the logged-in user as the 'loginUser' attribute in session
                if (request.session.loginUser) {
                    return { username: request.session.loginUser.username };
                }

                return null;
            }
        };
    }
    obtainToken(req, res) {
        this._logger.info("[OAuth] obtainToken");
        var request = new Request(req);
        var response = new Response(res);
        return this.oauthServer.token(request, response)
            .then((token) => {
                this._logger.info("[OAuth] obtainToken::success: token:");
                res.json(token);
            }).catch((err) => {
                this._logger.info("[OAuth] obtainToken::failed: token:");
                console.error(err);
                res.status(err.code || 500).json(err);
            });
    }
    public getAccessToken(bearerToken) {
        this._logger.info("[OAuth] getAccessToken " + bearerToken);
        var tokens = this.tokens.filter((token) => {
            return token.accessToken === bearerToken;
        });
        return tokens.length ? tokens[0] : false;
    }
    public getRefreshToken(bearerToken) {
        this._logger.info("[OAuth] getRefreshToken " + bearerToken);
        var tokens = this.tokens.filter((token) => {
            return token.refreshToken === bearerToken;
        });
        return tokens.length ? tokens[0] : false;
    }
    public getClient(clientId, clientSecret) {
        this._logger.info("[OAuth] getClient " + clientId);
        var clients = this.clients.filter((client) => {
            return client.clientId === clientId && client.clientSecret === clientSecret;
        });
        return clients.length ? clients[0] : false;
    }
    public saveToken(token, client, user) {
        this._logger.info("[OAuth] saveToken " + token);
        var result = {
            accessToken: token.accessToken,
            access_token: token.accessToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            clientId: client.clientId,
            refreshToken: token.refreshToken,
            refresh_token: token.refreshToken,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt,
            userId: user.id,

            user: user,
            client: this.clients[0]
        };
        this.tokens.push(result);
        return result;
    }
    saveAuthorizationCode(code, client, user) {
        this._logger.info("[OAuth] saveAuthorizationCode " + code);
        var codeToSave: any = this.codes[code];
        codeToSave = {
            'authorizationCode': code.authorizationCode,
            'expiresAt': code.expiresAt,
            'redirectUri': code.redirectUri,
            'scope': code.scope,
            'client': client.id,
            'user': user.username
        };
        this.codes[code] = codeToSave;
        code = Object.assign({}, code, {
            'client': client.id,
            'user': user.username
        });
        return code;
    }
    getAuthorizationCode(code) {
        this._logger.info("[OAuth] getAuthorizationCode " + code);
        var user: TokenUser = this.codes[code];
        if (user == null) return null;
        var redirect_uri = (user as any).redirect_uri;
        var expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        var role = "Viewer";
        user = TokenUser.From(user);
        if (user.HasRoleName("admins")) role = "Admin";
        if (user.HasRoleName("grafana editors")) role = "Editor";
        if (user.HasRoleName("grafana admins")) role = "Admin";
        var result = {
            code: code,
            client: this.clients[0],
            user: {
                id: user._id,
                _id: user._id,
                name: user.name,
                username: user.username,
                email: user.username,
                role: role
            },
            expiresAt: expiresAt,
            redirectUri: redirect_uri
        }
        // Viewer, Editor, Admin
        // return result;
        return result;
    }
    revokeAuthorizationCode(code) {
        this._logger.info("[OAuth] revokeAuthorizationCode " + code);
        return true;
        // var user: TokenUser = this.codes[code];
        // if (user != null) delete this.codes[code];
        // return code;
    }
}
