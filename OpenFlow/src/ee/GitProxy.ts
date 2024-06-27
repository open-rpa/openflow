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
const { MongoGitRepository, tools, Protocol } = await import("@openiap/cloud-git-mongodb");
let batchSize = 100;
import { GridFSBucket, ObjectId } from "mongodb";
const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
const isoDatePattern = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);
export class GitProxy {
  static repos: any = {};
  static stream: any = null;
  static hadWatchFault: boolean = false;
  static lastWatchFault: Date = new Date();
  static watchFaultHandler: any = null;
  static zlib: boolean = true;
  static mongocol: string = "git";
  static app: express.Express = null;

  static async GetRepo(reponame: string) {
    let parts = reponame.split("/");
    let ownername = "";
    if (parts.length > 1) {
      ownername = parts[0];
    }

    let repo = GitProxy.repos[reponame];
    if (repo == null && reponame != null && reponame != "") {
      repo = new MongoGitRepository(Config.db.db, GitProxy.mongocol, reponame);
      repo.zlib = GitProxy.zlib;
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
        var arr = await repo.repocollection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray() // for now, lets just check HEAD
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
          var exists = repo._acl.find(x => x._id == (req.user as any)._id);
          if (exists == null) {
            repo._acl.push({ _id: (req.user as any)._id, name: (req.user as any).name, rights: Rights.full_control });
          }
        } // new
        next();
      }

      repo.createExpress(GitProxy.app, "/git/" + reponame);
    }
    return repo;
  }
  static async configure(app: express.Express, parent: Span): Promise<void> {
    this.app = app;
    tools.setBatchSize(200);
    batchSize = 200;
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
            || reponame == "restore" || reponame == "tree" || reponame == "tag" || reponame == "blob" || reponame == "commit") {
            reponame = ownername
            ownername = "";
          } else if (ownername != "") {
            reponame = ownername + "/" + reponame;
          }
        } else {
          reponame = ownername;
          ownername = "";
        }
        const repo = await GitProxy.GetRepo(reponame);

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
        if (parts.indexOf("tag") > 0 || parts.indexOf("tags") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("tag");
          if (idx == -1) idx = parts.indexOf("tags");
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
        if (parts.indexOf("commit") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("commit");
          type = "commit";
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
        let restorerequest = false;
        if (parts.indexOf("delete") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("delete");
          if (idx == parts.length - 1) deleterequest = true;
        } else if (parts.indexOf("snapshot") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("snapshot");
          if (idx == parts.length - 1) snapshotrequest = true;
          if (idx == parts.length - 2) {
            snapshotrequest = true;
            if (parts.length > idx + 1) {
              tree = decodeURIComponent(parts[idx + 1]);
            }
          }
        } else if (parts.indexOf("restore") > 0) {
          if (repo == null) { return res.status(404).send("Not Found (no repo)"); }
          let idx = parts.indexOf("restore");
          if (idx == parts.length - 2) {
            restorerequest = true;
            if (parts.length > idx + 1) {
              tree = decodeURIComponent(parts[idx + 1]);
            }

          }
        }


        parts = url.replace(reponame, "").split("/").filter(x => x != "");


        if (repo == null) {
          if (req.method == "POST") {
            if (req.body != null && req.body.reponame != null) {
              const exists = await Config.db.GetOne<any>({ collectionname: GitProxy.mongocol, query: { repo: req.body.reponame }, jwt: Crypt.rootToken() }, parent);
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
                  || reponame == "restore" || reponame == "tree" || reponame == "tag" || reponame == "commit" || reponame == "blob") {
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
              const newrepo = new MongoGitRepository(Config.db.db, GitProxy.mongocol, reponame);
              newrepo.zlib = GitProxy.zlib;
              newrepo._acl = newbranch._acl;
              GitProxy.repos[reponame] = newrepo;
              newrepo.createExpress(app, "/git/" + reponame);
              // redirect to new repo
              res.redirect("/git/" + reponame);
              next();
              return;
            }
            res.status(404).send("Not Found");
            next();
            return;
          }
          // var _repos2 = await Config.db.query<any>({ collectionname: GitProxy.mongocol, query: { "_type": "hash" }, projection: { ref: 1, repo: 1 }, top: 1000, jwt }, parent);
          // distinct repos
          // const _repos = _repos2.map(x => x.repo).filter((v, i, a) => a.indexOf(v) === i);

          const _repos = await Config.db.distinct({ collectionname: GitProxy.mongocol, field: "repo", query: { "_type": "hash" }, jwt }, parent);

          var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="/#/Entities/git">Permissions</a><ul>`;
          for (var i = 0; i < _repos.length; i++) {
            // const branches = _repos2.filter(x => x.repo == _repos[i] && x.ref.indexOf("/heads/") > -1);
            // const tags = _repos2.filter(x => x.repo == _repos[i] && x.ref.indexOf("/tags/") > -1);
            // if (tags.length == 0) {
            //   html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a> with ${branches.length} branches`;
            // } else {
            //   html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a> with ${branches.length} branches and ${tags.length} tags`;
            // }
            html += `<li><a href="/git/${_repos[i]}">${_repos[i]}</a>`;
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
        } else if (tree == "" && deleterequest == false && snapshotrequest == false && restorerequest == false) {
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
            const mainb = branches.find(x => x.sha == main.sha && x.ref != "HEAD" );
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
        } else if (deleterequest == false && snapshotrequest == false && restorerequest == false) {
          let files: any[] = [];
          let currentsha = "";
          var branches = await repo.GetBranches();
          var branch = branches.find(x => x.ref == "refs/" + (type == 'tree' ? 'heads' : type) + "/" + tree);
          if (type == "commit") {
            currentsha = tree;
            files = await repo.GetTree(tree, false);
          } else if (branch == null) {
            return res.status(404).send("File not found");
          } else {
            currentsha = branch.sha;
            files = await repo.GetTree(branch.sha, false);
          }

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
          const back = blob.split("/").slice(0, blob.split("/").length - 1).join("/");
          var html = `<body><a href="/git">repos</a> | <a href="/git/${reponame}/${type}/${encodeURIComponent(tree)}/${back}">back</a><ul>`;
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
          const branchcount = branches.filter(x => x.ref.indexOf("refs/heads/") == 0).length;
          const tagcount = branches.filter(x => x.ref.indexOf("refs/tags/") == 0).length;
          if (tagcount > 0) {
            if (branchcount > 1) {
              html += `${branchcount} branches / ${tagcount} tags: `;
            } else {
              html += `${branchcount} branch / ${tagcount} tags: `;
            }
          } else if (branchcount > 1) {
            html += `branch(${branchcount}): `;
          }

          html += `<select onchange="window.location.href = this.value">`;
          if (type != "tree") {
            html += `<option>branch</option>`;
          }
          for (let i = 0; i < branches.length; i++) {
            let ref = branches[i].ref;
            if (ref == "HEAD") continue;
            ref = ref.split("/")[ref.split("/").length - 1]
            if (branches[i].ref.indexOf("refs/heads/") == 0) {
              html += `<option value="/git/${reponame}/tree/${encodeURIComponent(ref)}"`;
              if (ref == tree) {
                // html += ` selected`;
                html += `>* branch ${ref}</option>`;
              } else {
                html += `>branch ${ref}</option>`;
              }
              // html += `>branch ${ref}</option>`;
            }
          }
          html += `</select>`;
          if (tagcount > 0) {
            html += `<select onchange="window.location.href = this.value">`;
            if (type == "tree") {
              html += `<option>tag</option>`;
            }
            for (let i = 0; i < branches.length; i++) {
              let ref = branches[i].ref;
              if (ref == "HEAD") continue;
              ref = ref.split("/")[ref.split("/").length - 1]
              if (branches[i].ref.indexOf("refs/tags/") == 0) {
                html += `<option value="/git/${reponame}/tag/${encodeURIComponent(ref)}/${blob}"`;
                if (ref == tree) {
                  html += ` selected>* tag ${ref}</option>`;
                } else {
                  html += `>tag ${ref}</option>`;
                }
                // if (ref == tree) {
                //   html += ` selected`;
                // }
                // html += `>tag ${ref}</option>`;
              }
            }
            html += `</select>`;
          }
          var commits = await Config.db.query<any>({ collectionname: repo.bucketName, query: { "_type": "commit" }, projection: { sha: 1, message: 1 }, jwt }, parent);
          if (commits.length > 1) {
            html += ` ${commits.length - 1} commits <select onchange="window.location.href = this.value">`;
            for (let i = 0; i < commits.length; i++) {
              html += `<option value="/git/${reponame}/commit/${encodeURIComponent(commits[i].sha)}/${blob}"`;
              let message = commits[i].message;
              if (message.startsWith("gpgsig ") && message.indexOf("-----END PGP SIGNATURE-----\n") > 0) {
                message = message.split("-----END PGP SIGNATURE-----\n")[1].trim();
              }
              if (message.startsWith("gpgsig ") && message.indexOf("-----END PGP SIGNATURE-----") > 0) {
                message = message.split("-----END PGP SIGNATURE-----")[1].trim();
              }
              if (commits[i].sha == tree) {
                html += ` selected> * ${message.substring(0, 50)}</option>`;
              } else if (branch != null && commits[i].sha == branch.sha) {
                html += ` selected> * ${message.substring(0, 50)}</option>`;
              } else {
                html += `>${message.substring(0, 50)}</option>`;
              }
              // html += `>${message.substring(0, 50)}</option>`;
            }
            html += `</select>`;
          }
          html += ` <button onclick="copyToClipboard('clone')">Copy clone command</button>`;
          if (files.find(x => x.name == "objects.json") != null) {
            html += ` <button onclick="window.location.href = '/git/${reponame}/snapshot/${currentsha}'">Snapshot</button>`;
            html += ` <button onclick="window.location.href = '/git/${reponame}/restore/${currentsha}'">Restore</button>`;
          }
          html += `<br />`;
          var blobparts = blob.split("/").filter(x => x != "");
          html += `<a href="/git/${reponame}/${type}/${encodeURIComponent(tree)}">root</a>`;

          for (let i = 0; i < blobparts.length; i++) {
            if (i == blobparts.length - 1) {
              html += ` / ${blobparts[i]}`;
            } else {
              html += ` / <a href="/git/${reponame}/${type}/${encodeURIComponent(tree)}/${blobparts.slice(0, i + 1).join("/")}">${blobparts[i]}</a>`;
            }
          }
          if (blobparts.length > 0) html += `<br />`;

          if (blobentry != null && blobentry.mode != 40000 && blobentry.mode != 16384) {
            const contentType = mimetype.lookup(blobentry.name) || "application/octet-stream";
            if (req.query.download != null) {
              res.set({
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${blobentry.name}"`,
              });
              if (repo.db != null) {
                // const entries = await repo.collection.find({ "sha": blobentry.sha }).toArray()
                // const dbentry = entries[0]
                // const file = await repo.db.collection(repo.bucketName + ".files").findOne({ "filename": `blob_${blobentry.sha}` });
                // const downloadStream = repo.bucket.openDownloadStream(file._id);
                // downloadStream.pipe(res);
                res.send((await repo.getObject(undefined, blobentry.sha)).data);
              } else {
                res.status(200).send((await repo.getObject(undefined, blobentry.sha)).data);
              }
              return;
            }
            var treeobj = await repo.getObject(null, blobentry.sha);
            const back = blob.split("/").slice(0, blob.split("/").length - 1).join("/");
            var html = `<html translate="no" lang="en"><head><meta http-equiv="Content-Language" content="en" /><head><body><a href="/git">repos</a> | <a href="/git/${reponame}/tree/${encodeURIComponent(tree)}/${back}">back</a><ul>`;
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
            html += `<li><a href="${basepath}${encodeURIComponent(file.name)}">${file.name}</a>`;
            html += ` | <a href="${basepath}${encodeURIComponent(file.name)}?download=${Math.random().toString(36).substring(7)}">download</a>`;
            // html += `${file.sha}`;
            html += `</li>`;
          }
          html += "</ul>";
          if (readme != null && readme != "") {
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
          res.status(200).send(`Deleted<p><a href="/git">back</p>`);
          // res.redirect("/git");
          next();
        } else if (snapshotrequest == true) {

          const result = await GitProxy.snapshot(repo, req.user as any, tree, jwt, parent);
          // res.redirect("/git/" + reponame);
          // next();
          res.status(200).send(`${result.message.split(`\n`).join(`<br />`)}<p><a href="/git/${reponame}">back</p>`);
          return next();
        } else if (restorerequest == true) {
          const result = await GitProxy.restoresnapshot(repo, req.user as any, tree, jwt);
          res.status(200).send(`${result.message.split(`\n`).join(`<br />`)}<p><a href="/git/${reponame}">back</p>`);
          return next();
        } else {
          Logger.instanse.info(`Not Found ${url}`, null, { cls: "GitProxy" });
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


  static async restoresnapshot(repo: any, user: User, tree: string, jwt: string) {
    const startTime = Date.now();
    let objectcounter = 0;
    console.time("restoresnapshot");
    console.timeLog("restoresnapshot", "start");
    let insertedobjectcounter = 0;
    let updatedobjectcounter = 0;
    let failedobjectcounter = 0;
    let promises = [];
    try {
      let rootfiles: any[] = [];
      if (tree == null || tree == "") throw new Error("No tree specified");
      rootfiles = await repo.GetTree(tree, false);
      if (rootfiles == null || rootfiles.length == 0) throw new Error("No files found for " + tree);
      let filesha = rootfiles.find(x => x.name == "objects.json").sha;
      if (filesha == null) throw new Error("Definition file objects.json found");
      let filecontent = await repo.getObject(undefined, filesha);
      if (filecontent == null) throw new Error("Definition file objects.json found");
      let objects = JSON.parse(filecontent.data.toString("utf8"));
      let result = "";
      let collections = [];
      async function handleObject(collection, collectionname, files, file) {
        const filecontent = await repo.getObject(undefined, file.sha);
        if (collectionname.endsWith(".files")) {
          if (!file.name.endsWith(".json")) return;
          const json = filecontent.data.toString("utf8");
          const metadata = JSON.parse(json);
          const bucketName = collectionname.substring(0, collectionname.length - 6);
          const fileexists = await Config.db.GetOne<any>({ collectionname: collectionname, query: { _id: metadata._id }, jwt: Crypt.rootToken() }, null);
          if (fileexists != null) {
            // result += `File ${metadata.filename} #${metadata._id} in ${collectionname} already exists\n`;
            const meta1 = JSON.stringify(metadata.metadata);
            const meta2 = JSON.stringify(fileexists.metadata);
            if (meta1 != meta2) {
              const item = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                  return new Date(value); // isostring, so cast to js date
                } else
                  return value; // leave any other value as-is
              });

              // try {
              //   await Config.db._UpdateOne(null, item, collectionname, 1, true, jwt, null);
              //   updatedobjectcounter++;
              // } catch (error) {
              //   failedobjectcounter++;
              //   result += `Object ${metadata._id} in ${collectionname} failed ${error.message}\n`;
              // }
              let query = { _id: safeObjectID(metadata._id) };
              let _query = { $and: [query, Config.db.getbasequery(user, [Rights.update], collectionname)] };

              const opresult = await collection.updateOne(_query, { $set: { "metadata": item.metadata } }, { upsert: false });
              // const opresult = await collection.updateOne(_query, { $set: item }, { upsert: false });
              // const opresult = await collection.updateOne(_query, { $set: content }, { upsert: true });
              if (opresult.matchedCount == 0 && opresult.upsertedCount == 0) {
                failedobjectcounter++;
                result += `Object ${metadata._id} in ${collectionname} failed ${JSON.stringify(opresult)}\n`;
              }
              if (opresult.modifiedCount > 0) {
                updatedobjectcounter++;
              } else if (opresult.upsertedCount > 0) {
                insertedobjectcounter++;
              }
            }
            return;
          }
          insertedobjectcounter++;
          const bucket = new GridFSBucket(Config.db.db, { bucketName });

          const fileext = metadata.filename.split(".").pop();
          const filename = metadata._id + ".obj." + fileext;
          const treeobject = files.find(x => x.name == filename);
          const content = await repo.getObject(undefined, treeobject.sha);

          const uploadStream = bucket.openUploadStreamWithId(safeObjectID(metadata._id), metadata.filename, metadata);
          uploadStream.write(content.data);
          uploadStream.end();
          await new Promise((resolve, reject) => {
            uploadStream.on('finish', resolve);
            uploadStream.on('error', reject);
          });
          // *ARGH* Stupid mongoDB not support setting uploadDate
          // so SHA will change for metadata doing next restore, but the actual file will be the same
        } else {
          // const content = JSON.parse(filecontent.data.toString("utf8"));
          const json = filecontent.data.toString("utf8");
          const content = JSON.parse(json, (key, value) => {
            if (typeof value === "string" && value.match(isoDatePattern)) {
              return new Date(value); // isostring, so cast to js date
            } else
              return value; // leave any other value as-is
          });

          let query = { _id: content._id };
          let _query = { $and: [query, Config.db.getbasequery(user, [Rights.update], collectionname)] };
          const opresult = await collection.updateOne(_query, { $set: content }, { upsert: true });
          if (opresult.matchedCount == 0 && opresult.upsertedCount == 0) {
            failedobjectcounter++;
            result += `Object ${content._id} in ${collectionname} failed ${JSON.stringify(opresult)}\n`;
          }
          if (opresult.modifiedCount > 0) {
            updatedobjectcounter++;
          } else if (opresult.upsertedCount > 0) {
            insertedobjectcounter++;
          }
        }
      }
      for (let i = 0; i < objects.length; i++) {
        const collectionname = objects[i].collection;
        const treeobject = rootfiles.find(x => x.name == collectionname)
        if (treeobject == null) {
          result += "Collection " + collectionname + " not found in commit\n";
          continue;
        }
        if (collections.indexOf(collectionname) == -1) collections.push(collectionname);
        if (collectionname == "agents" || collectionname == "workitems" || collectionname == "openrpa") {
          if (collections.indexOf("fs.files") == -1) collections.push("fs.files");
        }
      }
      for (let i = 0; i < collections.length; i++) {
        const collectionname = collections[i];
        const treeobject = rootfiles.find(x => x.name == collectionname)
        const treesha = treeobject.sha;
        const files = await repo.GetTree(treesha, false);
        const collection = Config.db.db.collection(collectionname);
        for (let j = 0; j < files.length; j++) {
          const file = files[j];
          if (file.mode != 33188) continue;
          promises.push(handleObject(collection, collectionname, files, file));
          objectcounter++;
          if (promises.length >= batchSize) {
            await Promise.all(promises);
            promises = [];
          }
          if (objectcounter % 100 == 0 && objectcounter > 0) {
            const ms = (Date.now() - startTime)
            const msbyobjct = Math.round(ms / objectcounter);
            console.timeLog("restoresnapshot", "handled " + objectcounter + " objects ( " + msbyobjct + " ms/object )");
          }
        }
      }
      if (promises.length > 0) {
        await Promise.all(promises);
        promises = [];
      }
      const ms = (Date.now() - startTime)
      const msbyobjct = Math.round(ms / objectcounter);
      if (msbyobjct == Infinity) {
        result += `Restore scanned ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds  (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated / ${failedobjectcounter} failed)`;
        return {
          objectcounter,
          insertedobjectcounter,
          updatedobjectcounter,
          failedobjectcounter,
          seconds: (Date.now() - startTime) / 1000,
          msbyobjct: 0,
          message: result
        }
      }
      result += `Restore scanned scanned ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated / ${failedobjectcounter} failed / ${msbyobjct}ms pr object)`;
      return {
        objectcounter,
        insertedobjectcounter,
        updatedobjectcounter,
        failedobjectcounter,
        seconds: (Date.now() - startTime) / 1000,
        msbyobjct,
        message: result
      }
    } catch (error) {
      console.error("error", error.message);
      return {
        sha: null,
        objectcounter: 0,
        insertedobjectcounter: 0,
        updatedobjectcounter: 0,
        failedobjectcounter: 0,
        seconds: 0,
        msbyobjct: 0,
        error: error.message,
        message: `Snapshot restore failed with ${error.message}`
      }
    } finally {
      console.timeEnd("restoresnapshot");
    }
  }
  static async snapshot(repo: any, user: User, tree: string, jwt: string, parent: Span) {
    const formatcontent = (content: any) => JSON.stringify(content, null, 2);
    try {
      // try {
      //   const currentfile = JSON.parse(await getfile(repo, "objects.json"));
      //   if(currentfile[0].ids.length == 3) {
      //     const newobj = [{"ids": ["5d6d109a7cfa681d84adb10b", "5d6d10a97cfa681d84adb10d"], collection: "fs.files"}];
      //     await editorupdatefile(repo, "objects.json", formatcontent(newobj));
      //   } else {
      //     const newobj = [{"ids": ["666b0a5ee7ccba0e85b89e7c", "6658ba1b1e6df8676d963ee7", "666b07b9e7ccba0e85b89e55"], collection: "fs.files"}];
      //     await editorupdatefile(repo, "objects.json", formatcontent(newobj));
      //   }
      // } catch (error) {
      //   console.error("error", error.message);      
      // }


      const startTime = Date.now();
      console.time("snapshot");
      console.timeLog("snapshot", "start");
      let objectcounter = 0;
      let insertedobjectcounter = 0;
      let updatedobjectcounter = 0;
      let deletedobjectcounter = 0;
      let updated = false;

      if (tree == null || tree == "") {
        // return "No tree specified";
        tree = await repo.getHeadRef();
      }
      // const mainref = await repo.getHeadRef();
      const branches = await repo.getRefs();
      const branch = branches.find(x => (x.sha == tree || x.ref == tree) && x.ref != "HEAD");
      if (branch == null) throw new Error(`Branch not found from ${tree}`);
      const branchtree: any[] = await repo.GetTree(branch.sha, true);
      const snapshotobjects = branchtree.find(x => x.name == "objects.json");
      const obj = await repo.getObject(undefined, snapshotobjects.sha);
      const objects = JSON.parse(obj.data.toString("utf8"));
      let promises = [];
      const treeMap = new Map();




      function getTreeObject(collection: string) {
        let treeobject = treeMap.get(collection);
        if (treeobject != null) return treeobject;
        treeobject = branchtree.find(x => x.name == collection);
        if (!treeobject) {
          treeobject = {
            mode: 16384,
            name: collection,
            sha: "",
            subtree: [],
            origin: [],
          }
          updated = true;
          branchtree.push(treeobject);
        } else {
          if (treeobject.origin == null) {
            treeobject.origin = [...treeobject.subtree];
          }
        }
        treeMap.set(collection, treeobject);
        return treeobject;
      }

      // Initialize treeMap and subtree
      for (const obj of objects) {
        const treeobject = getTreeObject(obj.collection);
        treeobject.subtree = [];
      }
      // reset all folders ?
      for (let i = 0; i < branchtree.length; i++) {
        const btree = branchtree[i];
        if (btree.mode == 16384) {
          const treeobject = getTreeObject(obj.collection);
          treeobject.subtree = [];
        }
      }


      async function handleObject(collection, id, content, ismetadata = false) {
        const treeobject = getTreeObject(collection);
        let filename = id + ".json";
        const object = {
          objectType: 3, // blob
          contentType: "text/plain",
          sha: ""
        };
        objectcounter++;

        if (collection.endsWith(".files") && ismetadata == false) {
          let metadata = content;
          if (content == null) {
            metadata = await Config.db.GetOne<any>({ collectionname: collection, query: { _id: id }, jwt }, parent);
          }
          if (metadata == null) {
            throw new Error("File not found in " + collection + " " + id);
          }

          const existingFile = treeobject.origin.find(x => x.name == filename);
          if (existingFile != null) {
            const metasha = tools.objectSha({ objectType: 3, data: Buffer.from(formatcontent(metadata)) });
            if (existingFile.sha == metasha) {
              const entries = treeobject.origin.filter(x => x.name.startsWith(id + "."));
              if (entries.length != 2) throw new Error("Invalid entries in " + collection + " " + id + " expected 2 found " + entries.length);
              if (treeobject.subtree.find(x => x.name == entries[0].name) == null) treeobject.subtree.push(entries[0]);
              if (treeobject.subtree.find(x => x.name == entries[1].name) == null) treeobject.subtree.push(entries[1]);
              Logger.instanse.debug(`File ${metadata.filename} #${id} in ${collection} already exists`, null, { cls: "GitProxy" });
              return;
            } else {
              Logger.instanse.debug(`File ${metadata.filename} #${id} in ${collection} already exists changed, old sha ${existingFile.sha}, new sha ${metasha}`, null, { cls: "GitProxy" });
            }
          }
          const bucketName = collection.substring(0, collection.length - 6);
          const bucket = new GridFSBucket(Config.db.db, { bucketName });
          let downloadStream = bucket.openDownloadStream(safeObjectID(id));
          content = Buffer.alloc(0);
          downloadStream.on('data', function (chunk) {
            content = Buffer.concat([content, chunk]);
          });
          await new Promise((resolve, reject) => {
            downloadStream.on('error', function (error) {
              reject(new Error(`Error downloading file ${metadata.filename} #${id} from ${collection}: ${error.message}`));
            });
            downloadStream.on('end', function () {
              resolve({});
            });
          });
          const fileext = metadata.filename.split(".").pop();
          filename = id + ".obj." + fileext;
          object.contentType = metadata.contentType;
          object["data"] = content;
          await handleObject(collection, id, metadata, true);
        } else if (collection == "agents") {
          if (content == null) content = await Config.db.GetOne<any>({ collectionname: collection, query: { _id: id }, jwt }, parent);
          if (content == null) throw new Error(`${id} in ${collection} not found`);
          object["data"] = Buffer.from(formatcontent(content));
          if (content._type == "package" && content.fileid != null && content.fileid != "") {
            console.log("Adding package file", content.fileid, "for package", content.name);
            await handleObject("fs.files", content.fileid, null);
          }
        } else if (collection == "workitems") {
          if (content == null) content = await Config.db.GetOne<any>({ collectionname: collection, query: { _id: id }, jwt }, parent);
          if (content == null) throw new Error(`${id} in ${collection} not found`);
          object["data"] = Buffer.from(formatcontent(content));
          if (content.files != null && Array.isArray(content.files)) {
            for (let i = 0; i < content.files.length; i++) {
              console.log("Adding package file", content.files[i]._id, content.files[i].filename, "for workitem", content.name);
              await handleObject("fs.files", content.files[i]._id, null);
            }
          }
        } else if (collection == "openrpa") {
          if (content == null) content = await Config.db.GetOne<any>({ collectionname: collection, query: { _id: id }, jwt }, parent);
          if (content == null) throw new Error(`${id} in ${collection} not found`);
          object["data"] = Buffer.from(formatcontent(content));
          if (content._type == "workflow" && content.Xaml != null && content.Xaml != "") {
            // using regular expression find all instances if ID like this Image="ID"
            const matches = content.Xaml.match(/Image="([a-f0-9]{24})"/g);
            if (matches != null) {
              for (let i = 0; i < matches.length; i++) {
                const fileid = matches[i].substring(7, 31);
                console.log("Adding image file", fileid, "for workflow", content.name);
                await handleObject("fs.files", fileid, null);
              }
            }
          }
        } else if (content == null) {
          if (content == null) content = await Config.db.GetOne<any>({ collectionname: collection, query: { _id: id }, jwt }, parent);
          if (content == null) throw new Error(`${id} in ${collection} not found`);
          object["data"] = Buffer.from(formatcontent(content));
        } else {
          object["data"] = Buffer.from(formatcontent(content));
        }
        if (content == null) {
          if (content == null) throw new Error(`${id} in ${collection} not found`);
        }
        object["sha"] = tools.objectSha(object)


        promises.push(repo.storeObject(object));
        const existingFile = treeobject.origin.find(x => x.name == filename);
        if (treeobject.subtree.find(x => x.name == filename) == null) {
          treeobject.subtree.push({ mode: 33188, name: filename, sha: object.sha });
          if (!existingFile) {
            updated = true;
            insertedobjectcounter++;
          } else if (existingFile.sha !== object.sha) {
            updated = true;
            updatedobjectcounter++;
          }
        }
        // objectcounter++;
        if (promises.length >= batchSize) {
          // if (promises.length >= 1) {
          await Promise.all(promises);
          promises = [];
        }
        if (objectcounter % 100 == 0 && objectcounter > 0) {
          const ms = (Date.now() - startTime)
          const msbyobjct = Math.round(ms / objectcounter);
          console.timeLog("snapshot", "handled " + objectcounter + " objects ( " + msbyobjct + " ms/object )");
        }
      }

      for (const obj of objects) {
        if (obj.collection == null || obj.collection == "") {
          throw new Error("Collection not specified in " + JSON.stringify(obj));
        }
        if (obj.ids) {
          for (const id of obj.ids) {
            await handleObject(obj.collection, id, null);
          }
        } else if (obj.pipeline) {
          const base = Config.db.getbasequery(user, [Rights.read], obj.collection);
          obj.pipeline.unshift({ $match: base });
          if (obj.collection.endsWith(".files")) {
            obj.pipeline.push({ $sort: { uploadDate: 1 } });
          }
          const cursor = await Config.db.db.collection(obj.collection).aggregate(obj.pipeline);
          for await (const content of cursor) {
            const id = content._id;
            await handleObject(obj.collection, id, content);
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        promises = [];
      }

      const username = user.name || user.username || "guest";
      const email = user.email || user.username || "guest";
      // update deletedobjectcounter
      for (let k = 0; k < branchtree.length; k++) {
        if (branchtree[k].mode == 40000 || branchtree[k].mode == 16384) {
          const subtreeobj = tools.createTree(branchtree[k].subtree);
          if (subtreeobj.sha != branchtree[k].sha) {
            updated = true;
          }
        }
      }

      if (!updated) {
        const ms = (Date.now() - startTime)
        const msbyobjct = Math.round(ms / objectcounter);
        Logger.instanse.info("Snapshot with " + objectcounter + " objects created by " + username + " discarded after " + (Date.now() - startTime) / 1000 + " seconds, due to no new/changed items", null, { cls: "GitProxy" });

        if (msbyobjct == Infinity) {
          console.timeLog("snapshot", "completed with " + objectcounter + " objects discarded due to no new/changed items");
        } else {
          console.timeLog("snapshot", "completed with " + objectcounter + " objects " + msbyobjct + " ms/object discarded due to no new/changed items");
        }
        if (msbyobjct == Infinity) {
          return {
            sha: null,
            objectcounter,
            insertedobjectcounter,
            seconds: (Date.now() - startTime) / 1000,
            msbyobjct: 0,
            message: `Nothing new to snapshot, scanned ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds  (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated)`
          }
        }
        return {
          sha: null,
          objectcounter,
          insertedobjectcounter,
          seconds: (Date.now() - startTime) / 1000,
          msbyobjct,
          message: `Nothing new to snapshot, scanned ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated / ${msbyobjct}ms pr object)`
        }
      }

      for (let k = 0; k < branchtree.length; k++) {
        if (branchtree[k].mode == 40000 || branchtree[k].mode == 16384) {
          const subtree = branchtree[k].subtree;
          const subtreeobj = tools.createTree(subtree);
          if (subtreeobj.sha != branchtree[k].sha) {
            await repo.storeObject(subtreeobj);
            branchtree[k].sha = subtreeobj.sha;
          } else {
            console.log("No change in subtree " + branchtree[k].name);
          }
        }
      }
      // create tree, but exclude empty folders 
      const treeobj = tools.createTree(branchtree.filter(x => x.subtree == null || x.subtree.length > 0));
      await repo.storeObject(treeobj);

      // Create and store the new commit object
      const author = `${username} <${email}> ${Math.floor(Date.now() / 1000)} +0000`;
      const committer = `${username} <${email}> ${Math.floor(Date.now() / 1000)} +0000`;
      // Manual snapshot day-month-year hour:minute
      const now = new Date();
      const datestr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`
      const message = `Manual snapshot ${datestr}`;

      const commit = tools.createCommit({ tree: treeobj.sha, parents: branch.sha, author, committer, message });
      await repo.storeObject(commit, { snapshot: true });


      // Update the branch reference
      await repo.upsertRef(branch.ref, commit.sha);

      const mainref = await repo.getHeadRef();
      if(mainref == branch.ref) {
        await repo.upsertRef("HEAD", commit.sha);
      }



      const ms = (Date.now() - startTime)
      const msbyobjct = Math.round(ms / objectcounter);
      Logger.instanse.info("Snapshot with " + objectcounter + " objects created by " + username + " completed in " + (Date.now() - startTime) / 1000 + " seconds", null, { cls: "GitProxy" });

      // objectcounter += promises.length;
      if (msbyobjct == Infinity) {
        console.timeLog("snapshot", "completed with " + objectcounter + " objects");
      } else {
        console.timeLog("snapshot", "completed with " + objectcounter + " objects " + msbyobjct + " ms/object");
      }
      if (repo.postProcess != null) {
        repo.postProcess();
      }
      if (msbyobjct == Infinity) {
        return {
          sha: commit.sha,
          objectcounter,
          insertedobjectcounter,
          seconds: (Date.now() - startTime) / 1000,
          msbyobjct: 0,
          message: `Snapshot completed with ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated)`
        }
      }
      return {
        sha: commit.sha,
        objectcounter,
        insertedobjectcounter,
        seconds: (Date.now() - startTime) / 1000,
        msbyobjct,
        message: `Snapshot completed with ${objectcounter} objects in ${(Date.now() - startTime) / 1000} seconds (${objectcounter} scanned / ${insertedobjectcounter} inserted / ${updatedobjectcounter} updated / ${msbyobjct}ms pr object)`
      }
    } catch (error) {
      return {
        sha: null,
        objectcounter: 0,
        insertedobjectcounter: 0,
        seconds: 0,
        msbyobjct: 0,
        error: error.message,
        message: `Snapshot failed with ${error.message}`
      }
    } finally {
      console.timeEnd("snapshot");
    }
  }
  static async getfile(repo, filename) {
    const head = await repo.getHeadRef();
    const branch = await repo.getRefs();
    const main = branch.find(x => x.ref == head);
    const tree = await repo.GetTree(main.sha, true);
    const file = tree.find(x => x.name == filename);
    if (file == null) {
      return "File not found";
    }
    const object = await repo.getObject(undefined, file.sha);
    return object.data.toString("utf8");
  }
  static async editorupdatefile(repo, filename, content) {
    const head = await repo.getHeadRef();
    const branch = await repo.getRefs();
    const main = branch.find(x => x.ref == head);
    const tree = await repo.GetTree(main.sha, true);
    const file = tree.find(x => x.name == filename);
    if (file == null) {
      return "File not found";
    }
    const object = {
      objectType: 3, // blob
      contentType: "text/plain",
      data: Buffer.from(content),
    };
    const sha = tools.objectSha(object);
    object["sha"] = sha;
    file.sha = sha;
    const treeobj = tools.createTree(tree);
    const commit = tools.createCommit({ tree: treeobj.sha, parents: main.sha, author: "editor", committer: "editor", message: "Update " + filename });
    await repo.storeObject(object);
    await repo.storeObject(treeobj);
    await repo.storeObject(commit);
    await repo.upsertRef(head, commit.sha);
    return commit.sha;
  }
} // class
