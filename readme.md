# OpenFlow
Simple wrapper around NodeRed, RabbitMQ and MongoDB to support a more scalable NodeRed implementation.
Also the "backend" for [OpenRPA](https://github.com/open-rpa/OpenRPA)

Test it in a single user installation [here](https://app.openiap.io/)

Join rocket chat [#openrpa](https://rocket.openiap.io/)
or check out the [community forum](https://nn.openiap.io/)

Build to run on docker, how to setup docker is not supported on GitHub/slack

#### Quick start running openflow using npm on windows

[Install Chocolatey](https://chocolatey.org/install) 

open a command prompt as admin

Install rabbitmq ( answer yes to run the script )

```bash
choco install rabbitmq
```

Please ensure you can see rabbitmq as a service when you open the services.msc also make sure management got enabled ( a restart may help ). You can check this by going to [http://localhost:15672](http://localhost:15672)  ( if not, run `choco install rabbitmq --force` or follow try following the [guide here](https://www.rabbitmq.com/management.html) )

install mongodb ( answer yes to run the script )

```
choco install mongodb
```

Again make sure it got installed and is running when you open the services.msc ( if not, run `choco install mongodb --force` ) or install it manually by downloading [mongodb community](https://www.mongodb.com/try/download/community) edition

install nodejs LTS 14

```
choco install nodejs-lts
```

Make sure it works by running `node -v`  in a command prompt

install openflow command line

`npm i @openiap/openflow -g`

Go to the folder where you want to keep your config files,

```bash
mkdir c:\openflow
cd \openflow
```
install pm2 as a global package, and then install [pm2-windows-service](https://www.npmjs.com/package/pm2-windows-service)
**Important**: Say no to startup scripts PM2_SERVICE_SCRIPTS
```bash
npm i -g pm2
npm i -g pm2-windows-service
pm2-service-install
# Perform environment setup: answer yes
# Set PM2_HOME: answer yes and the type the path to the folder you intent on saving the openflow/nodered config files into ( like c:\openflow )
# PM2_SERVICE_SCRIPTS: answer no
# PM2_SERVICE_PM2_DIR: answer yes, and then accept the default path
```

then create a template configuration file using 
`openflow-cli --init`

open and edit openflow.env, if needed, then install the service using

`openflow-cli --install openflow`

then open a browser and visit [localhost.openiap.io](http://localhost.openiap.io) 

#### Quick start running openflow nodered using npm on windows

This require you to have openflow installed somewhere, or you can use our public openflow at [app.openiap.io](https://app.openiap.io) (noderedremote.env)

Create a user for the nodered in openflow, you will need the username and password for this user in the last step

[Install Chocolatey](https://chocolatey.org/install) 

open a command prompt as admin

install nodejs LTS 14

```
choco install nodejs-lts
```

install openflow-nodered command line
`npm i @openiap/nodered -g`

Go to the folder where you want to keep your config files,

```bash
mkdir c:\openflow
cd \openflow
```

install pm2 as a global package, and then install [pm2-windows-service](https://www.npmjs.com/package/pm2-windows-service)
**Important**: Say no to startup scripts PM2_SERVICE_SCRIPTS
```bash
npm i -g pm2
npm i -g pm2-windows-service
pm2-service-install
# Perform environment setup: answer yes
# Set PM2_HOME: answer yes and the type the path to the folder you intent on saving the openflow/nodered config files into ( like c:\openflow )
# PM2_SERVICE_SCRIPTS: answer no
# PM2_SERVICE_PM2_DIR: answer yes, and then accept the default path
```

then create a template configuration file using 
`openflow-nodered-cli --init`

this will create 2 environment files with an example of how to connect to a locally installed openflow or how to connect to [app.openiap.io](https://app.openiap.io)
So lets assume you want to run a remote openflow connected to [app.openiap.io](https://app.openiap.io) 

`openflow-nodered-cli --install noderedremote`

this will prompt you for a pre-created username and password, and then install a local service with the name noderedremote and start it

then open a browser and visit [localhost.openiap.io:1880](http://localhost.openiap.io:1880) 

#### Quick start running openflow using npm on linux

For now only tested on ubuntu 18LTS
Install NodeJS version 14 
Also you need to have an installation of  [mongoDB](https://www.mongodb.com/download-center/community) and [RabbitMQ](https://www.rabbitmq.com/download.html)
Importantent! You need to [enable management console](https://www.rabbitmq.com/management.html) in RabbitMQ 

Then to install and run OpenFlow, install the @openiap/openflow package 

`sudo npm i @openiap/openflow -g`

then create a template configuration file using 
`openflow-cli --init`

open and edit openflow.env, if needed, then install the service using

`sudo openflow-cli --install openflow`

then open a browser and visit [localhost.openiap.io](http://localhost.openiap.io) 

#### Quick start running openflow nodered using npm on linux

For now only tested on ubuntu 18LTS
Install NodeJS version 14
This require you to have openflow installed somewhere, or you can use our public openflow at [app.openiap.io](https://app.openiap.io) (noderedremote.env)

Create a user for the nodered in openflow, you will need the username and password for this user in the last step

Then install and run OpenFlow Nodered, install the @openiap/nodered package 
`sudo npm i @openiap/nodered -g`

then create a template configuration file using 
`openflow-nodered-cli --init`

this will create 2 environment files with an example of how to connect to a locally installed openflow or how to connect to [app.openiap.io](https://app.openiap.io)
So lets assume you want to run a remote openflow connected to [app.openiap.io](https://app.openiap.io) 

`sudo openflow-nodered-cli --install noderedremote`

this will prompt for the pre-created username and password, and then install a local service with the name noderedremote and start it

then open a browser and visit [localhost.openiap.io:1880](http://localhost.openiap.io:1880) 

#### Quick start using docker

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

Then you can access the API/web on [http://localhost.openiap.io](http://localhost.openiap.io) ( or [http://toolbox.openiap.io](http://toolbox.openiap.io) )
You can access nodered on [http://nodered1.localhost.openiap.io](http://nodered1.localhost.openiap.io) ( or [http://nodered1.toolbox.openiap.io](http://nodered1.toolbox.openiap.io) )
and RabbitMQ on  [http://mq.localhost.openiap.io](http://mq.localhost.openiap.io) ( or [http://mq.toolbox.openiap.io](http://mq.toolbox.openiap.io) )

The first username and password you try to login as, will be created and made admin

For help with running on [kubernetes](https://kubernetes.io/) or self hosting contact [OpenIAP](https://openiap.io/) for a support agreement

#### Quick start using helm to install on kubernetes

To quickly get started with your own installation on kubernetes, first install [traefik](https://doc.traefik.io/traefik/v1.7/user-guide/kubernetes/)

Each OpenFlow will have it's own namespace, and you create a value file for each instance/namespace
Create a file and call it demo1.yaml with this content

```yaml
# this will be the root domain name hence your openflow url will now be http://demo.mydomain.com 
domainsuffix: mydomain.com # this will be added to all domain names
domain: demo 
# if traefic is for https using websecure, the you can uncomment the below 2 lines
# you need to tell the name of the secret containing the certificate, I can recomend using kubed for replicating this
# protocol: https
# tlsSecret: wild.mydomain.com
openflow:
#  external_mongodb_url: mongodb+srv://user:pass@cluster0.gcp.mongodb.net?retryWrites=true&w=majority
rabbitmq:
  default_user: admin
  default_pass: supersecret
# if you are using mpongodb atlas, or has mongodb running somewhere else
# uncomment below line, and external_mongodb_url in openflow above
# mongodb:
#   enabled: false
```

First add the helm repo and  create a new namespace called demo1

``` sh
helm repo add openiap https://raw.githubusercontent.com/open-rpa/helm-repo/master/
helm repo update
kubectl create namespace demo1
```

The create the install using 

```sh
helm install openflow openiap/openflow -n demo1 --values ./demo1.yaml
```

If you late update your values file you can update your install using 

```sh
helm upgrade openflow openiap/openflow -n demo1 --values ./demo1.yaml
```

Read more about this at the [githu repo](https://github.com/open-rpa/helm-repo)

#### Developer setup

Install [VSCode](https://code.visualstudio.com/download), [NodeJS 12](https://nodejs.org/en/download/),  [mongoDB](https://www.mongodb.com/download-center/community) and [RabbitMQ](https://www.rabbitmq.com/download.html) 
You need to [enable management console](https://www.rabbitmq.com/management.html) in RabbitMQ 

Clone this repo into a folder, in a shell type

`git clone https://github.com/open-rpa/openflow.git`

go to the folder with openflow

`cd openflow`

Install gulp and typescript globally

`npm i gulp typescript browserify tsify -g`

install packages for openflow api/web

`npm i`

install packages for NodeRED by 

`cd OpenFlowNodeRED`
`npm i`

`cd ..`

Now open in VS code

`code OpenFlow.code-workspace`

at the top level create a folder called config and inside create a file called .env ( notice it starting with a dot)

and add this content to the file

```bash
nodered_id=nodered1
nodered_sa=nodered1
port=80
nodered_port=1880
tls_crt=
tls_key=
tls_ca=

signing_crt=LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURqRENDQW5TZ0F3SUJBZ0lKQUp5N0tIMTE1dkQ4TUEwR0NTcUdTSWIzRFFFQkN3VUFNRnN4Q3pBSkJnTlYKQkFZVEFrUkxNUk13RVFZRFZRUUlEQXBUYjIxbExWTjBZWFJsTVNFd0h3WURWUVFLREJoSmJuUmxjbTVsZENCWAphV1JuYVhSeklGQjBlU0JNZEdReEZEQVNCZ05WQkFNTUMzTnBaMjVwYm1kalpYSjBNQjRYRFRFNU1EUXdOekUwCk5ETXpORm9YRFRJNU1EUXdOREUwTkRNek5Gb3dXekVMTUFrR0ExVUVCaE1DUkVzeEV6QVJCZ05WQkFnTUNsTnYKYldVdFUzUmhkR1V4SVRBZkJnTlZCQW9NR0VsdWRHVnlibVYwSUZkcFpHZHBkSE1nVUhSNUlFeDBaREVVTUJJRwpBMVVFQXd3TGMybG5ibWx1WjJObGNuUXdnZ0VpTUEwR0NTcUdTSWIzRFFFQkFRVUFBNElCRHdBd2dnRUtBb0lCCkFRQy9JSkdEaGxLTU9SWkoycXQwSWpjSDZOWUFtZDVxQzQ4dkNJRE54QWZCbmQxQnN4WlVjWkl5dkFlT28yNDcKM3I0eTYwNDgxRHVUS2JaMTBTNjRqRU05aW1XTXB1TFlJRnVyQ3BWNzVEWWhxMS85Q0FJVHJqNjlmVDluSkptcwpjM2lxTnJ1Tlg1bDlISXdadWtQM1ZNRkJRNWZVd3N1ZnE0YW1NbnVnZmtyUEVzSngxK3VJb0NYU3pyblZvcnZpClZ0ZFh4a3M4N0l1S0ZnMDJIZ1RQSzdwc0FXYTBRY3g2ck04bkV5TUhwNUdlR1Rvb1NNbkcyZ1RGNWZOSVFNdTMKVEVoc2p3SWRTYmRwck1Gb1VZV05Bc2FueTJOQk0wREhZRUdjQlZhZ0xWNUhFUW5ySUM3NEhtNjYxdG9HaU5VSAoveW04U3VndTgwWVFiVGxPcTFWNnNkaVRBZ01CQUFHalV6QlJNQjBHQTFVZERnUVdCQlMrYWc1NGtITllKZ29pCm9yRnlia293THR5R3ZqQWZCZ05WSFNNRUdEQVdnQlMrYWc1NGtITllKZ29pb3JGeWJrb3dMdHlHdmpBUEJnTlYKSFJNQkFmOEVCVEFEQVFIL01BMEdDU3FHU0liM0RRRUJDd1VBQTRJQkFRQTZpZHBYdzdSR2pzcUpNanI2c1YvaQpXeXFsL2xkSy9sa1NCdnNBSENieDdQYi9rVUd2NHJNbndYMnBHdTR0YkFnSDc4eStmS3dzazllYkxDeTA4Y1k0Ckt5czhzbUpLenhWN0R6U3RVR1NvZmZMaFliVVVMK3UyNU5vVXc0TG1WQU5FU0NaMTZ3aTdPQUdJMkJnNFR6TXoKdnlIUHRaaE9wTXBNV2lzM2ZnRXFzV3QxS2VLcXo0Z2M5RnJtZDZPNlQzVVAxWTRBR3VEWnNScnpiU2RQS2JxbApxekprT2tQcGtHOGo3ZjFWNkk1ZlkzblZaSWk2YW1TcTM1RTJkQzVMY0dIQXRtT1lWL0c4TEQ3OUFnTVpFUU5vCkF2R2RnV1gvbXBFVkFjMmRFQkJlcUN6WjF1aVhWUjdERld2ZDFKTEpsdVRyTm9jMUROc0xNKzNEZFFiQ2JnYVcKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=
singing_key=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2UUlCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQy9JSkdEaGxLTU9SWkoKMnF0MElqY0g2TllBbWQ1cUM0OHZDSUROeEFmQm5kMUJzeFpVY1pJeXZBZU9vMjQ3M3I0eTYwNDgxRHVUS2JaMQowUzY0akVNOWltV01wdUxZSUZ1ckNwVjc1RFlocTEvOUNBSVRyajY5ZlQ5bkpKbXNjM2lxTnJ1Tlg1bDlISXdaCnVrUDNWTUZCUTVmVXdzdWZxNGFtTW51Z2ZrclBFc0p4MSt1SW9DWFN6cm5Wb3J2aVZ0ZFh4a3M4N0l1S0ZnMDIKSGdUUEs3cHNBV2EwUWN4NnJNOG5FeU1IcDVHZUdUb29TTW5HMmdURjVmTklRTXUzVEVoc2p3SWRTYmRwck1GbwpVWVdOQXNhbnkyTkJNMERIWUVHY0JWYWdMVjVIRVFucklDNzRIbTY2MXRvR2lOVUgveW04U3VndTgwWVFiVGxPCnExVjZzZGlUQWdNQkFBRUNnZ0VBVXBjZ1NsV2hGamNWQ3BVVHdmdUhERVB4TmhGSHEwdVRkQitZaVZKTWg3NVAKL2pRRlVqaEJsT3JyMlJlR2F4aTEyQXNXby9LU1MrV2Frdzd4d1kzYkFKenRoUG9Zekl3dkVKcGlQa2MvblEwUgpUYVpJUDNqc1k3WGIwQlpnMGNTVVAvbW0wbENkWXhNUzk0c21FNXJzWitkdGxPTVlXc2NrU0cxSVB2SlVJV2FZCnl3NC9kaHJ3TWRsREVZS2tSbks1aDR1dXR1dzA1Q1VzNkZWN2F5cEJRRStGM3RxVlF3QWxGbWNueXdvZTB5WjQKZW1tWkRvT1dzNUk4cGNGbjZCSW1wZjN3UEg5UWhlQXJVaXRqV3YrZmI2cWRVaHJFVDBxMzh4dTZ5M1lJNFNLYQpXME9kUng4L3FTYllXdkpzbmxscDR0aUpDWE5IdnV6MVBKSGhxOUprQVFLQmdRRCt2dHlWcVJoaEJZTmd6WWorClFCaDNLcktrNEVqTXZaSGhEelhES0pMZ2JEVmJzNExrQkYySWZGOTF0S1k3d09CNVpXcU82Z3FqVVJBVE5hc1YKOExCOGE2TEpXYVJuTklLMnJkd1FwalFYcy92OVBSYnJwc2tTbDRJdUsyZWNBMjBSQkhicW5yNHZ5ZkQ4U3BzaApSdHlTUk5CRGVsaU01Z1JDM0JKKzBZbjBVUUtCZ1FEQUVZSUp3Y2xnQloyWmNNTlh1dW1lLzUxdHBHeGppRTJpCjZ3SDNsOHNTVDN1U1A4MHdndGdHaVFsUTRsR3BmSThqWkl4N0pwcGw0Qko1ZEtuVnpIS1dqMzA3YXYxcjdpU3QKLzJOVDNobzdaYkNlYzlhMHlJU2E3dTNGZGxzZ0VPcE45dURmbG5GQVQ3ZmIrM2d4Sk9DUWp1TkFCZXZaK2pScwpZY0ZhQWhGNW93S0JnUUNGUG9HVVNsRDFGblFrWXYwL3QzalVnK0hTK1hrNmxnRkNqYmthTGhPOURQeFB6Ykl0CjM5YW9lQjFhTExZeVZPMVVzZVl0Z0Y4MkUwVnNOc3NZKzc3a0pVeU5NclVhUWs0SWpTR3BGN1h4bS9PMi9vZ0oKbEVCaDJCdUFXTFdsMWVqcldNRjJjTGVidVcyeUdMZlJqUVg3LzhCTE95Z3I4bmZTSE5nVHV6Z0VNUUtCZ0JrZgpNUjhObGNWVmRyT25LQ1hGY09FM0ZlUk5hVS9yZUJ3akdQTEZpKzR0TDBDRno5VFVpR1R5YjZHQXVLV3VnUnBrCkFHdnJOSzYyakRRT3FsZ29rYVJYeUUySlJQUmxCYThzaEZWbjY0NXhVcFNuR2lJelNBVHIwM1hNY1ViVWI1RWIKQlhhNU9yN3FybVc3a3BENi9kUnFuQmEzcjQyblNFd1V6VEYwcTh4NUFvR0FIcXdRSyt1R0NTdlNsNENJUGhyRQpDREIvcytDK2NJNXVCeFJCMHVlNjc3L2lpdGZPSU9lOUNiTHE3R0tib0w4RVg3eXhKNVRLWjlYQmh5LzNCWmVNCllydEx3M2JicTNTN2hpUGFYSmE1dXZma3BWR1RnNEdzTnBJQ3VNTEJUaXJ6M0ZRV25UNFNZbzkrREVoalhEeVQKWlVOMERtUkJVNjNjWjRLSUlXd2xWUTA9Ci0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0K
NODE_ENV=development

saml_federation_metadata=http://localhost.openiap.io/issue/FederationMetadata/2007-06/FederationMetadata.xml
saml_issuer=uri:localhost.openiap.io
# saml_entrypoint=http://localhost.openiap.io/issue
# saml_baseurl=http://localhost.openiap.io:1880/

allow_personal_nodered=false
allow_user_registration=true
# mongodb_url=mongodb://localhost:27017
# mongodb_db=openflow

# api_bypass_perm_check=true
update_acl_based_on_groups=true
multi_tenant=false

websocket_max_package_count=1048576

api_ws_url=ws://localhost.openiap.io
domain=localhost.openiap.io
protocol=http
amqp_url=amqp://localhost
aes_secret=7TXsxf7cn9EkUqm5h4MEWGjzkxkNCk2K
auto_create_users=true
auto_create_domains=
skip_history_collections=audit,jslog
```
Lastly you need to allow powershell scripts to run, i don't know what is the recommended setting, i normally just go with bypass

`Set-ExecutionPolicy Bypass -Force`

Now you can run this by going to run ( Ctrl+Shit+D) and selecting OpenFlow in the dropdown box and press play button, select OpenFlowNodeRed in the dropdown and press play again

Now, this will serve an empty webpage, so we need to build the stylesheets and copy the compiled files to the dist folder, so go to the Terminal tab and add a new shelll, then type

`gulp sass`

Lastly we can bundle and minify the asserts to the dist folder, by typing

`gulp`

doing developerment, you can run the bundle without the minifyer by typing

`gulp watch`

You can now access openflow web on [http://localhost.openiap.io](http://localhost.openiap.io) and nodered on [http://localhost.openiap.io:1880](http://localhost.openiap.io:1880)

For further help or education contact [OpenIAP](https://openiap.io/) for a support agreement