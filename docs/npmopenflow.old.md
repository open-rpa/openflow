# deploy openflow using NPM

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

#### Quick start running openflow using npm on linux

For now only tested on ubuntu 18LTS
Install NodeJS version 14 
Also you need to have an installation of  [mongoDB](https://www.mongodb.com/download-center/community) and [RabbitMQ](https://www.rabbitmq.com/download.html)


Then to install and run OpenFlow, install the @openiap/openflow package 

`sudo npm i @openiap/openflow -g`

then create a template configuration file using 
`openflow-cli --init`

open and edit openflow.env, if needed, then install the service using

`sudo openflow-cli --install openflow`

then open a browser and visit [localhost.openiap.io](http://localhost.openiap.io) 

I also go though this process in the video 
[![Ubuntu 18 npm install](https://img.youtube.com/vi/XgeD7Bv2duY/1.jpg)](https://youtu.be/XgeD7Bv2duY)
