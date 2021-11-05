# Size recommendations for OpenFlow

#### Using OpenFlow without premium features:

using docker, with traefik as ingress controller
allocated around 200 to 300mb ram for RabbitMQ
allocated around 200 to 300mb ram for each API node
allocated around 100 to 200mb ram for traefik
allocated around 120 to 250mb memory for each NodeRED you want to start
allocated around as much ram as possible for MongoDB, but at least 200mb
in total for a minimum setup 1Gigabyte of ram
each image is around 500 to 1 Gigabyte and most setups takes a long time to reach the first 1 gigabyte db storage milestone so allocated at least 10 Gigabyte of disk space



#### Using OpenFlow with premium features, then add:



1) for option to use Grafana toward OpenFlow data
  This requires only starting a Grafana instance and should not require more than 50mb to 100mb of RAM (the image is 250mb so also 500mb of disk space )
2) option to use Open Telemetry to collect usage, metrics and spans and send custom tracing info from NodeRED.
  There are a few options here, but a typical setup would involve:
  allocate around 200mb to 1 gb memory for otel-collector
  allocate around 300mb to 3 gb memory for victoriametrics
  allocate around 200mb to 500mb memory for jaeger
  allocate around 500mb to 3 gb memory for cassandra, and enough disk space to hold 14 days of metrics and spans. ( 50 to 100 Gi disk space is a good starting point )
