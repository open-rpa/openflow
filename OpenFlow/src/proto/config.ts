import * as fs from "fs";
export const ThrottlerMS = 0;
export const EndstreamDelay = 0;
export const BeginstreamDelay = 0;
export const ChecksumCheckFiles = true;
// export const ChecksumCheckPackages = false;
export const DoPing = false;
export const doDumpStack = true;
export const doDumpMesssages = (process.env.NODE_ENV != "production");
export const doDumpMesssagesSeq = true;
export const doDumpMesssagesIds = true;
export const doDumpTimestamp = false;
export const doDumpMesssageStreams = true;
export const doDumpMessageHexLines = 50
export const doDumpMessageHexBytesPerLine = 16 * 2;
export const DoDumpToConsole = false;
export const doDumpToFile = false;
export const defaultsocketport = 8080;
export const defaultwebport = 8080;
export const defaultgrpcport = 50051; // 50051;

// using ./message-parser
// with ChecksumCheckFiles = false
// 1024 * 256       21 files (1730.14 Mb) in 3.75 seconds (461.49 Mb/s)
// 1024 * 512       21 files (1730.14 Mb) in 3.40 seconds (509.46 Mb/s)
// 1024 * 1024      21 files (1730.14 Mb) in 3.86 seconds (447.99 Mb/s)
// 3 * 1024 * 1024  21 files (1730.14 Mb) in 3.57 seconds (484.09 Mb/s)
// 5 * 1024 * 1024  21 files (1730.14 Mb) in 3.57 seconds (485.18 Mb/s)
// 10 * 1024 * 1024 21 files (1730.14 Mb) in 3.58 seconds (483.68 Mb/s)
// using ./message-parser
// with ChecksumCheckFiles = true
// 1024 * 256       21 files (1730.14 Mb) in 13.82 seconds (125.21 Mb/s)
// const SendFileHighWaterMark = 1024 * 256;

// using ./message-parser.buffer.concat
// with ChecksumCheckFiles = false
// 1024 * 256       21 files (1730.14 Mb) in 3.87 seconds (447.30 Mb/s)
// 1024 * 512       21 files (1730.14 Mb) in 4.25 seconds (407.09 Mb/s)
// 1024 * 1024      21 files (1730.14 Mb) in 5.29 seconds (327.06 Mb/s)
// 3 * 1024 * 1024  21 files (1730.14 Mb) in 9.50 seconds (182.12 Mb/s)
// 5 * 1024 * 1024  21 files (1730.14 Mb) in 14.91 seconds (116.04 Mb/s)
// 10 * 1024 * 1024 21 files (1730.14 Mb) in 25.97 seconds (66.61 Mb/s)
// using ./message-parser.buffer.concat
// with ChecksumCheckFiles = true
// 1024 * 256       21 files (1730.14 Mb) in 13.81 seconds (125.26 Mb/s)
export const SendFileHighWaterMark = 1024 * 256;

var color = {
  Reset: "\x1b[0m",
  Bright: "\x1b[1m",
  Dim: "\x1b[2m",
  Underscore: "\x1b[4m",
  Blink: "\x1b[5m",
  Reverse: "\x1b[7m",
  Hidden: "\x1b[8m",

  FgBlack: "\x1b[30m",
  FgRed: "\x1b[31m",
  FgGreen: "\x1b[32m",
  // FgYellow: "\x1b[33m",
  FgYellow: "\x1b[93m", // bright yellow 
  FgBlue: "\x1b[34m",
  FgMagenta: "\x1b[35m",
  FgCyan: "\x1b[36m",
  FgWhite: "\x1b[37m",

  BgBlack: "\x1b[40m",
  BgRed: "\x1b[41m",
  BgGreen: "\x1b[42m",
  BgYellow: "\x1b[43m",
  BgBlue: "\x1b[44m",
  BgMagenta: "\x1b[45m",
  BgCyan: "\x1b[46m",
  BgWhite: "\x1b[47m",
}
export function info(message) {
  console.log(`[${colrole()}][${col("INF", color.FgCyan)}] ${message}`);
}
export function warn(message) {
  console.log(`[${colrole()}][${col("WAR", color.FgYellow + color.Bright)}] ${message}`);
}
export function err(error) {
  if(!error) return;
  if (error && error.stack && doDumpStack) {
    console.log(`[${colrole()}][${col("ERR", color.FgRed)}] ${error.stack}`);
    return
  }
  console.log(`[${colrole()}][${col("ERR", color.FgRed)}] ${error.message ? error.message : error}`);
}
export function dumpmessage(direction, message) {
  if (!doDumpMesssages) return;
  let { id, rid, command } = message;
  let sequence = message.seq;
  if (command == "beginstream" || command == "stream" || command == "endstream") {
    if (!doDumpMesssageStreams)
      return;
  }
  if (!rid) rid = "";
  rid = rid.padEnd(4, " ");
  if (!id) id = "";
  id = id.padEnd(4, " ");
  var data = message.data;
  if (command == "stream") data = "... " + data.length + " bytes";
  if (data) {
    // if(typeof data == "string" && data.startsWith("{")) data = JSON.stringify(data);
    if(typeof data == "object"){
      if(data.value) {
        if(Buffer.isBuffer(data.value)){
          data = data.value.toString();
        } else {
          data = JSON.stringify(data.value);
        }
      } else {
        if(Buffer.isBuffer(data)) {
          data = data.toString();
        } else {
          data = JSON.stringify(data);
        }
      }
    } else {
      data = data.toString();
    }
    
    // data = data.replace(/[^\x00-\x7F]/g, "");
    data = data.replace(/[^A-Za-z 0-9 \.,\?""!@#\$%\^&\*\(\)-_=\+;:<>\/\\\|\}\{\[\]`~]*/g, '')
  } else {
    data = "";
  }
  var columns = process.stdout.columns;
  var sub = 3;
  if(!columns) columns = 70; // vs-code ?
  if(!columns || columns < 80) columns = 80;
  sub = `${ts()}[${role()}][${direction}]${seq(sequence, id, rid)}[${command}] `.length;
  if (data && data.length > columns) data = data.substr(0, columns - sub -3 ) + "...";
  if (direction == "SND") direction = col(direction, color.Dim + color.FgYellow);
  if (direction == "RCV") direction = col(direction, color.FgCyan);
  command = col(command, color.FgGreen);
  id = col(id, color.FgBlue);
  rid = col(rid, color.FgBlue);
  console.log(`${ts()}[${colrole()}][${direction}]${seq(sequence, id, rid)}[${command}] ${data}`);
  if (data) {
    if (message.command == "stream" && message.data.length > 6) {
      dumpdata(message.data);
      if (!doDumpMesssageStreams)
        return;
    }
  }
}
var filecounter = 0;
var filedata = "";
export function dumpdata(data) {
  var radix = 16;
  var littleEndian = true;
  var content = "";
  const ALL_EXCEPT_PRINTABLE_LATIN = /[^\x20-\x7f]/g
  const CONTROL_CHARACTERS_ONLY = /[\x00-\x1f]/g
  if(DoDumpToConsole) {
    for (var start = 0; start < data.length && start < (doDumpMessageHexLines*doDumpMessageHexBytesPerLine); start += doDumpMessageHexBytesPerLine) {
      const end = Math.min(start + doDumpMessageHexBytesPerLine, data.length)
      const slice = data.slice(start, end)
      content += hex(slice, doDumpMessageHexBytesPerLine, 2, radix, littleEndian) + " " + slice.toString('ascii').replace(CONTROL_CHARACTERS_ONLY, ".") + "\n";
    }
    console.log(content.substring(0, content.length - 1));
  }

  if(doDumpToFile) {
    for (var start = 0; start < data.length; start += doDumpMessageHexBytesPerLine) {
      const end = Math.min(start + doDumpMessageHexBytesPerLine, data.length)
      const slice = data.slice(start, end)
      content += hex(slice, doDumpMessageHexBytesPerLine, 2, radix, littleEndian) + " " + slice.toString('ascii').replace(CONTROL_CHARACTERS_ONLY, ".") + "\n";
    }
    fs.appendFileSync(role() + '.hex', content);
  }
}
var hex = function(buffer, bytes_per_line, bytes_per_group, radix, littleEndian) {
  var str = ""
  const delimiter = bytes_per_group == 0 ? "" : " "
  const group_len = maxnumberlen(bytes_per_group, radix)
  const padlen = (bytes_per_line - buffer.length) * (bytes_per_group == 0 ? group_len: (group_len + 1) / bytes_per_group)
  if (bytes_per_group == 0) {
    bytes_per_group = 1
  }
  const start = littleEndian ? bytes_per_group - 1 : 0
  const end   = littleEndian ? -1 : bytes_per_group
  const step  = littleEndian ? -1 : 1
  for (var group = 0; group < buffer.length / bytes_per_group; ++group) {
    var val = bytes_per_group < 4 ? 0 : BigInt(0)
    for (var ii = start; ii != end; ii += step) {
      const i = group * bytes_per_group + ii
      if (i >= buffer.length) { // not rendering dangling bytes.  TODO: render them as smaller grouping
        break
      }
      if (bytes_per_group < 4) {
        // @ts-ignore
        val = val * 256 + ((buffer.constructor == String ? buffer.codePointAt(i) : buffer[i]) & 0xff)
      } else {
        // @ts-ignore
        val = BigInt(val) * 256n + BigInt(((buffer.constructor == String ? buffer.codePointAt(i) : buffer[i]) & 0xff))
      }
    }
    const text = val.toString(radix)
    for (var c = 0; c < group_len - text.length; c++) {
      str += "0"
    }
    str += text
    str += delimiter
  }
  if (buffer.length < bytes_per_line) {
    str += " ".repeat(padlen)
  }
  // str = rpad(str, self.hex_line_length)
  return str
}
var maxnumberlen = function(bytes, radix) {
  var result = 2
  if (bytes == 0) {
    bytes = 1
  }
  switch (radix) {
    case 2:       // BIN: 8, 16, 32, 64
      result = bytes * 8
      break
    case 8:       // OCT: 3, 6, 11, 22
      switch (bytes) {
        case 1:
          result = 3
          break
        case 2:
          result = 6
          break
        case 4:
          result = 11
          break
        case 8:
          result = 22
          break
      }
      break
    case 10:      // DEC: 3, 6, 10, 20
      switch (bytes) {
        case 1:
          result = 3
          break
        case 2:
          result = 6
          break
        case 4:
          result = 10
          break
        case 8:
          result = 20
          break
      }
      break
    case 16:      // HEX: 2, 4, 8, 16
      result = 2 * bytes
      break
  }
  return result
}
export function col(text, c) {
  return c + text + color.Reset;
}
function colrole() {
  if (role() == "client") {
    return col(role(), color.Dim + color.FgBlue);
  }
  return col(role(), color.Dim + color.FgGreen);
}
function ts() {
  if(!doDumpTimestamp) return "";
  var dt = new Date();
  return "[" + dt.getHours().toString().padStart(2, '0') + ":" + dt.getMinutes().toString().padStart(2, '0') + ":" + 
  dt.getSeconds().toString().padStart(2, '0') + "." + dt.getMilliseconds().toString().padStart(3, '0') + "]";
}
function seq(sequence, id, rid) {
  var result = "";
  if(doDumpMesssagesSeq) {
    result += `[${sequence}]`;
  }
  if(doDumpMesssagesIds) {
    result += `[${id}][${rid}]`;
  }
  return result;
}
var _role = "client";
export function role() { return _role; }
export function setrole(newrole) {
  _role = newrole;
}
