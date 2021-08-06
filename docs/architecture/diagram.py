from diagrams import Cluster, Diagram
from diagrams.aws.compute import ECS, EC2
from diagrams.onprem.database import Mongodb
from diagrams.onprem.queue import Rabbitmq
from diagrams.gcp.analytics import BigQuery, Dataflow, PubSub
from diagrams.programming.language import Nodejs
from diagrams.onprem.monitoring import Grafana, Prometheus
from diagrams.aws.database import RDS
from diagrams.aws.network import ELB
from diagrams.aws.storage import S3
from diagrams.onprem.network import Traefik
from diagrams.custom import Custom
from diagrams.onprem.tracing import Jaeger
from diagrams.onprem.database import Cassandra

with Diagram("OpenFlow Basic"):
    with Cluster("Backend"):
        b = [Mongodb("MongoDB"), Rabbitmq("RabbitMQ")]
    with Cluster("Remote Clients"):
        rc = [Custom("OpenRPA", "./my_resources/open_rpa128.png"), Custom("PowerShell",
                                                                          "./my_resources/PowerShell_5.0_icon.png"), Custom("NodeRED", "./my_resources/node-red-icon.png")]
    with Cluster("Frontend + API"):
        api = EC2("WEB-API")
        Custom("NodeRED", "./my_resources/node-red-icon.png")
    b << api
    api << rc

with Diagram("OpenFlow with Traefik"):

    with Cluster("Backend"):
        b = [Mongodb("MongoDB"), Rabbitmq("RabbitMQ")]

    with Cluster("Remote Clients"):
        rc = [Custom("OpenRPA", "./my_resources/open_rpa128.png"), Custom("PowerShell",
                                                                          "./my_resources/PowerShell_5.0_icon.png"), Custom("NodeRED", "./my_resources/node-red-icon.png")]

    with Cluster("Frontend + API"):
        api = EC2("WEB-API")
        cn = Custom("NodeRED", "./my_resources/node-red-icon.png")

    t = Traefik("Traefik")

    b << api
    cn << t
    api << t
    t << rc


with Diagram("OpenFlow with Monitoring"):

    with Cluster("Backend"):
        b = [Mongodb("MongoDB"), Rabbitmq("RabbitMQ")]

    with Cluster("Remote Clients"):
        rc = [Custom("OpenRPA", "./my_resources/open_rpa128.png"), Custom("PowerShell",
                                                                          "./my_resources/PowerShell_5.0_icon.png"), Custom("NodeRED", "./my_resources/node-red-icon.png")]

    with Cluster("Frontend + API"):
        api = EC2("WEB-API")
        cn = Custom("NodeRED", "./my_resources/node-red-icon.png")

    with Cluster("Monitoring"):
        g = Grafana("Grafana")
        p = Prometheus("Prometheus")
        otel = EC2("Open Telemetry")
        j = Jaeger("Jaeger")
        c = Cassandra("Cassandra")

    t = Traefik("Traefik")

    b << api
    cn << t
    api << t
    t << rc

    otel << b
    otel << rc
    otel << api
    otel << cn

    c << j
    j << otel

    p << otel
    p << g
    api << g
    g << t
