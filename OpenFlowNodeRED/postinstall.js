/* Copy/anspired from https://github.com/nodemailer/nodemailer */
/* eslint no-control-regex:0  */
'use strict';

const packageData = require('./package.json');
const isEnabled = value => !!value && value !== '0' && value !== 'false';
const canUseColor = isEnabled(process.env.npm_config_color);

const title = `=== OpenFlow ${packageData.version} ===`;
const text = `
Thank you for using OpenFlow! 
> OpenFlow source ( https://github.com/open-rpa/openflow/ )
> Community chat ( https://rocket.openiap.io/ )
> Documentation ( https://docs.openiap.io/ )
> commercial support  ( https://openrpa.dk/ ) enterprise version also avaible
`;

const secs = 1;

const formatCentered = (row, columns) => {
    if (columns <= row.length) {
        return row;
    }

    return ' '.repeat(Math.round(columns / 2 - row.length / 2)) + row;
};

const formatRow = (row, columns) => {
    if (row.length <= columns) {
        return [row];
    }
    // wrap!
    let lines = [];
    while (row.length) {
        if (row.length <= columns) {
            lines.push(row);
            break;
        }
        let slice = row.substr(0, columns);

        let prefix = slice.charAt(0) === '>' ? '  ' : '';

        let match = slice.match(/(\s+)[^\s]*$/);
        if (match && match.index) {
            let line = row.substr(0, match.index);
            row = prefix + row.substr(line.length + match[1].length);
            lines.push(line);
        } else {
            lines.push(row);
            break;
        }
    }
    return lines;
};


const concat = (x, y) => x.concat(y)

const flatMap = (f, xs) => xs.map(f).reduce(concat, [])

if (Array.prototype.flatMap === undefined) {
    Array.prototype.flatMap = function (f) {
        return flatMap(f, this)
    }
}
const wrapText = text => {
    let columns = Number(process.stdout.columns) || 80;
    columns = Math.min(columns, 80) - 1;

    return (formatCentered(title, columns) + '\n' + text)
        .split('\n')
        .flatMap(row => formatRow(row, columns))
        .join('\n');
    try {
    } catch (error) {
    }
};

const banner = wrapText(text)
    .replace(/^/gm, '\u001B[96m')
    .replace(/$/gm, '\u001B[0m')
    .replace(/(https:[^\s)]+)/g, '\u001B[94m $1 \u001B[96m');



console.log(canUseColor ? banner : banner.replace(/\u001B\[\d+m/g, ''));
if (canUseColor) {
    process.stdout.write('\u001B[96m');
}

setInterval(() => {
    process.stdout.write('.');
}, 500);

setTimeout(() => {
    if (canUseColor) {
        process.stdout.write('\u001B[0m\n');
    }
    process.exit(0);
}, secs * 1000 + 100);
