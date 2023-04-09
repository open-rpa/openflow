# creating your first agent

In OpenIAP flow, an agent means something that can run a package. A package is a zip file with a package definition and some code files. The code can be in multiple different languages (at the time of writing this, either NodeJS, Python or .NET 6+). This code can be divided into two categories: code that runs once and exits, and code that runs as a daemon and reacts to something.

# Installation
To begin, you need to install Visual Studio Code and any language(s) you plan to develop in. 
- Download and install [Visual Studio Code](https://code.visualstudio.com/download)
- Download and install [NodeJS 16+](https://nodejs.org/en/download)
- Optional: Download and install [python 3.7+](https://www.python.org/downloads/)
- Optional: Download and install [OpenIAP Desktop Assistant](https://github.com/openiap/assistant/releases)

**Note:** When installing, make sure to select the option to add the languages to the path.

Once installed, open Visual Studio Code and go to Extensions (Ctrl+Shift+X). Search for "OpenIAP" and install [OpenIAP assistant](https://marketplace.visualstudio.com/items?itemName=openiap.openiap-assistant)
Next, open the Palette and search for "Add OpenIAP flow instance", and follow the guide. For this demo, you can accept all the default values. When prompted for a username, just press Enter to login using the browser and create/login to your [app.openiap.io](https://app.openiap.io/#/Login) account.

As always, you can also [use your own locally installed instance](https://github.com/open-rpa/docker).

# Initializing Your Project
To begin, create an empty folder on your machine and open it in Visual Studio Code (Ctrl+K Ctrl+O).

Next, open the Palette and search for "Initialize project ... for OpenIAP instance". If you have more than one instance added, you will be prompted to select one. Otherwise, it will use the instance we just created.

If you run this command in an empty workspace, it will automatically detect which languages you have installed and add one example file for each language. It will also install any OpenIAP dependencies necessary for your project.

You should now have an .vscode folder with a launch.json file. This will contain the launch setting for each of the example files added. The settings will include 2 environment variables, apurl and jwt. If you have more OpenIAP instances added, you can swap these by calling "Initialize project" again. This way, you can quickly test your code against multiple different OpenIAP flow instances.

If Node.js was detected, it will also contain a node_modules folder, and finally, it will contain a package.json. The package.json is mandatory no matter the language you are writing in, since this is how the VS Code extension and OpenFlow agents recognize your project dependencies and how to run it. Most notably, there will be a "main" entry, which tells the agents what is the main code file for this package. It also contains an "openiap" object with the general settings for this project, like programming language and requirements for the host running it.

If Python was detected, a requirements.txt file will also be added. This is where you add any Python packages that are needed to run your code. For now, this will contain a reference to the OpenIAP package.

# Run the code
If both NodeJS and Python are detected, you'll have a `main.js` and a `main.py` file, as well as a launch file with configuration for running both of these files. The `package.json` file will also have selected `main.js` as your main file, but you can update this if needed.

To start debugging, open Run and Debug (using the shortcut Ctrl+Shift+D) and select one of the launch profiles from the list, then press run (shortcut F5).

First, the code will create an instance of the OpenIAP client. Next, we attach a function to define what code we want to run when it has connected to the OpenIAP flow instance. This ensures that if we lose connection for some reason, the same code will run every time, like registering queues.

Next, the code calls `connect()`. If using Python, it will start an event loop. Once connected, we first register and start consuming a message queue. In this example, we're using a temporary queue. In real life, it would be better to update this to be a static name or read it from an environment variable. As an example, we show how you could pop a work item off a work item queue when you receive a message.

Lastly, we demonstrate how you can query the database for a few documents in the "entities" collection.

# Deploy as package
To deploy the code, open the command palette and search for "Pack and publish to OpenIAP instance". If you have more than one instance added, you'll be prompted to select one. This will pack all files using npm and upload the package file, as well as a package definition, to the selected OpenIAP instance.

# Running package as an Agent
To run the package as an agent, first log in to your OpenFlow instance in a browser and go to Agents. Next, click "Packages" and make sure your package is listed. Click on the package to inspect its settings. Note that the package hasn't been enabled as a daemon yet - when a package is running in Docker, it's expected to be running as a daemon. Our code currently does this, but we haven't told it so.

Head back to VS Code and open `package.json`. Under "openiap," set "daemon" to "true," then deploy the package once more by opening the command palette and selecting "Pack and publish to OpenIAP instance."

Go back to your browser and reload the package page to confirm that your package has now been enabled to run as a daemon.

Click on "Agents" and "Add Agent." Make sure the image is "Agent" and that your package has been selected in the Package dropdown menu. Then click "Save". This will create an Agent definition and start the agent right away. Once the status says "Running," press the "Log" button to see a snapshot of the current console output. You may need to press it a few times, but after 30-40 seconds, you should be able to see the same output that you did when you ran the code locally.

# Runnning package in Desktop Assistant
The Desktop Assistant allow you to run packages in your desktop. This is handy if you need to run code at your local machine within your current desktop. 
Head to [OpenIAP Desktop Assistant](https://github.com/openiap/assistant/releases) and download the agent that matches your operating system. 
- [🪟windows](https://github.com/openiap/assistant/releases/latest/download/assistant-win.exe)
- [🐧linux](https://github.com/openiap/assistant/releases/latest/download/assistant-linux-x86_64.AppImage)
- [💻macos M1/M2](https://github.com/openiap/assistant/releases/latest/download/assistant-macos-arm64.dmg)
- [💻macos x64](https://github.com/openiap/assistant/releases/latest/download/assistant-macos-x64.dmg)




The first time you run it, you will be prompted to select the OpenIAP flow instance you want to be connected to. Make sure the url matches the instance you want to connect to, then click the "Connect" button. This will open your local browser and prompt you to signin to feed a token into the agent. The agent will now login and register it self as an agent in the openiap flow instance. In the browser windows click "Agents" and validate you see your agent listed by "hostname / username". 
Now go to the agent window and validate you see the agent is signed in and has listed all the packages you have access to, this should include the package we deployed above.
Now click the package link, this will start the package and you can see the console output live inside the Agent.

# Installing agent as local Daemon
The agent can also be installed on your local machine as a service or daemon. This is handy if you need to schedule running one or more packages unattended, or if a package needs access to local resources.

Open a terminal as administrator (Run as Administrator) or root (`sudo -s`) and run the following command: `npx -y @openiap/nodeagent`

This will download and install the `nodeagent` package and run it as a command-line program. By default, it will install itself as a service called “nodeagent” after asking a few questions.

First, it asks for an API URL to use; you can use the URL you saw in the `launch.json` file above. Next, it prompts you to open the URL listed in the console, in a browser, to approve the service to request a JWT token to be used for the agent. Once you have signed in, the service will be installed and start running. The service will register itself as an agent in the selected OpenIAP flow instance. So click “Agents” and validate that you now see the local daemon installed (hostname/root or localsystem). Click it to see what programming languages it detects that are supported.
