# Providers

The providers page is where you decide how users can access the site and NodeRED. 

Right now OpenFlow supports 3 ways of signing in

## Local login

Used for signing in using a username and password from the local users collection. Generally this is less secure than using a federated partner that supports tighter control, like 2 factor authentication. User without a password cannot sign in, root cannot sign in using local.

## WS-Federation/SAML

WS-Federation, often used in conjunction with SAML tokens, is a well know and secure way of handling authentication and authorization. [Office365](https://www.office365.com/), [Microsoft ADFS](https://docs.microsoft.com/en-us/windows-server/identity/active-directory-federation-services), [Auth0](https://auth0.com/docs/protocols/ws-fed), [Salesforce](https://www.salesforce.com) to just name a few

## OAuth 2.0

OAuth is a widely used authentication protocol, but for many years venders could decide on a specific standard there fore you will find most providers have slightly different implementations. OpenFlow's implementation have been tested against Microsoft [Azure AD](https://azure.microsoft.com/en-us/services/active-directory) and Google Suit/GoogleID others may work as well.

## OpenID Connect

[OpenID connect](https://openid.net/connect/) is considered the "next thing" after OAuth. OpenFlow's implementation have been tested against [Azure AD](https://azure.microsoft.com/en-us/services/active-directory), other may work as well.