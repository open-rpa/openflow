const fs = require("fs");
const gulp = require("gulp");
const shell = require("gulp-shell");
const replace = require('gulp-replace');
const merge = require('merge-stream');
const browserify = require('browserify');
const tsify = require('tsify');

const OpenFlowFiles = [
    "./OpenFlow/src/public/**/*.html", "./OpenFlow/src/public/**/*.css", "./OpenFlow/src/public/**/*.js", "./OpenFlow/src/public/**/*.json",
    "./OpenFlow/src/public/**/*.ico", "./OpenFlow/src/public/**/*.eot", "./OpenFlow/src/public/**/*.svg", "./OpenFlow/src/public/**/*.ttf",
    "./OpenFlow/src/public/**/*.woff", "./OpenFlow/src/public/**/*.woff2", "./OpenFlow/src/public/**/*.png"];
const NodeREDHTMLFiles = ["./OpenFlowNodeRED/src/nodered/nodes/**/*.html", "./OpenFlowNodeRED/src/nodered/nodes/**/*.png", "./OpenFlowNodeRED/src/nodered/nodes/**/*.json"]


const destination = "./dist/public";
let version = "0.0.1";
if (fs.existsSync("../VERSION")) {
    version = fs.readFileSync("../VERSION", "utf8");
} else if (fs.existsSync("VERSION")) {
    version = fs.readFileSync("VERSION", "utf8");
}
gulp.task("copyfiles1", function () {
    const openflow = gulp.src(OpenFlowFiles).pipe(gulp.dest(destination));
    const nodered = gulp.src(NodeREDHTMLFiles).pipe(gulp.dest("OpenFlowNodeRED/dist/nodered/nodes"));
    const version1 = gulp.src('./VERSION').pipe(gulp.dest("./dist"));
    const version2 = gulp.src('./VERSION').pipe(gulp.dest("OpenFlowNodeRED/dist"));

    const copyspurce = gulp.src('./OpenFlow/src/public/**/*.ts').pipe(gulp.dest(destination + '/OpenFlow/src/public'));
    return merge(openflow, nodered, version1, version2, copyspurce);
});
gulp.task("watch", function () {
    return gulp.watch(NodeREDHTMLFiles.concat(OpenFlowFiles).concat('./VERSION').concat('./OpenFlow/src/public/**/*.ts'), gulp.series("copyfiles1", "browserify"));
});
gulp.task("browserify", function () {
    const bfi = browserify({
        entries: ['./OpenFlow/src/public/app.ts'],
        debug: true,
        basedir: '.'
    })
        .plugin(tsify, { noImplicitAny: false })
        .bundle()
        .pipe(fs.createWriteStream('./dist/public/bundle.js'));
    return bfi;
});

gulp.task("compose", shell.task([
    'echo "delete npmrc and cache"',
    'if exist "OpenFlowNodeRED\\dist\\nodered\\.npmrc" del OpenFlowNodeRED\\dist\\nodered\\.npmrc',
    'if exist "OpenFlowNodeRED\\dist\\.cache" rmdir OpenFlowNodeRED\\dist\\.cache /s /q ',
    'gulp copyfiles1',
    'gulp browserify',
    'echo "compile OpenFlowNodeRED"',
    'cd OpenFlowNodeRED && tsc -p tsconfig.json',
    'echo "compile OpenFlow"',
    'tsc -p OpenFlow/tsconfig.json',
    'echo "Build openiap/nodered"',
    'cd OpenFlowNodeRED && docker build -t openiap/nodered:edge .',
    'docker tag openiap/nodered:edge openiap/nodered:' + version,
    'echo "Push openiap/nodered"',
    'docker push openiap/nodered:edge',       //'docker push openiap/nodered:' + version,
    'docker push openiap/nodered:' + version,       //'docker push openiap/nodered:' + version,
    'echo "Build openiap/openflow"',
    'docker build -t openiap/openflow:edge .',
    'docker tag openiap/openflow:edge openiap/openflow:' + version,
    'echo "Push openiap/openflow"',
    'docker push openiap/openflow:edge',
    'docker push openiap/openflow:' + version
]));

gulp.task("latest", shell.task([
    'docker tag openiap/nodered:edge openiap/nodered:latest',
    'echo "Push openiap/nodered"',
    'docker push openiap/nodered:latest',
    'docker tag openiap/openflow:edge openiap/openflow:latest',
    'echo "Push openiap/openflow"',
    'docker push openiap/openflow:latest',
]));
gulp.task("composelatest", gulp.series("compose", "latest"));

gulp.task("bumpyml1", function () {
    return gulp.src(["./*.yml"]).pipe(replace(/openflow:\d+(\.\d+)+/g, 'openflow:' + version)).
        pipe(gulp.dest("./"));
});
gulp.task("bumpyml2", function () {
    return nodered = gulp.src(["./*.yml"]).pipe(replace(/nodered:\d+(\.\d+)+/g, 'nodered:' + version)).
        pipe(gulp.dest("./"));
});
gulp.task("bumpflow", function () {
    console.log('openiap/openflow:' + version);
    return gulp.src(["config/**/controllers.yml"])
        .pipe(replace(/openflow:\d+(\.\d+)+/g, 'openflow:' + version))
        .pipe(gulp.dest("config"));
});
gulp.task("bumpnodered", function () {
    console.log('openiap/nodered:' + version);
    return gulp.src(["config/**/controllers.yml"])
        .pipe(replace(/nodered:\d+(\.\d+)+/g, 'nodered:' + version))
        .pipe(gulp.dest("config"));
});
gulp.task("bumpconfigmap", function () {
    console.log('openiap/nodered:' + version);
    return gulp.src(["config/**/configmap.yml"])
        .pipe(replace(/nodered:\d+(\.\d+)+/g, 'nodered:' + version))
        .pipe(gulp.dest("config"));
});

gulp.task("bumpaiotfrontend", function () {
    let version = "0.0.1";
    version = fs.readFileSync("../aiot-frontend/VERSION", "utf8");
    console.log('openiap/aiot-frontend:' + version);
    return gulp.src(["config/**/controllers.yml"])
        .pipe(replace(/aiot-frontend:\d+(\.\d+)+/g, 'aiot-frontend:' + version))
        .pipe(gulp.dest("config"));
});
gulp.task("bumpprojectfiles", function () {
    let data = require("./package.json");
    console.log(data.version + " updated to " + version);
    data.version = version;
    let json = JSON.stringify(data, null, 2);
    fs.writeFileSync("package.json", json);
    data.version = "1.1.57";
    json = JSON.stringify(data, null, 2);
    fs.writeFileSync("docker-package.json", json); // keep a project file that is not changed so we dont need to rebuild everything every time

    data = require("./OpenFlowNodeRED/package.json");
    console.log(data.version + " updated to " + version);
    data.version = version;
    json = JSON.stringify(data, null, 2);
    fs.writeFileSync("OpenFlowNodeRED/package.json", json);

    data.version = "1.1.57";
    json = JSON.stringify(data, null, 2);
    fs.writeFileSync("OpenFlowNodeRED/docker-package.json", json); // keep a project file that is not changed so we dont need to rebuild everything every time

    return gulp.src('.');

});

gulp.task("bump", gulp.series("bumpyml1", "bumpyml2", "bumpflow", "bumpnodered", "bumpconfigmap", "bumpaiotfrontend", "bumpprojectfiles", "copyfiles1"));

gulp.task("default", gulp.series("copyfiles1", "browserify", "watch"));