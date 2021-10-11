# protocol used by openflow

#### Intro

Most programming languages have support for connecting to a web socket. 
Examples in [C#](https://github.com/open-rpa/openrpa/blob/master/OpenRPA.Net/WebSocketClient.cs#L56) or [JavaScript](https://github.com/open-rpa/openflow/blob/master/OpenFlowNodeRED/src/cli.ts#L72) 

Encryption of data should be handled by the HTTP(s) transport, since we always recommend using certificates on your ingress controller.

Once connected, the first thing you need to to us authenticate by sending a "signin" command.

Your client must reply/acknowledge all commands ( like reply "pong" to all "ping" commands )

You client should either leave out JWT on all commands.
Or use the temporary JWT send by OpenFlow every 10 minutes in a "refreshtoken" command. ( This is to update the token with changes, like updated role member ships )

You can change user context for specific commands, but supplying a different JWT in the command.

#### Message Structure

We send pure UTF8 text over the socket. All messages have this base format

```json
{
    "id": "ai13fykmi",
    "index": "0",
    "count": "1",
    "replyto": "",
    "data": "{....}",
}	
```

You must generate an unique id for each command. If the data cannot fit in one message, you send multiple messages with the same id, for all messages also supply the total count and the current index starting at 0.
If you are sending a reply to a message you must set replyto to the id of the message you are replying too.
Data is a STRING representation of the command JSON.

#### Command structure

The list of commands get extended once in a while, currently there is 47 commands.

All commands generally contains the following fields

```json
{
    "error": "Something went wrong",
	"jwt": "",
    "result": {"name": "value"} | [{"name": "value"}, {"name": "value"}],
}
```

For commands with no result, result can be left out. Some commands send one result, others will return an array of results. As mentioned before, if you receive a command you **must** reply. 

#### Command list

All commands can be found [here](https://github.com/open-rpa/openflow-api/tree/master/src/Message) . 
Below some of these will be documented in more details later
