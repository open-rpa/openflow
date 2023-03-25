# protocol used by OpenIAP flow

#### Intro

Before 1.5 OpenAIP flow only supported websockets ( and way way back rest+OData )
Moving forward it will support the old wbebsocket protocol and the new protocol as described below.
This is to keep supporting older versions of OpenRPA and NodeRED. At some point the old version might be removed, but for now it's the plan to keep it for backward compatability.

Moving forward we will now use protobuf as the base protocol. This allows us to ensure the same look and feel undependenly of the programming language used for communicating with OpenIAP flow. OpenIAP Flow it self uses the [nodeapi](https://github.com/openiap/nodeapi) implementation, that functions as both a server and client package. 
All proto3 files can be found at this [github](https://github.com/openiap/proto) repository. All api implementations uses this repository for generating and parsing the messages to and from OpenIAP flow.
These message can then be send over multiple different base protocols. 
Currently those are
- [GRPC](https://grpc.io/)
- websocket
- TCP socket
- NamedPipes
- Experimental REST support over http ( cannot do streaming )

#### Message and Service Structure

All messages will be sent using the Envelope message.
```
message Envelope {
  string command = 1;
  int32 priority = 2;
  int32 seq = 3;
  string id = 4;
  string rid = 5;
  google.protobuf.Any data = 6;
  string jwt = 7;
  string traceid = 8;
  string spanid = 9;
}
```
- `id` When sending a message you must generate an unique id for the message
- `rid` when replying to a message you must also include the id of the message you are responging to in rid.
- `seq` every message must include a sequence number, starting at 0 and incrementing by one for every messsage sent. If server recevies two messsage with same seq number it will disconnect the client. If server receives messages out of sync it will order them before processing
- `jwt` if a message needs to be processed using a different token, this field can be used. Think of it as impersonating anther user, but only for this messsage.
- `traceid`/`spanid` used for collecting spans across applications with [OpenTelemetry](https://opentelemetry.io/)
- `data` the message you want to sent
When packing the Any message type_url MUST math the `command` ( for instance if sending a signin message, command must be `signin` and type_url must be `type.googleapis.com/openiap.SigninRequest` )
- `priority` when OpenIAP flow has enable_openflow_amqp enabled, this sets the priority on the message. 
We recomend using priority 2 for UI messages, and priority 1 for everything else. This way the UI will always be responsive even under heavy load. For all non essential things like batch processing use priority 0. By default priority 0 to 3 is enabled in rabbitmq

Certain commands will setup a stream to receive multiple message on the same request. For instance download/upload file will create a stream for sending the file content.
If you send DownloadRequest in Envelop with id 5 then OpenIAP flow will send multiple message with envelop rid 4. First you receive a a BeginStream, then X number of Stream messges with the file centet and then a EndStream message. Finally you will receive a DownloadResponse containing detailed informaiton about the file and folwdown proces.

