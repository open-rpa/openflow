# # OpenIAP flow

OpenIAP flow is a security layer that sits on top of an installation of [MongoDB](https://www.mongodb.com/) and [RabbitMQ](https://www.rabbitmq.com/). Its purpose is to orchestrate agents, such as NodeJS, Python, NodeRED, elsa workflow, dotnet, and [OpenRPA](https://github.com/open-rpa/openrpa) agents.

The platform is designed to supplement digitalization strategies by providing an easy-to-use, highly scalable, and secure platform capable of supporting human workflows, IT system automation, and both Internet of Things (IoT) and Industry Internet of Things/Industry 4.0 automation.

If you are installing OpenIAP for the first time, we highly recommend using Docker. You can find the necessary resources and instructions to do so by visiting the OpenIAP Docker Github page: https://github.com/open-rpa/docker.

Using Docker ensures that you have all the required dependencies and configuration in place for seamless set up and deployment of OpenIAP.

Creating your first [agent package](first-agent).

Read more about the [security model here](securitymodel).

Read more about the [architecture here](architecture).

Read more about the [protocol](protocol).

Read more about [size recommendations](requirements).

#### Quick start using docker
Installing using [docker-compose](https://github.com/open-rpa/docker)

#### Examples and a few guides

Working with [versioning](versioning)

Creating your first [user form](forms_old) using the old form designer

Using the [mobile app](mobileapp)

Notes when running without internet or [behind a proxy server](proxy)

#### How to deployment on kubernetes

Installing on [kubernetes](kubernetes)

using our [helm-charts](https://github.com/open-rpa/helm-charts/)

#### How to install and manage OpenFlow using npm packages
Installing using [npm packages](npmopenflow)

Installing remote/local nodereds using [npm packages](npmnodered)

#### How to build and run from source
build [from source](buildsource)

#### Getting help from the community
Join rocket chat [#openrpa](https://rocket.openiap.io/)
or check out the [community forum](https://nn.openiap.io/)

For commercial support and access to premium features, contact [openiap](https://openiap.io/)
