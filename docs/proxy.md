# When behind a proxy server

#### Notes when used behind a proxy server or without internet

###### Used offline

OpenFlow ( and NodeRED and OpenRPA ) can run completely without internet, but it does requires some preparation. 
And the preparations heavily depend on weather you are using docker/Kubernetes or using NPM packages. 
You will need to install a local docker repository, a local NPM repository and in some cases a local NodeRED catalog. Those will get documented at a later time, please reach out to [openiap](https://openiap.io) if you want consulting on how to do this.

###### Used behind proxy

If you are testing OpenFlow using NPM packages or docker and are behind a proxy, make sure to add an HTTPS_PROXY and HTTP_PROXY global/machine level environment variable for your proxy server. If you get an error about accessing localhost.openiap.io also add NO_PROXY with the value: localhost.openiap.io

If using docker, you need to add those 2 (or 3) variables to the docker-compose file for the web instance, if using the helm chart, you need to add them to your values file under OpenFlow. This will then re-add those for all NodeRED's started, so NPM can pickup the proxy settings.
