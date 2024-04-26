import fs from 'fs';
import path from 'path';
import gulp from 'gulp';
import shell from 'gulp-shell';
import merge from 'merge-stream';
import browserify from 'browserify';
import tsify from 'tsify';
import watchify from 'watchify';
import exorcist from 'exorcist'
import ts from 'gulp-typescript';
import through2 from 'through2';
import * as __sass from 'sass';
import _sass from 'gulp-sass';
const sass = _sass(__sass); 
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let minify = true;
let watch = false;

const OpenFlowPublicFiles = [
    "./OpenFlow/src/public/**/*.html", "./OpenFlow/src/public/**/*.css", "./OpenFlow/src/public/**/*.js", "./OpenFlow/src/public/**/*.json",
    "./OpenFlow/src/public/**/*.ico", "./OpenFlow/src/public/**/*.eot", "./OpenFlow/src/public/**/*.svg", "./OpenFlow/src/public/**/*.ttf",
    "./OpenFlow/src/public/**/*.woff", "./OpenFlow/src/public/**/*.woff2", "./OpenFlow/src/public/**/*.png", "./OpenFlow/src/public/**/*.lang",
    "./OpenFlow/src/public/**/*.json"];

const publicdestination = "./dist/public";
const mapfile = path.join(__dirname, publicdestination, 'bundle.js.map')
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
    const openflow = gulp.src(OpenFlowPublicFiles).pipe(gulp.dest(publicdestination));

    const copyspurce = gulp.src('./OpenFlow/src/public/**/*.ts').pipe(gulp.dest(publicdestination + '/OpenFlow/src/public'));
    const copyproto = gulp.src('./proto/**/*.*').pipe(gulp.dest('./dist/proto/proto'));
    return merge(openflow, copyspurce, copyproto);
});
gulp.task("setwatch", async function () {
    fs.mkdirSync(publicdestination, { recursive: true });
    minify = false;
    watch = true;
});
gulp.task("dowatch", function () {
    console.log("watch")
    return gulp.watch(OpenFlowPublicFiles
        .concat('./OpenFlow/src/public/**/*.ts')
        .concat('./OpenFlow/src/proto/**/*.*')
        , gulp.series("browserify", "copyfiles1"));
});
gulp.task("filewatch", function () {
    console.log("watch")
    return gulp.watch(OpenFlowPublicFiles
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
    bfi.pipeline.get('deps').push(through2.obj(
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
        .plugin(tsify, { noImplicitAny: false, skipLibCheck: true, esModuleInterop: true});
    if (minify) bfi.plugin('tinyify', {})
    bfi.transform('browserify-css', {
        minify: minify,
        output: './dist/public/bundle.css'
    });

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
    return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/amd64 --push .`])();
});
gulp.task("latest", async function (done) {
    var versions = ["-t openiap/openflow:latest", "-t openiap/openflow:edge", "-t openiap/openflow:" + version]
    const dotCount = version.split('.').length - 1;
    if(dotCount == 3){
        let majorversion = version.substring(0, version.lastIndexOf('.'));
        versions.push("-t openiap/openflow:" + majorversion);
    }
    console.log(versions)
    return shell.task([`docker buildx build ${versions.join(" ")} --platform linux/amd64 --push .`])();
});
    
gulp.task("bumpprojectfiles", function () {
    var _json = fs.readFileSync("package.json");
    let data = JSON.parse(_json);
    console.log(data.version + " updated to " + version);
    data.version = version;
    let json = JSON.stringify(data, null, 2);
    fs.writeFileSync("package.json", json);
    return gulp.src('.');

});

var tsOpenFlowProject = ts.createProject('OpenFlow/tsconfig.json');
gulp.task('ts-openflow', function () {
    var tsResult = tsOpenFlowProject.src().pipe(tsOpenFlowProject());
    return tsResult.js.pipe(gulp.dest('dist'));
});
gulp.task("ts", gulp.series("ts-openflow"));

gulp.task("build", gulp.series("copyfiles1", "sass", "ts", "browserify", "copyfiles1"));


gulp.task("bump", gulp.series("bumpprojectfiles", "copyfiles1"));

gulp.task("watch", gulp.series("setwatch", "browserify", "copyfiles1", "dowatch"));
gulp.task("default", gulp.series("copyfiles1", "browserify", "copyfiles1"));