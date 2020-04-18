# OpenFlow
Simple wrapper around NodeRed, RabbitMQ and MongoDB to support a more scalable NodeRed implementation.
Also the "backend" for [OpenRPA](https://github.com/open-rpa/OpenRPA)

Join slack for giving feedback [#openrpa](https://slack.openrpa.dk/)

Build to run on docker, how to setup docker is not supported on GitHub/slack

#### Quick start

To quickly get started with your own installation you can use one of these docker-compose files.
download the file you want
rename to docker-compose.yaml 
open a shell and cd to that folder you downloaded the file to, and type
docker-compose up
or
docker-compose up -d

[docker-compose-traefik.yml](https://github.com/open-rpa/openflow/blob/master/docker-compose-traefik.yml) is for people running docker ce/docker desktop or docker swarm

[docker-compose-toolbox.yml](https://github.com/open-rpa/openflow/blob/master/docker-compose-toolbox.yml) is for people running [docker toolbox](https://docs.docker.com/toolbox/toolbox_install_windows/) 

[docker-compose.yml](https://github.com/open-rpa/openflow/blob/master/docker-compose.yml) is for developers who don't want to install [mongoDB](https://www.mongodb.com/download-center/community)/[RabbitMQ](https://www.rabbitmq.com/download.html) or an easy way to run one instance while debugging the other.

Then you can access the API/web on [http://localhost.openrpa.dk](http://localhost.openrpa.dk) ( or [http://toolbox.openrpa.dk](http://toolbox.openrpa.dk) )
You can access nodered on [http://nodered1.localhost.openrpa.dk](http://nodered1.localhost.openrpa.dk) ( or [http://nodered1.toolbox.openrpa.dk](http://nodered1.toolbox.openrpa.dk) )
and RabbitMQ on  [http://mq.localhost.openrpa.dk](http://mq.localhost.openrpa.dk) ( or [http://mq.toolbox.openrpa.dk](http://mq.toolbox.openrpa.dk) )

The first username and password you try to login as, will be created and made admin

For help with running on [kubernetes](https://kubernetes.io/) or self hosting contact [OpenIAP](https://openrpa.dk/) for a support agreement

#### Developer setup

Install [VSCode](https://code.visualstudio.com/download), [NodeJS 10](https://nodejs.org/dist/latest-v10.x/),  [mongoDB](https://www.mongodb.com/download-center/community) and [RabbitMQ](https://www.rabbitmq.com/download.html) 

Clone this repo into a folder, in a shell type

`git clone https://github.com/open-rpa/openflow.git`

go to the folder with openflow

`cd openflow`

Install gulp and typescript globally

`npm i gulp tsc -g`

install packages for openflow api/web

`npm i`

Create webpack

`npx webpack`

install packages for NodeRED by 

`cd OpenFlowNodeRED`
`npm i`

`cd ..`

Now open in VS code

`code OpenFlow.code-workspace`

at the top level create a folder called config and inside create a file called .env ( notice it starting with a dot)

and add this content to the file

```bash
nodered_id=modered1
nodered_sa=modered1
port=80
nodered_port=1880
nodered_domain_schema=$nodered_id$.localhost.openrpa.dk
tls_crt=
tls_key=
tls_ca=

signing_crt=LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURqRENDQW5TZ0F3SUJBZ0lKQUp5N0tIMTE1dkQ4TUEwR0NTcUdTSWIzRFFFQkN3VUFNRnN4Q3pBSkJnTlYKQkFZVEFrUkxNUk13RVFZRFZRUUlEQXBUYjIxbExWTjBZWFJsTVNFd0h3WURWUVFLREJoSmJuUmxjbTVsZENCWAphV1JuYVhSeklGQjBlU0JNZEdReEZEQVNCZ05WQkFNTUMzTnBaMjVwYm1kalpYSjBNQjRYRFRFNU1EUXdOekUwCk5ETXpORm9YRFRJNU1EUXdOREUwTkRNek5Gb3dXekVMTUFrR0ExVUVCaE1DUkVzeEV6QVJCZ05WQkFnTUNsTnYKYldVdFUzUmhkR1V4SVRBZkJnTlZCQW9NR0VsdWRHVnlibVYwSUZkcFpHZHBkSE1nVUhSNUlFeDBaREVVTUJJRwpBMVVFQXd3TGMybG5ibWx1WjJObGNuUXdnZ0VpTUEwR0NTcUdTSWIzRFFFQkFRVUFBNElCRHdBd2dnRUtBb0lCCkFRQy9JSkdEaGxLTU9SWkoycXQwSWpjSDZOWUFtZDVxQzQ4dkNJRE54QWZCbmQxQnN4WlVjWkl5dkFlT28yNDcKM3I0eTYwNDgxRHVUS2JaMTBTNjRqRU05aW1XTXB1TFlJRnVyQ3BWNzVEWWhxMS85Q0FJVHJqNjlmVDluSkptcwpjM2lxTnJ1Tlg1bDlISXdadWtQM1ZNRkJRNWZVd3N1ZnE0YW1NbnVnZmtyUEVzSngxK3VJb0NYU3pyblZvcnZpClZ0ZFh4a3M4N0l1S0ZnMDJIZ1RQSzdwc0FXYTBRY3g2ck04bkV5TUhwNUdlR1Rvb1NNbkcyZ1RGNWZOSVFNdTMKVEVoc2p3SWRTYmRwck1Gb1VZV05Bc2FueTJOQk0wREhZRUdjQlZhZ0xWNUhFUW5ySUM3NEhtNjYxdG9HaU5VSAoveW04U3VndTgwWVFiVGxPcTFWNnNkaVRBZ01CQUFHalV6QlJNQjBHQTFVZERnUVdCQlMrYWc1NGtITllKZ29pCm9yRnlia293THR5R3ZqQWZCZ05WSFNNRUdEQVdnQlMrYWc1NGtITllKZ29pb3JGeWJrb3dMdHlHdmpBUEJnTlYKSFJNQkFmOEVCVEFEQVFIL01BMEdDU3FHU0liM0RRRUJDd1VBQTRJQkFRQTZpZHBYdzdSR2pzcUpNanI2c1YvaQpXeXFsL2xkSy9sa1NCdnNBSENieDdQYi9rVUd2NHJNbndYMnBHdTR0YkFnSDc4eStmS3dzazllYkxDeTA4Y1k0Ckt5czhzbUpLenhWN0R6U3RVR1NvZmZMaFliVVVMK3UyNU5vVXc0TG1WQU5FU0NaMTZ3aTdPQUdJMkJnNFR6TXoKdnlIUHRaaE9wTXBNV2lzM2ZnRXFzV3QxS2VLcXo0Z2M5RnJtZDZPNlQzVVAxWTRBR3VEWnNScnpiU2RQS2JxbApxekprT2tQcGtHOGo3ZjFWNkk1ZlkzblZaSWk2YW1TcTM1RTJkQzVMY0dIQXRtT1lWL0c4TEQ3OUFnTVpFUU5vCkF2R2RnV1gvbXBFVkFjMmRFQkJlcUN6WjF1aVhWUjdERld2ZDFKTEpsdVRyTm9jMUROc0xNKzNEZFFiQ2JnYVcKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=
singing_key=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQy9JSkdEaGxLTU9SWkoKMnF0MElqY0g2TllBbWQ1cUM0OHZDSUROeEFmQm5kMUJzeFpVY1pJeXZBZU9vMjQ3M3I0eTYwNDgxRHVUS2JaMQowUzY0akVNOWltV01wdUxZSUZ1ckNwVjc1RFlocTEvOUNBSVRyajY5ZlQ5bkpKbXNjM2lxTnJ1Tlg1bDlISXdaCnVrUDNWTUZCUTVmVXdzdWZxNGFtTW51Z2ZrclBFc0p4MSt1SW9DWFN6cm5Wb3J2aVZ0ZFh4a3M4N0l1S0ZnMDIKSGdUUEs3cHNBV2EwUWN4NnJNOG5FeU1IcDVHZUdUb29TTW5HMmdURjVmTklRTXUzVEVoc2p3SWRTYmRwck1GbwpVWVdOQXNhbnkyTkJNMERIWUVHY0JWYWdMVjVIRVFucklDNzRIbTY2MXRvR2lOVUgveW04U3VndTgwWVFiVGxPCnExVjZzZGlUQWdNQkFBRUNnZ0VBVXBjZ1NsV2hGamNWQ3BVVHdmdUhERVB4TmhGSHEwdVRkQitZaVZKTWg3NVAKL2pRRlVqaEJsT3JyMlJlR2F4aTEyQXNXby9LU1MrV2Frdzd4d1kzYkFKenRoUG9Zekl3dkVKcGlQa2MvblEwUgpUYVpJUDNqc1k3WGIwQlpnMGNTVVAvbW0wbENkWXhNUzk0c21FNXJzWitkdGxPTVlXc2NrU0cxSVB2SlVJV2FZCnl3NC9kaHJ3TWRsREVZS2tSbks1aDR1dXR1dzA1Q1VzNkZWN2F5cEJRRStGM3RxVlF3QWxGbWNueXdvZTB5WjQKZW1tWkRvT1dzNUk4cGNGbjZCSW1wZjN3UEg5UWhlQXJVaXRqV3YrZmI2cWRVaHJFVDBxMzh4dTZ5M1lJNFNLYQpXME9kUng4L3FTYllXdkpzbmxscDR0aUpDWE5IdnV6MVBKSGhxOUprQVFLQmdRRCt2dHlWcVJoaEJZTmd6WWorClFCaDNLcktrNEVqTXZaSGhEelhES0pMZ2JEVmJzNExrQkYySWZGOTF0S1k3d09CNVpXcU82Z3FqVVJBVE5hc1YKOExCOGE2TEpXYVJuTklLMnJkd1FwalFYcy92OVBSYnJwc2tTbDRJdUsyZWNBMjBSQkhicW5yNHZ5ZkQ4U3BzaApSdHlTUk5CRGVsaU01Z1JDM0JKKzBZbjBVUUtCZ1FEQUVZSUp3Y2xnQloyWmNNTlh1dW1lLzUxdHBHeGppRTJpCjZ3SDNsOHNTVDN1U1A4MHdndGdHaVFsUTRsR3BmSThqWkl4N0pwcGw0Qko1ZEtuVnpIS1dqMzA3YXYxcjdpU3QKLzJOVDNobzdaYkNlYzlhMHlJU2E3dTNGZGxzZ0VPcE45dURmbG5GQVQ3ZmIrM2d4Sk9DUWp1TkFCZXZaK2pScwpZY0ZhQWhGNW93S0JnUUNGUG9HVVNsRDFGblFrWXYwL3QzalVnK0hTK1hrNmxnRkNqYmthTGhPOURQeFB6Ykl0CjM5YW9lQjFhTExZeVZPMVVzZVl0Z0Y4MkUwVnNOc3NZKzc3a0pVeU5NclVhUWs0SWpTR3BGN1h4bS9PMi9vZ0oKbEVCaDJCdUFXTFdsMWVqcldNRjJjTGVidVcyeUdMZlJqUVg3LzhCTE95Z3I4bmZTSE5nVHV6Z0VNUUtCZ0JrZgpNUjhObGNWVmRyT25LQ1hGY09FM0ZlUk5hVS9yZUJ3akdQTEZpKzR0TDBDRno5VFVpR1R5YjZHQXVLV3VnUnBrCkFHdnJOSzYyakRRT3FsZ29rYVJYeUUySlJQUmxCYThzaEZWbjY0NXhVcFNuR2lJelNBVHIwM1hNY1ViVWI1RWIKQlhhNU9yN3FybVc3a3BENi9kUnFuQmEzcjQyblNFd1V6VEYwcTh4NUFvR0FIcXdRSyt1R0NTdlNsNENJUGhyRQpDREIvcytDK2NJNXVCeFJCMHVlNjc3L2lpdGZPSU9lOUNiTHE3R0tib0w4RVg3eXhKNVRLWjlYQmh5LzNCWmVNCllydEx3M2JicTNTN2hpUGFYSmE1dXZma3BWR1RnNEdzTnBJQ3VNTEJUaXJ6M0ZRV25UNFNZbzkrREVoalhEeVQKWlVOMERtUkJVNjNjWjRLSUlXd2xWUTA9Ci0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K
NODE_ENV=development

saml_federation_metadata=http://localhost.openrpa.dk/issue/FederationMetadata/2007-06/FederationMetadata.xml
saml_issuer=uri:localhost.openrpa.dk
# saml_entrypoint=http://localhost.openrpa.dk/issue
# saml_baseurl=http://localhost.openrpa.dk:1880/

allow_personal_nodered=false
allow_user_registration=true
# mongodb_url=mongodb://localhost:27017
# mongodb_db=openflow

# api_bypass_perm_check=true
update_acl_based_on_groups=true
multi_tenant=true

websocket_max_package_count=1048576

api_ws_url=wss://localhost.openrpa.dk
domain=localhost.openrpa.dk
protocol=http
amqp_url=amqp://localhost
aes_secret=7TXsxf7cn9EkUqm5h4MEWGjzkxkNCk2K
auto_create_users=true
auto_create_domains=
skip_history_collections=audit,jslog
```

Now you can run this by going to run ( Ctrl+Shit+D) and selecting OpenFlow in the dropdown box and press play button, select OpenFlowNodeRed in the dropdown and press play again

Lastly we need to start a background job that copies asserts to the dist folder, go to Terminal tab and add a new shelll, then type

`gulp`

For further help or education contact [OpenIAP](https://openrpa.dk/) for a support agreement