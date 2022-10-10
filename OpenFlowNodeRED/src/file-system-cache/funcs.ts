/*
The MIT License (MIT)

Copyright (c) 2015 Phil Cockfield <phil@cockfield.net> (https://github.com/philcockfield)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

let R: any = null;
try {
    R = require("ramda");
} catch (error) {
}
let fs: any = null;
try {
    fs = require("fs");
} catch (error) {
}
let fsPath: any = null;
try {
    fsPath = require("path");
} catch (error) {
}
let crypto: any = null;
try {
    crypto = require("crypto");
} catch (error) {
}

export const isNothing = (value) => R.isNil(value) || R.isEmpty(value);
export const isString = R.is(String);
export const compact = R.pipe(R.flatten, R.reject(R.isNil));
export const toStringArray = R.pipe(compact, R.map(R.toString));
export const toAbsolutePath = (path) => path.startsWith('.') ? fsPath.resolve(path) : path;
export const ensureString = R.curry(
    (defaultValue, text) => R.is(String, text) ? text : defaultValue
);


export const isFileSync = (path) => {
    if (fs.existsSync(path)) {
        return fs.lstatSync(path).isFile();
    }
    return false;
};


export const readFileSync = (path) => {
    if (fs.existsSync(path)) {
        return fs.readFileSync(path).toString();
    }
};


export const existsP = (path) => new Promise<boolean>((resolve) => {
    fs.exists(path, (exists) => resolve(exists));
});


export const removeFileP = (path) => new Promise<void>((resolve, reject) => {
    existsP(path)
        .then((exists) => {
            if (exists) {
                fs.unlink(path, (err) => {
                    if (err) { reject(err); } else { resolve(); }
                });
            } else {
                resolve();
            }
        });
});


export const filePathsP = (basePath, ns) => new Promise<string[]>((resolve, reject) => {
    existsP(basePath)
        .then(exists => {
            if (!exists) { resolve([]); return; }
            fs.readdir(basePath, (err, fileNames) => {
                if (err) {
                    reject(err);
                } else {
                    const paths = R.pipe(
                        compact,
                        R.filter((name: string) => ns ? name.startsWith(ns) : true),
                        R.filter((name: string) => !ns ? !R.includes('-')(name) : true),
                        R.map(name => `${basePath}/${name}`)
                    )(fileNames);
                    resolve(paths);
                }
            });
        });
});


/**
 * Turns a set of values into a HEX hash code.
 * @param values: The set of values to hash.
 * @return {String} or undefined.
 */
export const hash = (...values) => {
    if (R.pipe(compact, R.isEmpty)(values)) { return undefined; }
    const resultHash = crypto.createHash('md5');
    const addValue = value => resultHash.update(value);
    const addValues = R.forEach(addValue);
    R.pipe(
        toStringArray,
        addValues
    )(values);
    return resultHash.digest('hex');
};