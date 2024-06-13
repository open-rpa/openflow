import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Config } from "../Config.js";
import express from "express";
import { Span } from "@opentelemetry/api";
import { WebServer } from "../WebServer.js";
import { User, Rights } from "@openiap/openflow-api";
import { Auth } from "../Auth.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import mimetype from "mimetype";
import _ from "angular-route";
let concurrency = 100;
export class GitProxy {
  static repos: any = {};
  static async configure(app: express.Express, parent: Span): Promise<void> {
    const { MongoGitRepository, tools, Protocol } = await import("@openiap/cloud-git-mongodb");
    tools.setBatchSize(200);
    concurrency = 200;
    tools.setDebugHandler((...args) => {
      if (Config.log_git) {
        let msg = "";
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (typeof arg == "string") {
            msg += " " + arg;
          } else {
            msg += " " + JSON.stringify(arg);
          }
        }
        Logger.instanse.debug(msg.trim(), null, { cls: "GitProxy" });
      }
    });

    app.all("/git*", async (req, res, next) => {
      if (Config.enable_gitserver == false) return res.status(404).send("Git not enabled");
      const mongocol = "git";
      const urlPath = req.path.substring(4);
      const method = req.method.toUpperCase();
      const remoteip = WebServer.remoteip(req as any);
      Logger.instanse.debug("[" + method + "] " + urlPath + " from " + remoteip, null, { cls: "GitProxy" });
      try {
        var jwt = await GitProxy.GetToken(req);
        if ((jwt == null || jwt == "")) {
          if (Config.enable_gitserver_guest == false && Config.enable_gitserver_guest_create == false) {
            res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
            return res.status(401).send("Authentication required.")
          } else {
            jwt = await Auth.User2Token(await Crypt.guestUser(), Config.shorttoken_expires_in, null);
          }
        }
        // @ts-ignore
        req.jwt = jwt;
        req.user = await Auth.Token2User(jwt, null);

        var url = urlPath;
        if (url.indexOf("?") > 0) { url = url.substring(0, url.indexOf("?")); }
        if (url.startsWith("/")) { url = url.substring(1); }
        if (url.toLowerCase().startsWith("git/")) { url = url.substring(4); }
        if (url.toLowerCase() == "git") { url = ""; }
        let parts = url.split("/");
        let reponame = parts[0];
        let ownername = "";
        if (parts.length > 1) {
          ownername = parts[0];
          reponame = parts[1];
        }
        if (reponame != "") {
          if (reponame == "info" || reponame == "git-upload-pack" || reponame == "git-receive-pack" || reponame == "delete" || reponame == "snapshot"
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
            if (req.user == null) {
              res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
              return res.status(401).send("Authentication required.")
            }
            let right = Rights.read;
            var url = req.originalUrl;
            if (url.indexOf("?") > 0) {
              url = url.substring(0, url.indexOf("?"));
            }
            let parts = url.split("/");
            if (parts[parts.length - 1] == "git-receive-pack") {
              right = Rights.update;
            }
            var arr = await repo.repocollection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
            if (arr != null && arr.length > 0) {
              const main = arr[0];
              if (!DatabaseConnection.hasAuthorization(req.user, main as any, right)) {
                res.set("WWW-Authenticate", `Basic realm="${Config.domain}"`)
                Logger.instanse.error("Access denied to update " + repo.repoName + " (for " + (req.user as any).name + ")", null, { cls: "GitProxy" });
                return res.status(401).send("Access denied to update " + repo.repoName + " (for " + (req.user as any).name + ")")
              }
            } else {
              // new
              if (parts[parts.length - 1] == "git-receive-pack") {
                if ((req.user as any).username == "guest" && Config.enable_gitserver_guest_create == false) {
                  res.set("WWW-AuthehasRolenticate", `Basic realm="${Config.domain}"`)
                  Logger.instanse.error("Access denied to create " + repo.repoName + " for guest", null, { cls: "GitProxy" });
                  return res.status(401).send("Access denied to create " + repo.repoName + " for guest")
                }
                if (ownername == (req.user as any).username) {
                } else if (ownername == "" && reponame == (req.user as any).username && reponame != "guest") {
                } else if (req.user != null && req.user.HasRoleName != null && req.user.HasRoleName("admins")) {
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
        if (repo != null && repo.ignoreRequest(req)) {
          return next();
        } else {
          if (repo != null) {
            // var arr = await repo.repocollection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray()
            var arr = await repo.repocollection.find({ repo: repo.repoName, _type: "hash" }).toArray()
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
        if (parts.indexOf("tree") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("tree");
          type = "tree";
          if (parts.length > idx + 1) {
            tree = decodeURIComponent(parts[idx + 1]);
          } else {
            if (repo == null) { return res.status(404).send("Not Found (no tree specefied)"); }
          }
          if (parts.length > idx + 2) {
            let blobs = [];
            for (let i = idx + 2; i < parts.length; i++) {
              blobs.push(decodeURIComponent(parts[i]));
            }
            blob = blobs.join("/");
          }
        }
        if (parts.indexOf("tag") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("tag");
          type = "tags";
          if (parts.length > idx + 1) {
            tree = decodeURIComponent(parts[idx + 1]);
          } else {
            if (repo == null) { return res.status(404).send("Not Found (no tree specefied)"); }
          }
          if (parts.length > idx + 2) {
            let blobs = [];
            for (let i = idx + 2; i < parts.length; i++) {
              blobs.push(decodeURIComponent(parts[i]));
            }
            blob = blobs.join("/");
          }
        }
        if (parts.indexOf("blob") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("blob");
          if (parts.length > idx + 1) {
            tree = decodeURIComponent(parts[idx + 1]);
          }
          let blobs = [];
          for (let i = idx + 2; i < parts.length; i++) {
            blobs.push(decodeURIComponent(parts[i]));
          }
          blob = blobs.join("/");
          if (blob == "") {
            if (repo == null) { return res.status(404).send("Not Found (no blob specefied)"); }
          }
        }
        let deleterequest = false;
        let snapshotrequest = false;
        if (parts.indexOf("delete") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("delete");
          if (idx == parts.length - 1) deleterequest = true;
        } else if (parts.indexOf("snapshot") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("snapshot");
          if (idx == parts.length - 1) snapshotrequest = true;
        }


        parts = url.replace(reponame, "").split("/").filter(x => x != "");


        if (repo == null) {
          if (req.method == "POST") {
            if (req.body != null && req.body.reponame != null) {
              const exists = await Config.db.GetOne<any>({ collectionname: mongocol, query: { repo: req.body.reponame }, jwt: Crypt.rootToken() }, parent);
              if (exists != null) {
                res.status(409).send("Repo already exists");
                next();
                return;
              }
              let reponame = req.body.reponame;
              parts = reponame.split("/");
              let ownername = "";
              if (parts.length > 1) {
                ownername = parts[0];
                reponame = parts[1];
              }
              if (reponame != "") {
                if (reponame == "info" || reponame == "git-upload-pack" || reponame == "git-receive-pack" || reponame == "delete" || reponame == "snapshot"
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
                _acl: [{ _id: (req.user as any)._id, name: (req.user as any).name, rights: Rights.full_control }],
                name: "HEAD " + reponame,
                ref: "HEAD",
                repo: reponame,
                headref: null,
                sha: null
                // headref: "refs/heads/main",
                // sha: ""
              }

              if ((req.user as any).username == "guest" && Config.enable_gitserver_guest_create == false) {
                res.set("WWW-AuthehasRolenticate", `Basic realm="${Config.domain}"`)
                Logger.instanse.error("Access denied to create " + req.body.reponame + " for guest", null, { cls: "GitProxy" });
                return res.status(500).send("Access denied to create for guest")
              }
              if (ownername == (req.user as any).username) {
              } else if (ownername == "" && reponame == (req.user as any).username && reponame != "guest") {
              } else if (req.user != null && (req.user as any).HasRoleName != null && (req.user as any).HasRoleName("admins")) {
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
          var _repos2 = await Config.db.query<any>({ collectionname: mongocol, query: {"_type": "hash"}, projection: {ref: 1, repo: 1}, jwt }, parent);
          // distinct repos
          const _repos = _repos2.map(x => x.repo).filter((v, i, a) => a.indexOf(v) === i);

          var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="/#/Entities/git">Permissions</a><ul>`;
          for (var i = 0; i < _repos.length; i++) {
            const branches = _repos2.filter(x => x.repo == _repos[i] && x.ref.indexOf("/heads/") > -1 );
            const tags = _repos2.filter(x => x.repo == _repos[i] && x.ref.indexOf("/tags/") > -1 );
            if(tags.length == 0) {
              html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a> with ${branches.length} branches`;
            } else {
              html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a> with ${branches.length} branches and ${tags.length} tags`;

            }
            // html += ` <a href="/git/${_repos[i]}/snapshot">snapshot</a>`;
            html += ` <a href="/git/${_repos[i]}/delete">del</a></li>`;
          }
          var keys = Object.keys(GitProxy.repos);
          for (var i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (GitProxy.repos[key].db != null) continue;
            html += `<li><a href="/git/${key}">${key}</a>`;
          }
          html += "</ul>"
          html += "<form action=/git method=post>";
          if ((req.user as any) != null && (req.user as any).HasRoleName != null && (req.user as any).HasRoleName("admins")) {
            html += "Create new:<br /><input type=text name=reponame placeholder=reponame>";
          } else {
            html += `Create new:<br /><input type=text name=reponame value='${(req.user as any).username.replace("@", "_")}/reponame'>`;
          }
          html += "<input type=submit value=Create>";
          html += "</form>";
          html += "</body></html>";
          res.status(200).send(html);
          next();
        } else if (tree == "" && deleterequest == false && snapshotrequest == false) {
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
          for (let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if (ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            html += `<li><a href="/git/${reponame}/${type}/${encodeURIComponent(ref)}">branch ${ref}</a>`;
            // html += ` <a href="/git/${reponame}/${type}/${encodeURIComponent(ref)}/snapshot">snapshot</a>`;
            html += `</li>`;
          }
          const parts = repo.repoName.split("/");
          html += `</ul>`
          const main = branches.find(x => x.ref == "HEAD");
          let mainref = "";
          if (main != null) {
            const mainb = branches.find(x => x.sha == main.sha && x.ref != "HEAD");
            mainref = mainb?.ref;
            if (mainref != null) {
              mainref = mainref.split("/")[mainref.split("/").length - 1]
              type = "tree";
            }
          }
          if (branches.length > 1 && mainref != "" && mainref != null) {
            return res.redirect(`/git/${reponame}/${type}/${encodeURIComponent(mainref)}`);
          } else if (branches.length < 2) {
            if ((req.user as any).name == "guest") {
              html += `<p>or push an existing repository from the command line:<button onclick="copyToClipboard('guest2')">Copy</button><br /><pre id="guest2">git remote add origin https://${Config.domain}/git/${repo.repoName}\ngit push -u origin main\ngit push origin --all && git push origin --tags</pre></p>`
            } else {
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
          } else {
            html += `<p>WARNING branch mitcmatch HEAD (default) is not found in branches</p>`;
          }

          html += `</body></html>`;
          res.status(200).send(html);
          next();
        } else if (deleterequest == false && snapshotrequest == false) {
          let files: any[] = [];
          var branches = await repo.GetBranches();
          var branch = branches.find(x => x.ref == "refs/" + (type == 'tree' ? 'heads' : type) + "/" + tree);
          if (branch == null) {
            return res.status(404).send("File not found");
          }
          files = await repo.GetTree(branch.sha, false);

          let blobentry = null;
          if (blob != "") {
            var blobparts = blob.split("/").filter(x => x != "");
            for (let i = 0; i < blobparts.length; i++) {
              let file = files.find(x => x.name == blobparts[i]);
              if (file == null) {
                return res.status(404).send("File not found");
              }
              if (i < blobparts.length - 1) {
                if (file.mode != 40000 && file.mode != 16384) {
                  return res.status(404).send("File not found");
                }
                files = await repo.GetTree(file.sha, false);
              } else {
                blobentry = file;
                if (file.mode == 40000 || file.mode == 16384) {
                  files = await repo.GetTree(file.sha, false);
                }
              }
            }
          }
          var html = `<body><a href="/git">repos</a> | <a href="javascript:history.back()">Go Back</a><ul>`;
          let codeblock = "";
          const parts = repo.repoName.split("/");
          if ((req.user as any).name == "guest") {
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
          html += `branch(${branches.length - 1}): <select onchange="window.location.href = this.value">`;
          for (let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if (ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            if (branches[i].ref.indexOf("refs/heads/") == 0) {
              html += `<option value="/git/${reponame}/tree/${encodeURIComponent(ref)}"`;
              if (ref == tree) html += ` selected`;
              html += `>branch ${ref}</option>`;
            }
          }
          for (let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if (ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            if (branches[i].ref.indexOf("refs/tags/") == 0) {
              html += `<option value="/git/${reponame}/tag/${encodeURIComponent(ref)}"`;
              if (ref == tree) html += ` selected`;
              html += `>tag ${ref}</option>`;
            }
          }
          html += `</select> <button onclick="copyToClipboard('clone')">Copy clone command</button>`;
          if(files.find(x => x.name == "objects.json") != null) {
            html += ` <button onclick="window.location.href = '/git/${reponame}/snapshot'">Snapshot</button>`;
          }
          html += `<br />`;


          if (blobentry != null && blobentry.mode != 40000 && blobentry.mode != 16384) {
            const contentType = mimetype.lookup(blobentry.name) || "application/octet-stream";
            if (req.query.download != null) {
              res.set({
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${blobentry.name}"`,
              });
              if (repo.db != null) {
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
            if (contentType.startsWith("image")) {
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
          if (blob != "") {
            var blobparts = blob.split("/").filter(x => x != "");
            for (let i = 0; i < blobparts.length; i++) {
              basepath += encodeURIComponent(blobparts[i]) + "/";
              baseblobpath += encodeURIComponent(blobparts[i]) + "/";
            }
          }
          files.sort((a, b) => a.name.localeCompare(b.name));
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (file.mode != 40000 && file.mode != 16384) continue;
            html += `<li><a href="${basepath}${encodeURIComponent(file.name)}">${file.name}</a></li>`;
          }
          let readme = "";
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (file.mode == 40000 || file.mode == 16384) continue;
            if (file.name.toLowerCase() == "readme.md") readme = (await repo.getObject(undefined, file.sha)).data.toString("utf8");
            html += `<li><a href="${baseblobpath}${encodeURIComponent(file.name)}">${file.name}</a>`;
            html += ` | <a href="${baseblobpath}${encodeURIComponent(file.name)}?download=${Math.random().toString(36).substring(7)}">download</a></li>`;
          }
          html += "</ul>";
          if(readme != null && readme != "") {
            html += "<p><pre>" + readme + "</pre></p>";
          }
          html += "</body></html>";
          res.status(200).send(html);
          next();
        } else if (deleterequest == true) {
          var arr = await repo.repocollection.find({ repo: repo.repoName, _type: "hash" }).toArray()
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
          // res.status(200).send(`Deleted<p><a href="/git">back</p>`);
          res.redirect("/git");
          next();
        } else if (snapshotrequest == true) {

          const result = await snapshot(repo, req, res, next, tools, jwt, parent);
          // res.redirect("/git/" + reponame);
          // next();
          res.status(200).send(`${result}<p><a href="/git/${reponame}">back</p>`);
          return next();
      
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
    if (req.headers != null) {
      var headers = Object.keys(req.headers);
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].toLowerCase() == "authorization") {
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

async function snapshot(repo, req, res, next, tools, jwt, parent) {
  const startTime = Date.now();
  console.time("snapshot");
  console.timeLog("snapshot", "start");
  let objectcounter = 0;
  const formatcontent = (content: any) => JSON.stringify(content, null, 2);
  let updated = false;
  const mainref = await repo.getHeadRef();
  const branches = await repo.getRefs();
  const branch = branches.find(x => x.ref == mainref);
  const branchtree = await repo.GetTree(branch.sha, true);
  const snapshotobjects = branchtree.find(x => x.name == "objects.json");
  const obj = await repo.getObject(undefined, snapshotobjects.sha);
  const objects = JSON.parse(obj.data.toString("utf8"));
  let promises = [];
  const treeMap = new Map();

  // Initialize treeMap and subtree
  for (const obj of objects) {
    let treeobject = branchtree.find(x => x.name == obj.collection);
    if (!treeobject) {
      treeobject = {
        mode: 16384,
        name: obj.collection,
        sha: "",
        subtree: []
      };
      updated = true;
      branchtree.push(treeobject);
    }
    treeobject.subtree = [];
    treeMap.set(obj.collection, treeobject);
  }

  async function handleObject(obj, id, content) {
    const treeobject = treeMap.get(obj.collection);
    const tree = treeobject.subtree;
    const filename = id + ".json";
    if(content == null) content = await Config.db.GetOne<any>({ collectionname: obj.collection, query: { _id: id }, jwt }, parent);
    const object = {
      "objectType": 3, // blob
      "data": Buffer.from(formatcontent(content)),
      "contentType": "text/plain",
      "sha": tools.objectSha({ "objectType": 3, "data": Buffer.from(formatcontent(content)), "contentType": "text/plain" })
    };
    promises.push(repo.storeObject(object));
    const existingFile = tree.find(x => x.name == filename);
    if (!existingFile) {
      tree.push({ mode: 33188, name: filename, sha: object.sha });
      updated = true;
    } else if (existingFile.sha !== object.sha) {
      existingFile.sha = object.sha;
      updated = true;
    }
    objectcounter++;
    if (promises.length >= concurrency) {
      await Promise.all(promises);
      promises = [];
    }
    if(objectcounter % 100 == 0) {
      const ms = (Date.now() - startTime)
      const msbyobjct = Math.round(ms / objectcounter);
      console.timeLog("snapshot", "handled " + objectcounter + " objects ( " + msbyobjct + " ms/object )");
    }
  }

  for (const obj of objects) {
    if (obj.ids) {
      for (const id of obj.ids) {
        await handleObject(obj, id, null);
      }
    } else if (obj.pipeline) {
      const cursor = await Config.db.db.collection(obj.collection).aggregate(obj.pipeline);
      for await (const content of cursor) {
        const id = content._id;
        await handleObject(obj, id, content);
      }
    }
  }

  if (promises.length > 0) {
    await Promise.all(promises);
    objectcounter += promises.length;
  }

  const user: User = req.user as any;
  const username = user.name || user.username || "guest";
  const email = user.email || user.username || "guest";
  if(!updated) {
    const ms = (Date.now() - startTime)
    const msbyobjct = Math.round(ms / objectcounter);
    Logger.instanse.info("Snapshot with " + objectcounter + " objects created by " + username + " discarded after " + (Date.now() - startTime) / 1000 + " seconds, due to no new/changed items", null, { cls: "GitProxy" });

    objectcounter += promises.length;
    console.timeLog("snapshot", "completed with " + objectcounter + " objects " + msbyobjct + " ms/object discarded due to no new/changed items");
    console.timeEnd("snapshot");

    return `Nothing new to snapshot, scanned ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds ( ${msbyobjct}ms/object )`;
  }

  for(let k = 0; k < branchtree.length; k++) {
    if(branchtree[k].mode == 40000 || branchtree[k].mode == 16384) {
      const subtreeobj = tools.createTree(branchtree[k].subtree);
      await repo.storeObject(subtreeobj);    
      branchtree[k].sha = subtreeobj.sha;
    }
  }
  const treeobj = tools.createTree(branchtree);
  await repo.storeObject(treeobj);

  // Create and store the new commit object
  const author = `${username} <${email}> ${Math.floor(Date.now() / 1000)} +0000`;
  const committer = `${username} <${email}> ${Math.floor(Date.now() / 1000)} +0000`;
  const message = "Manual snapshot";

  const commit = tools.createCommit({ tree: treeobj.sha, parent: branch.sha, author, committer, message });
  await repo.storeObject(commit);

  // Update the branch reference
  await repo.upsertRef(mainref, commit.sha);

  const ms = (Date.now() - startTime)
  const msbyobjct = Math.round(ms / objectcounter);
  Logger.instanse.info("Snapshot with " + objectcounter + " objects created by " + username + " completed in " + (Date.now() - startTime) / 1000 + " seconds", null, { cls: "GitProxy" });

  objectcounter += promises.length;
  console.timeLog("snapshot", "completed with " + objectcounter + " objects " + msbyobjct + " ms/object");
  console.timeEnd("snapshot");
  return `Snapshot completed with ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds ( ${msbyobjct}ms/object )`;
}
