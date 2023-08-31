const fs = require("fs");
const path = require("path");
const gulp = require("gulp");
const shell = require("gulp-shell");
const replace = require('gulp-replace');
const merge = require('merge-stream');
const browserify = require('browserify');
const tsify = require('tsify');
const watchify = require('watchify');
const exorcist = require('exorcist')
const ts = require('gulp-typescript');
const sass = require('gulp-sass')(require('sass'));



let minify = true;
let watch = false;

const OpenFlowPublicFiles = [
    "./OpenFlow/src/public/**/*.html", "./OpenFlow/src/public/**/*.css", "./OpenFlow/src/public/**/*.js", "./OpenFlow/src/public/**/*.json",
    "./OpenFlow/src/public/**/*.ico", "./OpenFlow/src/public/**/*.eot", "./OpenFlow/src/public/**/*.svg", "./OpenFlow/src/public/**/*.ttf",
    "./OpenFlow/src/public/**/*.woff", "./OpenFlow/src/public/**/*.woff2", "./OpenFlow/src/public/**/*.png", "./OpenFlow/src/public/**/*.lang"];
const NodeREDHTMLFiles = ["./OpenFlowNodeRED/src/nodered/nodes/**/*.html", "./OpenFlowNodeRED/src/nodered/nodes/**/*.png", "./OpenFlowNodeRED/src/nodered/nodes/**/*.json"]

const publicdestination = "./dist/public";
const mapfile = path.join(__dirname, publicdestination, 'bundle.js.map')
let version = "0.0.1";
if (fs.existsSync("../package.json")) {
    var p = require("../package.json");
    version = p.version;    
} else if (fs.existsSync("package.json")) {
    var p = require("./package.json");
    version = p.version;    
}
gulp.task("copyfiles1", function () {
    console.log("copyfiles1")
    const openflow = gulp.src(OpenFlowPublicFiles).pipe(gulp.dest(publicdestination));

    const copyspurce = gulp.src('./OpenFlow/src/public/**/*.ts').pipe(gulp.dest(publicdestination + '/OpenFlow/src/public'));
    const copyproto = gulp.src('./proto/**/*.*').pipe(gulp.dest('./dist/proto/proto'));
    return merge(openflow, copyspurce, copyproto);
});
gulp.task("setwatch", async function () {
    minify = false;
    watch = true;
});
gulp.task("dowatch", function () {
    console.log("watch")
    return gulp.watch(NodeREDHTMLFiles.concat(OpenFlowPublicFiles)
        .concat('./OpenFlow/src/public/**/*.ts')
        .concat('./OpenFlow/src/proto/**/*.*')
        , gulp.series("browserify", "copyfiles1"));
});
gulp.task("filewatch", function () {
    console.log("watch")
    return gulp.watch(NodeREDHTMLFiles.concat(OpenFlowPublicFiles)
        .concat('./OpenFlow/src/public/**/*.ts')
        .concat('./OpenFlow/src/proto/**/*.*')
        , gulp.series( "copyfiles1"));
});



gulp.task('dosass', function () {
    return gulp
        .src('./OpenFlow/src/public/**/*.scss')
        .pipe(sass().on('error', sass.logError))
        .pipe(gulp.dest('./OpenFlow/src/public'));
});
gulp.task("sass", gulp.series("dosass", "copyfiles1"));

let bfi = null;


gulp.task("deps", function () {
    if (bfi != null) return gulp.src('.');
    const config = {
        entries: ['./OpenFlow/src/public/app.ts'],
        cache: {},
        packageCache: {},
        debug: true,
        basedir: '.',
        plugin: []
    }
    bfi = browserify(config)
        .plugin(tsify, { noImplicitAny: false, skipLibCheck: true });
    bfi.pipeline.get('deps').push(require('through2').obj(
        function (row, enc, next) {
            var wasok = false;
            try {
                var stats = fs.statSync(row.file || row.id);
                var fileSizeInBytes = stats.size
                var fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
                fileSizeInMegabytes = parseFloat(fileSizeInMegabytes).toFixed(2);
                console.log((row.file || row.id) + " " + fileSizeInMegabytes + "mb");
                wasok = true;
            } catch (error) {
                console.log(error)
            }
            if (!wasok) {
                console.log(row.file || row.id);
            }

            next();
        }
    ));
    function bundle() {
        console.log('browserify bundle::begin()');
        const result = bfi.bundle()
            .on('error', function (error) {
                console.log(error.message ? error.message : error);
                this.emit('end');
            })
            .pipe(exorcist(mapfile))
            .pipe(fs.createWriteStream('./dist/public/bundle.js'));
        return result;
    };
    return bundle();
});

gulp.task("browserify", function () {
    console.log("browserify")
    if (bfi != null) return gulp.src('.');
    const config = {
        entries: ['./OpenFlow/src/public/app.ts'],
        cache: {},
        packageCache: {},
        debug: true,
        basedir: '.',
        plugin: []
    }
    if (watch) {
        console.log("Addin watchify")
        config.plugin.push(watchify);
    }
    bfi = browserify(config)
        .plugin(tsify, { noImplicitAny: false, skipLibCheck: true });
    if (minify) bfi.plugin('tinyify', {})
    bfi.transform('browserify-css', {
        minify: minify,
        output: './dist/public/bundle.css'
        ,
        // processRelativeUrl: function (relativeUrl) {
        //     if (relativeUrl.indexOf('..\\..\\..\\OpenFlow') > -1) {
        //         relativeUrl = relativeUrl.replace('..\\..\\..\\OpenFlow\\src\\public', '.');
        //     }
        //     try {
        //         var stripQueryStringAndHashFromPath = function (url) {
        //             return url.split('?')[0].split('#')[0];
        //         };
        //         var rootDir = path.resolve(process.cwd(), 'OpenFlow/src/public');
        //         var relativePath = stripQueryStringAndHashFromPath(relativeUrl);
        //         var queryStringAndHash = relativeUrl.substring(relativePath.length);

        //         // var prefix = '../node_modules/';
        //         var prefix = '..\\..\\..\\node_modules\\';
        //         if (relativeUrl.startsWith(relativePath, prefix)) {
        //             var vendorPath = 'vendor/' + relativePath.substring(prefix.length);
        //             vendorPath = vendorPath.replace("@", "");
        //             console.log("vendorPath: " + vendorPath)
        //             var source = path.join(rootDir, relativePath);
        //             var target = path.join(rootDir, vendorPath);
        //             if (fs.existsSync(source)) {
        //                 fs.mkdirSync(path.dirname(target), { recursive: true });
        //                 fs.copyFileSync(source, target);
        //             } else if (source.indexOf('fontawesome-webfont') > -1) {
        //                 // console.error(source + " WHAT?????")
        //             } else {
        //                 console.error(source + " not found")
        //             }

        //             // Returns a new path string with original query string and hash fragments
        //             return vendorPath + queryStringAndHash;
        //         }
        //     } catch (error) {
        //         console.error(error);

        //     }
        //     return relativeUrl;
        // }
    })
        ;
    // .transform('browserify-shim', { global: true })

    bfi.on('update', bundle);
    bfi.on('error', function (error) {
        console.error(error.message ? error.message : error);
        this.emit('end');
    });
    bfi.on('time', function (time) {
        if (time < 1499) {
            console.log('browserify bundle::end() in ' + time + ' ms');
        } else {
            console.log('browserify bundle::end() in ' + (time / 1000) + ' s');
        }
    })
    function bundle() {
        console.log('browserify bundle::begin()');
        const result = bfi.bundle()
            .on('error', function (error) {
                console.log(error.message ? error.message : error);
                this.emit('end');
            })
            .pipe(exorcist(mapfile))
            .pipe(fs.createWriteStream('./dist/public/bundle.js'));
        return result;
    };
    return bundle();
});

// 'echo "compile OpenFlowNodeRED"',
// 'cd OpenFlowNodeRED && tsc -p tsconfig.json',
// 'echo "compile OpenFlow"',
// 'tsc -p OpenFlow/tsconfig.json',

// 'echo "delete npmrc and cache"',
// 'if exist "OpenFlowNodeRED\\dist\\nodered\\.npmrc" del OpenFlowNodeRED\\dist\\nodered\\.npmrc',
// 'if exist "OpenFlowNodeRED\\dist\\.cache" rmdir OpenFlowNodeRED\\dist\\.cache /s /q ',
// 'gulp copyfiles1',
// 'gulp browserify',

// 'echo "delete npmrc and cache"',
// 'if exist "OpenFlowNodeRED\\dist\\nodered\\.npmrc" del OpenFlowNodeRED\\dist\\nodered\\.npmrc',
// 'if exist "OpenFlowNodeRED\\dist\\.cache" rmdir OpenFlowNodeRED\\dist\\.cache /s /q ',
// 'gulp copyfiles1',
// 'gulp browserify',

// gulp.task("compose", shell.task([
//     // docker buildx create --name openiap --use
//     // docker buildx use default
//     // docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 -t openiap/openflow:edge .
//     `echo "docker buildx build -t openiap/openflow:edge -t openiap/openflow:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push ."`,
//     `echo "docker buildx build -t openiap/nodered:edge -t openiap/nodered:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push --file ./OpenFlowNodeRED/Dockerfile ."`,
//     `echo "docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer ."`,
//     `echo "docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui ."`,
//     `docker buildx build -t openiap/openflow:edge -t openiap/openflow:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push .`,
//     `docker buildx build -t openiap/nodered:edge -t openiap/nodered:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --file ./OpenFlowNodeRED/Dockerfile --push .`,
//     `docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer .`,
//     `docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui .`,
// ]));
gulp.task("compose", shell.task([
    // docker buildx create --name openiap --use
    // linux workaround ?
    // docker run -it --rm --privileged tonistiigi/binfmt --install all
    // docker buildx use default
    // docker buildx build --platform linux/amd64 -t openiap/openflow:edge .
    // second work around
    // wget https://github.com/docker/buildx/releases/download/v0.4.1/buildx-v0.4.1.linux-amd64
    // chmod a+x buildx-v0.4.1.linux-amd64
    // mkdir -p ~/.docker/cli-plugins
    // mv buildx-v0.4.1.linux-amd64 ~/.docker/cli-plugins/docker-buildx

    `docker buildx build -t openiap/openflow:edge -t openiap/openflow:` + version + ` --platform linux/amd64 --push .`,
    // `docker buildx build -t openiap/nodered:edge -t openiap/nodered:` + version + ` --platform linux/amd64 --push --file ./OpenFlowNodeRED/Dockerfile .`,


    // `echo "docker buildx build -t openiap/openflow:edge -t openiap/openflow:` + version + ` --platform linux/amd64 --push ."`,
    // `echo "docker buildx build -t openiap/nodered:edge -t openiap/nodered:` + version + ` --platform linux/amd64 --push --file ./OpenFlowNodeRED/Dockerfile ."`,
    // `echo "docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer ."`,
    // `echo "docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui ."`,
    // `docker buildx build -t openiap/openflow:edge -t openiap/openflow:` + version + ` --platform linux/amd64 --push .`,
    // `docker buildx build -t openiap/nodered:edge -t openiap/nodered:` + version + ` --platform linux/amd64 --push --file ./OpenFlowNodeRED/Dockerfile .`,
    // `docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer .`,
    // `docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui .`,
]));

gulp.task("latest", shell.task([
    `echo "docker buildx build -t openiap/openflow:edge -t openiap/openflow:latest -t openiap/openflow:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push ."`,
    // `echo "docker buildx build -t openiap/nodered:edge -t openiap/nodered:latest -t openiap/nodered:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push --file ./OpenFlowNodeRED/Dockerfile ."`,
    // `echo "docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:latest -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer ."`,
    // `echo "docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:latest -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui ."`,
    // ,linux/arm64,linux/arm/v7,linux/arm/v6
    `docker buildx build -t openiap/openflow:edge -t openiap/openflow:latest -t openiap/openflow:` + version + ` --platform linux/amd64 --push .`,
    // `docker buildx build -t openiap/nodered:edge -t openiap/nodered:latest -t openiap/nodered:` + version + ` --platform linux/amd64,linux/arm64,linux/arm/v7,linux/arm/v6 --push --file ./OpenFlowNodeRED/Dockerfile .`,
    // `docker buildx build -t openiap/nodered-puppeteer:edge -t openiap/nodered-puppeteer:latest -t openiap/nodered-puppeteer:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfilepuppeteer .`,
    // `docker buildx build -t openiap/nodered-tagui:edge -t openiap/nodered-tagui:latest -t openiap/nodered-tagui:` + version + ` --platform linux/amd64 --push -f ./OpenFlowNodeRED/Dockerfiletagui .`,
]));
/*
docker buildx build -t openiap/openflow:edge -t openiap/openflow:latest -t openiap/openflow:1.5.0 --platform linux/amd64 --push .
docker buildx build -t openiap/openflow:edge -t openiap/openflow:latest -t openiap/openflow:1.5.0 --platform linux/arm/v7 --push .
docker buildx build -t openiap/openflow:edge -t openiap/openflow:latest -t openiap/openflow:1.5.0 --platform linux/arm/v6 --push .

*/

gulp.task("bumpprojectfiles", function () {
    let data = require("./package.json");
    console.log(data.version + " updated to " + version);
    data.version = version;
    let json = JSON.stringify(data, null, 2);
    fs.writeFileSync("package.json", json);
    // data.version = "1.1.57";
    // json = JSON.stringify(data, null, 2);
    // fs.writeFileSync("docker-package.json", json); // keep a project file that is not changed so we dont need to rebuild everything every time

    // data = require("./OpenFlowNodeRED/package.json");
    // console.log(data.version + " updated to " + version);
    // data.version = version;
    // json = JSON.stringify(data, null, 2);
    // fs.writeFileSync("OpenFlowNodeRED/package.json", json);

    // data.version = "1.1.57";
    // json = JSON.stringify(data, null, 2);
    // fs.writeFileSync("OpenFlowNodeRED/docker-package.json", json); // keep a project file that is not changed so we dont need to rebuild everything every time

    return gulp.src('.');

});


var tsOpenFlowProject = ts.createProject('OpenFlow/tsconfig.json');
var tsNodeREDProject = ts.createProject('OpenFlowNodeRED/tsconfig.json');
gulp.task('ts-openflow', function () {
    var tsResult = tsOpenFlowProject.src().pipe(tsOpenFlowProject());
    return tsResult.js.pipe(gulp.dest('dist'));
});
gulp.task('ts-nodered', function () {
    var tsResult = tsNodeREDProject.src().pipe(tsNodeREDProject());
    return tsResult.js.pipe(gulp.dest('OpenFlowNodeRED/dist'));
});
gulp.task("ts", gulp.series("ts-openflow", "ts-nodered"));

gulp.task("build", gulp.series("copyfiles1", "sass", "ts", "browserify", "copyfiles1"));


gulp.task("bump", gulp.series("bumpprojectfiles", "copyfiles1"));

gulp.task("watch", gulp.series("setwatch", "browserify", "copyfiles1", "dowatch"));
gulp.task("default", gulp.series("copyfiles1", "browserify", "copyfiles1"));