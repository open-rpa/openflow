var fs = require("fs");
var gulp = require("gulp");
var shell = require("gulp-shell");
var replace = require('gulp-replace');

var destination = "./dist/public";
var version = "0.0.1";
if (fs.existsSync("../VERSION")) {
    version = fs.readFileSync("../VERSION", "utf8");
} else if (fs.existsSync("VERSION")) {
    version = fs.readFileSync("VERSION", "utf8");
}
gulp.task("copyfiles1", function() {
    console.log("copyfiles1");
    return gulp.src(["OpenFlow/src/public/**/*.html", "OpenFlow/src/public/**/*.css", 
    "OpenFlow/src/public/**/*.js", "OpenFlow/src/public/**/*.json", "OpenFlow/src/public/**/*.ico", "OpenFlow/src/public/**/*.png"])
        .pipe(gulp.dest(destination));
});
gulp.task("copyfiles2", function() {
    console.log("copyfiles2");
    return gulp.src(["OpenFlowNodeRED/src/nodered/nodes/*.html"])
        .pipe(gulp.dest("OpenFlowNodeRED/dist/nodered/nodes"));
});
gulp.task("watch", function() {
    gulp.watch(["OpenFlow/src/public/**/*.html", "OpenFlow/src/public/**/*.css", "OpenFlow/src/public/**/*.js", "OpenFlow/src/public/**/*.json", 
    "OpenFlow/src/public/**/*.ico", , "OpenFlow/src/public/**/*.png"], gulp.series("copyfiles1"));
    return gulp.watch(["OpenFlowNodeRED/src/nodered/nodes/**/*.html"], gulp.series("copyfiles2"));
});

// gulp.task("compose", shell.task([
//     'cd OpenFlowNodeRED && tsc -p tsconfig.json && docker build -t cloudhack/openflownodered:edge .',
//     'cd OpenFlowNodeRED && tsc -p tsconfig.json && docker build -t cloudhack/openflownodered:edge .',
//     'docker tag cloudhack/openflownodered:edge cloudhack/openflownodered:' + version,
//     'docker push cloudhack/openflownodered',
//     'gulp copyfiles',
//     'tsc -p OpenFlow/tsconfig.json',
//     'docker build -t cloudhack/openflow:edge .',
//     'docker tag cloudhack/openflow:edge cloudhack/openflow:' + version,
//     'docker push cloudhack/openflow'
// ]));
gulp.task("compose", shell.task([
    'gulp copyfiles1',
    'gulp copyfiles2',
    'echo "compile OpenFlowNodeRED"',
    'cd OpenFlowNodeRED && tsc -p tsconfig.json',
    'echo "Build cloudhack/openflownodered"',
    'cd OpenFlowNodeRED && docker build -t cloudhack/openflownodered:edge .',
    'docker tag cloudhack/openflownodered:edge cloudhack/openflownodered:' + version,
    'echo "Push cloudhack/openflownodered"',
    'docker push cloudhack/openflownodered:' + version,
    'echo "compile OpenFlow"',
    'tsc -p OpenFlow/tsconfig.json',
    'echo "Build cloudhack/openflow"',
    'docker build -t cloudhack/openflow:edge .',
    'docker tag cloudhack/openflow:edge cloudhack/openflow:' + version,
    'echo "Push cloudhack/openflow"',
    'docker push cloudhack/openflow:' + version
]));

gulp.task("bump", function() {
    console.log('cloudhack/openflownodered:' + version);
    gulp.src(["config/**/controllers.yml"])
        .pipe(replace(/openflow:\d+(\.\d+)+/g, 'openflow:' + version))
        .pipe(gulp.dest("config"));

        return gulp.src(["config/**/controllers.yml"])
        .pipe(replace(/openflownodered:\d+(\.\d+)+/g, 'openflownodered:' + version))
        .pipe(gulp.dest("config"));
});

gulp.task("default", gulp.series("copyfiles1", "copyfiles2", "watch"));