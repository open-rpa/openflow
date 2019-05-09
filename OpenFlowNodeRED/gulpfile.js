var fs = require('fs');
var gulp = require('gulp');
var shell = require('gulp-shell');

var version = '0.0.1';
if (fs.existsSync("../VERSION")) {
    version = fs.readFileSync("../VERSION", 'utf8');
} else if (fs.existsSync("VERSION")) {
    version = fs.readFileSync("VERSION", 'utf8');
}

gulp.task('default', shell.task([
    'tsc -p tsconfig.json',
    'docker build -t cloudhack/openflownodered:edge .',
    'docker tag cloudhack/openflownodered:edge cloudhack/openflownodered:' + version,
    'docker push cloudhack/openflownodered'
]));
