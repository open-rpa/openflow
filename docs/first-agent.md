# creating your first agent

In OpenIAP flow, an agent means something that can run a package. A package is a zip file with a package definition and some code files. The code can be in multiple different languages (at the time of writing this, either NodeJS, Python or .NET 6+). This code can be divided into two categories: code that runs once and exits, and code that runs as a daemon and reacts to something.

# Installation
To begin, you need to install Visual Studio Code and any language(s) you plan to develop in. For this guide, we will assume you have chosen Node.js or Python (or both).
- Download and install [Visual Studio Code](https://code.visualstudio.com/download)
- Download and install [NodeJS 16+](https://nodejs.org/en/download)
- Download and install [python 3.7+](https://www.python.org/downloads/)

**Note:** When installing, make sure to select the option to add the languages to the path.

Once installed, open Visual Studio Code and go to Extensions (Ctrl+Shift+X). Search for "OpenIAP" and install [OpenIAP assistent](https://marketplace.visualstudio.com/items?itemName=openiap.openiap-assistent)
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
If both NodeJS and Python was detected you will have a main.js and main.py file and a lunch file with confifuration for running both of these. The package.json file will also have selected the main.js as your main file, you can update this if needed.
Open Run and Debug ( Ctrl+Shift+D) and select one of the launch profiles and click run ( F5 )

First the code will create an instance of the OpenIAP client. Next we attach a function for what code we want to run when it has connected to the OpenIAP flow instance. This will ensure that if we for some reason looses connection, we can run the same code every time, like registering queues.
Next the code calles connect (and if python starts an event loop)
Once connected, 
