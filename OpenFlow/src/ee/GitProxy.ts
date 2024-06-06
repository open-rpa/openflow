import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Config } from "../Config.js";
import express from "express";
import { Span } from "@opentelemetry/api";
import { WebServer } from "../WebServer.js";
import { User,  Rights } from "@openiap/openflow-api";
import { Auth } from "../Auth.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import mimetype from "mimetype";
import _ from "angular-route";
export class GitProxy {
  static repos: any = {};
  static async configure(app: express.Express, parent: Span): Promise<void> {
    const { MongoGitRepository, tools } = await import("@openiap/cloud-git-mongodb");
    tools.setDebugHandler((...args) => {
      if(Config.log_git) {
        let msg = "";
        for(let i = 0; i < args.length; i++) {
          const arg = args[i];
          if(typeof arg == "string") {
            msg += " " + arg;
          } else {
            msg += " " + JSON.stringify(arg);
          }
        }
        Logger.instanse.debug(msg.trim(), null, { cls: "GitProxy" });
      }
    });

    app.all("/git*", async (req, res, next) => {
      if(Config.enable_gitserver == false) return res.status(404).send("Git not enabled");
      const mongocol = "git";
      const urlPath = req.path.substring(4);
      const method = req.method.toUpperCase();
      const remoteip = WebServer.remoteip(req as any);
      Logger.instanse.debug("[" + method + "] " + urlPath + " from " + remoteip, null, { cls: "GitProxy" });
      try {
        var jwt = await GitProxy.GetToken(req);
        if((jwt == null || jwt == "")) {
          if(Config.enable_gitserver_guest == false && Config.enable_gitserver_guest_create == false) {
            res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
            return res.status(401).send("Authentication required.")
          } else {
            jwt = await Auth.User2Token(Crypt.guestUser(), Config.shorttoken_expires_in, null);
          }
        }
        // @ts-ignore
        req.jwt = jwt;
        req.user = await Auth.Token2User(jwt, null);
  
        var url = urlPath;
        if(url.indexOf("?") > 0) { url = url.substring(0, url.indexOf("?")); }
        if(url.startsWith("/")) { url = url.substring(1); }
        if(url.toLowerCase().startsWith("git/")) { url = url.substring(4); }
        if(url.toLowerCase() == "git") { url = ""; }
        let parts = url.split("/");
        let reponame = parts[0];
        let ownername = "";
        if(parts.length > 1) {
          ownername = parts[0];
          reponame = parts[1];
        }
        if(reponame != "") {
          if(reponame == "info"|| reponame == "git-upload-pack" || reponame == "git-receive-pack" || reponame == "delete" || reponame == "snapshot"
          || reponame == "tree" || reponame == "tag" || reponame == "blob") {
            reponame = ownername
            ownername = "";
          } else if (ownername != "") {
            reponame = ownername + "/" + reponame;
          }
        } else {
          reponame = ownername;
          ownername = "";
        }

        let repo = GitProxy.repos[reponame];
        if (repo == null && reponame != null && reponame != "") {
          repo = new MongoGitRepository(Config.db.db, mongocol, reponame);
          GitProxy.repos[reponame] = repo;
          repo.authorize = async (req, res, next) => {
            if(req.user == null) {
              res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
              return res.status(401).send("Authentication required.")
            }
            let right = Rights.read;
            var url = req.originalUrl;
            if(url.indexOf("?") > 0) {
              url = url.substring(0, url.indexOf("?"));
            }
            let parts = url.split("/");
            if(parts[parts.length - 1] == "git-receive-pack") {
              right = Rights.update;
            }
            var arr = await repo.collection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
            if (arr != null && arr.length > 0) {
              const main = arr[0];
              if (!DatabaseConnection.hasAuthorization(req.user, main as any, right)) {
                res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
                Logger.instanse.error("Access denied to update " + repo.repoName + " (for " + (req.user as any).name + ")", null, { cls: "GitProxy" });
                return res.status(401).send("Access denied to update " + repo.repoName + " (for " + (req.user as any).name + ")")
              }
            } else {
              // new
              if(parts[parts.length - 1] == "git-receive-pack") {
                if((req.user as any).username == "guest" && Config.enable_gitserver_guest_create == false) {
                  res.set("WWW-AuthehasRolenticate", `Basic realm="${Config.domain}"`)
                  Logger.instanse.error("Access denied to create " + repo.repoName + " for guest", null, { cls: "GitProxy" });
                  return res.status(401).send("Access denied to create " + repo.repoName + " for guest")
                }
                if(ownername == (req.user as any).username) {
                } else if(ownername == "" && reponame == (req.user as any).username && reponame != "guest") {
                } else if(req.user != null && req.user.HasRoleName != null && req.user.HasRoleName("admins")) {
                } else {
                  res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
                  Logger.instanse.error("Access denied to create " + repo.repoName + " for " + (req.user as any).name, null, { cls: "GitProxy" });
                  return res.status(401).send("Access denied to create " + repo.repoName + " for " + (req.user as any).name)
                }
              }
            }
            next();
          }
      
          repo.createExpress(app, "/git/" + reponame);
        }
        if(repo != null && repo.ignoreRequest(req)) {
          return next();
        } else {
          if(repo != null) {
            // var arr = await repo.collection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
            var arr = await repo.collection.find({ repo: repo.repoName, _type: "hash" }).toArray()
            if (arr != null && arr.length > 0) {
              const main = arr[0];
              if (!DatabaseConnection.hasAuthorization(req.user as any, main as any, Rights.read)) {
                return res.status(401).send("Access denied to read (for " + (req.user as any).name + ")")
              }
            } else {
              return res.status(404).send("Access denied or repo not found (for " + (req.user as any).name + ")")
            }
          }
        }
        let tree = "";
        let blob = "";
        let type = "tree";
        if(parts.indexOf("tree") > 0) { 
          if(repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("tree");
          type = "tree";
          if(parts.length > idx + 1) { 
            tree = decodeURIComponent(parts[idx + 1]);
          } else {
            if(repo == null) { return res.status(404).send("Not Found (no tree specefied)"); }
          }
          if(parts.length > idx + 2) {
            let blobs = [];
            for(let i = idx + 2; i < parts.length; i++) {
              blobs.push(decodeURIComponent(parts[i]));
            }
            blob = blobs.join("/");          
          }
        }
        if(parts.indexOf("tag") > 0) { 
          if(repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("tag");
          type = "tag";
          if(parts.length > idx + 1) { 
            tree = decodeURIComponent(parts[idx + 1]);
          } else {
            if(repo == null) { return res.status(404).send("Not Found (no tree specefied)"); }
          }
          if(parts.length > idx + 2) {
            let blobs = [];
            for(let i = idx + 2; i < parts.length; i++) {
              blobs.push(decodeURIComponent(parts[i]));
            }
            blob = blobs.join("/");          
          }
        }
        if(parts.indexOf("blob") > 0) { 
          if(repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("blob");
          if(parts.length > idx + 1) { 
            tree = decodeURIComponent(parts[idx + 1]);
          }
          let blobs = [];
          for(let i = idx + 2; i < parts.length; i++) {
            blobs.push(decodeURIComponent(parts[i]));
          }
          blob = blobs.join("/");
          if(blob == "") {
            if(repo == null) { return res.status(404).send("Not Found (no blob specefied)"); }
          }
        }
        let deleterequest = false;
        let snapshotrequest = false;
        if(parts.indexOf("delete") > 0) {
          if(repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("delete");
          if(idx == parts.length - 1) deleterequest = true;
        } else if (parts.indexOf("snapshot") > 0) {
          if(repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("snapshot");
          if(idx == parts.length - 1) snapshotrequest = true;
        }


        parts = url.replace(reponame, "").split("/").filter(x => x != "");


        if(repo == null) {
          if(req.method == "POST") {
            if(req.body != null && req.body.reponame != null) {
              const exists = await Config.db.GetOne<any>({ collectionname: mongocol, query: { repo: req.body.reponame }, jwt: Crypt.rootToken()}, parent);
              if(exists != null) {
                res.status(409).send("Repo already exists");
                next();
                return;
              }
              let reponame = req.body.reponame;
              parts = reponame.split("/");
              let ownername = "";
              if(parts.length > 1) {
                ownername =  parts[0];
                reponame = parts[1];
              }
              if(reponame != "") {
                if(reponame == "info"|| reponame == "git-upload-pack" || reponame == "git-receive-pack" || reponame == "delete" || reponame == "snapshot"
                || reponame == "tree" || reponame == "tag" || reponame == "blob") {
                  reponame = ownername
                  ownername = "";
                } else if (ownername != "") {
                  reponame = ownername + "/" + reponame;
                }
              } else {
                reponame = ownername;
                ownername = "";
              }
              const newbranch = {
                _type: "hash",
                _acl: [{_id: (req.user as any)._id, name: (req.user as any).name, rights: Rights.full_control}],
                name: "HEAD " + reponame,
                ref: "HEAD",
                repo: reponame,
                headref: null,
                sha: null
                // headref: "refs/heads/main",
                // sha: ""
              }

              if((req.user as any).username == "guest" && Config.enable_gitserver_guest_create == false) {
                res.set("WWW-AuthehasRolenticate", `Basic realm="${Config.domain}"`)
                Logger.instanse.error("Access denied to create " + req.body.reponame + " for guest", null, { cls: "GitProxy" });
                return res.status(500).send("Access denied to create for guest")
              }
              if(ownername == (req.user as any).username) {
              } else if(ownername == "" && reponame == (req.user as any).username && reponame != "guest") {
              } else if(req.user != null && (req.user as any).HasRoleName != null && (req.user as any).HasRoleName("admins")) {
              } else {
                res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
                Logger.instanse.error("Access denied to create " + req.body.reponame + " for " + (req.user as any).name, null, { cls: "GitProxy" });
                return res.status(500).send("Access denied to create (for " + (req.user as any).name + ")")
              }
              await Config.db.InsertOne<any>(newbranch, "git", 1, true, Crypt.rootToken(), parent);
              repo = new MongoGitRepository(Config.db.db, mongocol, reponame);
              repo._acl = newbranch._acl;
              GitProxy.repos[reponame] = repo;
              repo.createExpress(app, "/git/" + reponame);
              // redirect to new repo
              res.redirect("/git/" + reponame);
              next();
              return;
            }
            res.status(404).send("Not Found");
            next();
            return;
        }
          var _repos = await Config.db.distinct({ collectionname: mongocol, field: "repo", query: {}, jwt}, parent);
          var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="/#/Entities/git">Permissions</a><ul>`;
          for(var i = 0; i < _repos.length; i++) {
            html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a>`;
            // html += ` <a href="/git/${_repos[i]}/snapshot">snapshot</a>`;
            html += ` <a href="/git/${_repos[i]}/delete">del</a></li>`;
          }
          var keys = Object.keys(GitProxy.repos);
          for(var i = 0; i < keys.length; i++) {
            let key = keys[i];
            if(GitProxy.repos[key].db != null) continue;
            html += `<li><a href="/git/${key}">${key}</a>`;
          }
          html += "</ul>"
//           if((req.user as any).name == "guest") {
//             html += `<p>Create new as Guest:<br /><pre>echo "# Update me" >> README.md
// git init
// git add README.md
// git commit -m "first commit"
// git branch -M main
// git remote add origin https://${Config.domain}/git/guest/reponame
// git push -u origin main</pre></p>`
//           } else {
//             const longtoken = await Auth.User2Token(req.user as any, Config.longtoken_expires_in, null);
//             html += `<p>Create new:<br /><pre>echo "# Update me" >> README.md
// git init
// git add README.md
// git commit -m "first commit"
// git branch -M main
// git remote add origin https://${Config.domain}/git/${(req.user as any).username.replace("@", "_")}/reponame
// git config --local http.extraHeader "Authorization: Bearer ${longtoken}"
// git push -u origin main</pre></p>`
//             // html += `<p>Create new:<br /><pre>git clone https://${Config.domain}/git/${(req.user as any).username}/reponame -c http.extraHeader="Authorization: Bearer ${longtoken}"\ncd reponame\ngit push -u origin master</pre></p>`
//           }

          html += "<form action=/git method=post>";
          if((req.user as any) != null && (req.user as any).HasRoleName != null && (req.user as any).HasRoleName("admins")) {
            html += "Create new:<br /><input type=text name=reponame placeholder=reponame>";
          } else {
            html += `Create new:<br /><input type=text name=reponame value='${(req.user as any).username.replace("@", "_")}/reponame'>`;
          }
          html += "<input type=submit value=Create>";
          html += "</form>";
          html += "</body></html>"; 
          res.status(200).send(html);
          next();
        } else if(tree == "" && deleterequest == false && snapshotrequest == false) {
          var branches = await repo.GetBranches();
          branches.sort((a, b) => a.ref.localeCompare(b.ref));
          var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="/#/Entities/git">Permissions</a><ul>`;
          html += `<style>
pre {
  background-color: #f5f5f5;
  padding: 10px;
  border: 1px solid #ddd;
}
button {
  margin-top: 10px;
}
</style>
<script>
  function copyToClipboard(id) {
    const codeBlock = document.getElementById(id).innerText;
    const textArea = document.createElement('textarea');
    textArea.value = codeBlock;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
</script>`
          for(let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if(ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            html += `<li><a href="/git/${reponame}/${type}/${encodeURIComponent(ref)}">branch ${ref}</a>`;
            html += ` <a href="/git/${reponame}/${type}/${encodeURIComponent(ref)}/snapshot">snapshot</a></li>`;
          }
          const parts = repo.repoName.split("/");
          html += `</ul>` 
          const main = branches.find(x => x.ref == "HEAD");
          let mainref = "";
          if(main != null) {
            const mainb = branches.find(x => x.sha == main.sha && x.ref != "HEAD");
            mainref = mainb?.ref;
            if(mainref != null) {
              mainref = mainref.split("/")[mainref.split("/").length - 1]
              type = "tree";
            }
          }
          if(branches.length > 1 && mainref != "" && mainref != null) {
            // if((req.user as any).name == "guest") {
            //   html += `<p>To clone as guest:<button onclick="copyToClipboard('guest1')">Copy</button><br /><pre id="guest1">rm -rf ${parts[parts.length - 1]} && git clone https://${Config.domain}/git/${repo.repoName} && code ${parts[parts.length - 1]}</pre></p>`
            // } else {
            //   const longtoken = await Auth.User2Token(req.user as any, Config.longtoken_expires_in, null);
            //   html += `<p>To clone with token:<button onclick="copyToClipboard('user1')">Copy</button><br /><pre id="user1">rm -rf ${parts[parts.length - 1]} && git clone https://${Config.domain}/git/${repo.repoName} -c http.extraHeader="Authorization: Bearer ${longtoken}" && code ${parts[parts.length - 1]}</pre></p>`
            // }
            return res.redirect(`/git/${reponame}/${type}/${encodeURIComponent(mainref)}`);
          } else {
            if((req.user as any).name == "guest") {
              html += `<p>or push an existing repository from the command line:<button onclick="copyToClipboard('guest2')">Copy</button><br /><pre id="guest2">git remote add origin https://${Config.domain}/git/${repo.repoName}\ngit push -u origin main\ngit push origin --all && git push origin --tags</pre></p>`
            } else  {
              const longtoken = await Auth.User2Token(req.user as any, Config.longtoken_expires_in, null);
              html += `<p>create a new repository on the command line:<button onclick="copyToClipboard('user2')">Copy</button> <br><pre id="user2">echo "# ${parts[parts.length - 1]}" >> README.md
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://${Config.domain}/git/${repo.repoName}
git config --local http.extraHeader "Authorization: Bearer ${longtoken}"
git push -u origin main</pre></p>`
              html += `<p>or push an existing repository from the command line: <button onclick="copyToClipboard('user3')">Copy</button><br /><pre id="user3">git remote add origin https://${Config.domain}/git/${repo.repoName}\ngit config --local http.extraHeader "Authorization: Bearer ${longtoken}"\ngit push -u origin main\ngit push origin --all && git push origin --tags</pre></p>`
}
          }

          html += `</body></html>`; 
          res.status(200).send(html);
          next();
        } else if(deleterequest == false && snapshotrequest == false) {
          let files:any[] = [];
          var branches = await repo.GetBranches();
          var branch = branches.find(x => x.ref == "refs/" + (type == 'tree' ? 'heads' : type) + "/" + tree );
          if(branch == null) {
            return res.status(404).send("File not found");
          }
          files = await repo.GetTree(branch.sha, false);

          let blobentry = null;
          if(blob != "") {
            var blobparts = blob.split("/").filter(x => x != "");
            for(let i = 0; i < blobparts.length; i++) {
              let file = files.find(x => x.name == blobparts[i]);
              if(file == null) {
                return res.status(404).send("File not found");
              }
              if(i < blobparts.length - 1) {
                if(file.mode != 40000 && file.mode != 16384) {
                  return res.status(404).send("File not found");
                }
                files = await repo.GetTree(file.sha, false);
              } else {
                blobentry = file;
                if(file.mode == 40000 || file.mode == 16384) {
                  files = await repo.GetTree(file.sha, false);
                }
              }
            }            
          }
          var html = `<body><a href="/git">repos</a> | <a href="javascript:history.back()">Go Back</a><ul>`;
          let codeblock = "";
          const parts = repo.repoName.split("/");
          if((req.user as any).name == "guest") {
            codeblock = `rm -rf ${parts[parts.length - 1]} && git clone https://${Config.domain}/git/${repo.repoName} && code ${parts[parts.length - 1]}`
          } else {
            const longtoken = await Auth.User2Token(req.user as any, Config.longtoken_expires_in, null);
            codeblock = `rm -rf ${parts[parts.length - 1]} && git clone https://${Config.domain}/git/${repo.repoName} -c http.extraHeader="Authorization: Bearer ${longtoken}" && code ${parts[parts.length - 1]}`
          }

          html += `<style>
          pre {
            background-color: #f5f5f5;
            padding: 10px;
            border: 1px solid #ddd;
          }
          button {
            margin-top: 10px;
          }
          </style>
          <script>
            function copyToClipboard(id) {
              const codeBlock = \`${codeblock}\`;
              const textArea = document.createElement('textarea');
              textArea.value = codeBlock;
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
            }
          </script>`
          html += `branch: <select onchange="window.location.href = this.value">`;
          for(let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if(ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            if(branches[i].ref.indexOf("refs/heads/") == 0) {
              html += `<option value="/git/${reponame}/tree/${encodeURIComponent(ref)}"`;
              if(ref == tree) html += ` selected`;
              html += `>branch ${ref}</option>`;
            }
          }
          for(let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if(ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            if(branches[i].ref.indexOf("refs/tags/") == 0) {
              html += `<option value="/git/${reponame}/tag/${encodeURIComponent(ref)}"`;
              if(ref == tree) html += ` selected`;
              html += `>tag ${ref}</option>`;
            }
          }
          html += `</select><button onclick="copyToClipboard('clone')">Copy clone command</button><br />`;
          if(blobentry != null && blobentry.mode != 40000 && blobentry.mode != 16384) {
            const contentType = mimetype.lookup(blobentry.name) || "application/octet-stream";
            if (req.query.download != null) {
              res.set({
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${blobentry.name}"`,
              });
              if(repo.db != null) {
                const file = await repo.db.collection(repo.bucketName + ".files").findOne({ "filename": `blob_${blobentry.sha}` });
                const downloadStream = repo.bucket.openDownloadStream(file._id);
                downloadStream.pipe(res);
              } else {
                res.status(200).send((await repo.getObject(undefined, blobentry.sha)).data);
              }
              return;
            }
            var treeobj = await repo.getObject(null, blobentry.sha);
            var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="javascript:history.back()">Go Back</a>`;
            if(contentType.startsWith("image")) {
              html += `<p><img src="data:${contentType};base64,${treeobj.data.toString("base64")}"></p>`;
            } else {
              html += "<p><pre>" + treeobj.data.toString("utf8") + "</p></pre>"
            }
            html += "</ul></body></html>";
            res.status(200).send(html);
            next();
            return;
          }

          let basepath = `/git/${reponame}/${type}/${encodeURIComponent(tree)}/`;
          let baseblobpath = `/git/${reponame}/blob/${encodeURIComponent(tree)}/`;
          if(blob != "") {
            var blobparts = blob.split("/").filter(x => x != "");
            for(let i = 0; i < blobparts.length; i++) {
              basepath += encodeURIComponent(blobparts[i]) + "/";
              baseblobpath += encodeURIComponent(blobparts[i]) + "/";
            }
          }
          files.sort((a, b) => a.name.localeCompare(b.name));
          for(let i = 0; i < files.length; i++) {
            const file = files[i]
            if(file.mode != 40000 && file.mode != 16384) continue;
            html += `<li><a href="${basepath}${encodeURIComponent(file.name)}">${file.name}</a></li>`;
          }
          let readme = "";
          for(let i = 0; i < files.length; i++) {
            const file = files[i]
            if(file.mode == 40000 || file.mode == 16384) continue;
            if(file.name.toLowerCase() == "readme.md") readme = (await repo.getObject(undefined, file.sha)).data.toString("utf8");
            html += `<li><a href="${baseblobpath}${encodeURIComponent(file.name)}">${file.name}</a>`;
            html += ` | <a href="${baseblobpath}${encodeURIComponent(file.name)}?download=${Math.random().toString(36).substring(7)}">download</a></li>`;
          }
          html += "</ul><p><pre>" + readme + "</pre></p></body></html>"; 
          res.status(200).send(html);
          next();
        } else if(deleterequest == true) {

          // var arr = await repo.collection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
          var arr = await repo.collection.find({ repo: repo.repoName, _type: "hash" }).toArray()
          if (arr != null && arr.length > 0) {
            const main = arr[0];
            if (!DatabaseConnection.hasAuthorization(req.user as any, main as any, Rights.delete)) {
              return res.status(401).send("Access denied to delete (for " + (req.user as any).name + ")")
            }
          } else {
            return res.status(404).send("Access denied or repo not found (for " + (req.user as any).name + ")")
          }

          await repo.DeleteRepo();
          repo.removeExpress(app, "/git/" + reponame);
          delete this.repos[reponame];
          res.status(200).send(`Deleted<p><a href="/git">back</p>`);
          next();
        } else if(snapshotrequest == true) {
          var arr = await repo.collection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
          res.status(200).send(`oh snap!<p><a href="/git">back</p>`);
          next();

        } else {
          console.log("Not Found", url);
          res.status(404).send("Not Found");
          next();
        }
      } catch (error) {
        console.error("error", url, error.message);
        res.status(500).send(`Internal Server Error: ${error.message}`);
        next();
      }
    });
  } // constructor
  static async GetToken(req) {
    let authorization = "";
    let jwt = "";
    if (req.user) {
      const user: User = req.user;
      return await Auth.User2Token(user, Config.shorttoken_expires_in, null);
    }
    if(req.headers != null) {
      var headers = Object.keys(req.headers);
      for(let i = 0; i < headers.length; i++) {
        if(headers[i].toLowerCase() == "authorization") {
          authorization = req.headers[headers[i]];
        }          
      }
    }
    if (authorization != null && authorization != "") {
      const user = await Auth.Token2User(authorization, null);
      if (user != null) {
        jwt = await Auth.User2Token(user, Config.shorttoken_expires_in, null);
      } else {
        return "";
      }
    } else {
      return "";
    }
    return jwt;
  } // GetToken

} // class
