# deploy openflow nodered using NPM

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

I also go though this process in the video 
[![Ubuntu 18 npm install](https://img.youtube.com/vi/XgeD7Bv2duY/1.jpg)](https://youtu.be/XgeD7Bv2duY)
