import fs from 'fs';
import gulp from 'gulp';
import shell from 'gulp-shell';

let minify = true;
let watch = false;

const PublicFiles = ["./public/**/*.*", "./public.template/**/*.*"];
    
const publicdestination = "./dist/public";
let version = "0.0.1";
if (fs.existsSync("../package.json")) {
    let json1 = fs.readFileSync("../package.json");
    var p1 = JSON.parse(json1);
    version = p1.version;    
} else if (fs.existsSync("package.json")) {
    let json2 = fs.readFileSync("package.json");
    var p2 = JSON.parse(json2);
    version = p2.version;    
}
gulp.task("copyfiles1", function () {
    console.log("copyfiles1")
    const base = gulp.src(PublicFiles).pipe(gulp.dest(publicdestination));
    return base;
});
gulp.task("setwatch", async function () {
    fs.mkdirSync(publicdestination, { recursive: true });
    minify = false;
    watch = true;
});
gulp.task("dowatch", function () {
    console.log("watch")
    return gulp.watch(PublicFiles
        .concat('./public/**/*.*')
        .concat('./src/proto/**/*.*')
        , gulp.series("copyfiles1"));
});
gulp.task("filewatch", function () {
    console.log("watch")
    return gulp.watch(PublicFiles
        .concat('./public/**/*.*')
        .concat('./src/proto/**/*.*')
        , gulp.series( "copyfiles1"));
});



//     // docker buildx create --name openiap --use
//     // docker buildx use default
//     // docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 -t openiap/openflow:edge .
gulp.task("compose", async function (done) {
    var versions = ["-t openiap/openflow:edge", "-t openiap/openflow:" + version]
    const dotCount = version.split('.').length - 1;
    if(dotCount == 3){
        let majorversion = version.substring(0, version.lastIndexOf('.'));
        versions.push("-t openiap/openflow:" + majorversion);
    }
    console.log(versions)
    return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/amd64,linux/arm64,linux/arm/v7 --push .`])();
    // return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push .`])();
    // return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/arm64 --push .`])();
});
gulp.task("latest", async function (done) {
    var versions = ["-t openiap/openflow:latest", "-t openiap/openflow:edge", "-t openiap/openflow:" + version]
    const dotCount = version.split('.').length - 1;
    if(dotCount == 3){
        let majorversion = version.substring(0, version.lastIndexOf('.'));
        versions.push("-t openiap/openflow:" + majorversion);
    }
    console.log(versions)
    return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/amd64 --load .`])();
});
    
gulp.task("build", gulp.series("copyfiles1"));
gulp.task("watch", gulp.series("setwatch", "copyfiles1", "dowatch"));
gulp.task("default", gulp.series("copyfiles1"));