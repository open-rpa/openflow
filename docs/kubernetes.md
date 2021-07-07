# Kubernetes

OpenFlow was designed to run on [kubernetes](https://kubernetes.io). You can still deployed in other ways, but for most production setups, that is the recommend platform to run it on, at least for the primary site.

We use helm to deploy different deployments to kubernetes, so first install [helm](https://github.com/helm/helm/releases) simply drop this some where and add it to the path, so you can reference it from cmd/powershell. Also, make sure you have [kubectl](https://kubernetes.io/docs/tasks/tools/) installed and configured to access your kubernetes cluster.

OpenFlow depends on [traefik](https://doc.traefik.io/traefik/v1.7/user-guide/kubernetes/) as ingress controller. It's beyond the scope of this guide on how to install this in non-clouded envoriments, but if you are using GKE, aWS, Azure, Alibaba or some of the other cloud providers that has out of the box external loadbalencers, you can simpy deploy trafik with the service with type: LoadBalancer, and from here on everything "just works".

You can find an example on how to deploy traefik using help on [this page](https://github.com/open-rpa/helm-charts/tree/main/traefik-example)

I also go though this process in the video 
[![Configuring Openflow on Kubernetes](https://img.youtube.com/vi/onI_9JIAKbM/1.jpg)](https://youtu.be/onI_9JIAKbM)

So first we need to add OpenIAP's helm repo and update this and other repos you might have installed

```bash
helm repo add openiap https://open-rpa.github.io/helm-charts/
helm repo update
```

Next create a values file. To avoid confusen i recomend you name this file the same as your namespace and the "instance" you are creating. So imaging you want to deploy an openflow instance responding to demo.mydomain.com then create a file named demo.yaml

There is a ton of different settings you can fine tune, you can always find all the settings in the openflow [values file here](https://github.com/open-rpa/helm-charts/blob/main/charts/openflow/values.yaml) but you only need to add the values you want to override. So as a good starting point, add the following to your demo.yaml file

```yaml
# this will be the root domain name hence your openflow url will now be http://demo.mydomain.com 
domainsuffix: mydomain.com # this will be added to all domain names
domain: demo 
# if using a reverse procy that add ssl, uncomment below line.
# protocol: https
openflow:
#  external_mongodb_url: mongodb+srv://user:pass@cluster0.gcp.mongodb.net?retryWrites=true&w=majority
rabbitmq:
  default_pass: supersecret
# if you are using mpongodb atlas, or has mongodb running somewhere else
# uncomment below line, and external_mongodb_url in openflow above
# mongodb:
#   enabled: false
```

So first we need to create a namespace. Namespaces allow us to segregate multiple installations from each other, and ensure they run completely independently of each other.

``` sh
kubectl create namespace demo
```
and now we can create our first openflow installation inside that namespace
``` sh
helm install openflow openiap/openflow -n demo --values ./demo.yaml
```
If you update the demo.yaml values file, you can update the installation with 
``` sh
helm upgrade openflow openiap/openflow -n demo --values ./demo.yaml
```

For more help and guides, check out my youtube channel, here is a few more about kubernetes
Utilizing multiple node pools
[![Distributing workloads with nodepools](https://img.youtube.com/vi/06OmsoV-AgM/1.jpg)](https://youtu.be/06OmsoV-AgM)

After install, this will help you getting started with monitoring (premium openflow only!)
[![Configurering Reporting and Monitoring](https://img.youtube.com/vi/cyseDpnects/1.jpg)](https://youtu.be/cyseDpnects)

Performance tuning and/or troubleshooting workflows or the platform (premium openflow only!)
[![Collecting spans and custom metrics](https://img.youtube.com/vi/wlErCAJX52E/1.jpg)](https://youtu.be/wlErCAJX52E)
