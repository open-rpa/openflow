# build from source

#### Building docker images
docker images can now be build completely inside docker, simply run
`npm run build`
this will start a local registry, build the images, push them to the local registry and start them. This way you can run and test all locally.

#### Developer setup

Install [VSCode](https://code.visualstudio.com/download), [NodeJS 16](https://nodejs.org/en/download/), [mongoDB](https://www.mongodb.com/download-center/community) and [RabbitMQ](https://www.rabbitmq.com/download.html)

Install gulp and typescript globally
`npm i gulp typescript browserify tsify -g`

Clone this repo into a folder, in a shell type
`git clone https://github.com/open-rpa/openflow.git`

go to the folder with openflow
`cd openflow`

install packages for openflow api/web
`npm i`

Now open in VS code
`code OpenFlow.code-workspace`
at the top level create a folder called config and inside create a file called .env ( notice it starting with a dot)
and add this content to the file

```bash
auto_create_users=true
aes_secret=7TXsxf7cn9EkUqm5h4MEWGjzkxkNCk2K
```
Next you need to allow powershell scripts to run, i don't know what is the recommended setting, i normally just go with bypass
`Set-ExecutionPolicy Bypass -Force`

Now you can run this by going to run ( Ctrl+Shit+D) and selecting OpenFlow in the dropdown box and press play button.
This will serve an empty webpage, so we need to build the stylesheets and copy the compiled files to the dist folder, so go to the Terminal tab and add a new shell, then type
`gulp sass`

Lastly we can bundle and minify the asserts to the dist folder, by typing
`gulp`

doing developerment, you can run the bundle without the minifyer by typing
`gulp watch`

You can now access openflow web on [http://localhost.openiap.io](http://localhost.openiap.io) 

For further help or education contact [OpenIAP](https://openiap.io/) for a support agreement