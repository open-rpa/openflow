// import * as  config from "./config";
// const { err, warn, info, dumpdata } = config;
// import { Transform } from "stream";
// import * as  crypto from "crypto";
// function getChecksum(buffer) {
//   const hash = crypto.createHash("sha256");
//   hash.update(buffer);
//   const checksum = hash.digest("hex");
//   return checksum;
// }

// export class messageParser extends Transform {
//   Envelope;
//   seq;
//   buffer;
//   readPointer;
//   basebufferSize;
//   bufferSize;
//   bufferIncrement;
//   writePointer;
//   maxWritePointer;
//   lastDecreased;
//   DecreaseTimeCheck;
//   messages;
//   maxMessagesQueue;
//   constructor() {
//     super({ objectMode: true });
//     // this.bufferSize = 1024 * 128;
//     this.DecreaseTimeCheck = 60;
//     this.basebufferSize = 5 * 1024 * 1024;
//     this.bufferSize = this.basebufferSize;
//     this.buffer = Buffer.alloc(this.bufferSize);
//     this.maxMessagesQueue = 100;
//     // this.bufferIncrement = 1024 * 128;
//     this.bufferIncrement = 10 * 1024 * 1024;
//     this.seq = 0;
//     this.readPointer = 0; // read pointer to keep track of data added
//     this.writePointer = 0; // write pointer to keep track of data processed
//     this.maxWritePointer = 0;
//     this.lastDecreased = new Date();
//     this.messages = [];
//   }
//   _transform(buffer, encoding, callback) {
//     try {
//       let newsize = this.calculateMaxBufferSize();
//       // let newsize = this.writePointer + buffer.length;
//       if(this.writePointer + buffer.length > newsize) {
//         newsize = newsize + this.bufferIncrement;
//       }
//       if(newsize != this.buffer.length) {
//         let dir = "increased";
//         if(newsize < this.buffer.length) dir = "decreased";
//         this.bufferSize = newsize;
//         const newbuff = Buffer.alloc(this.bufferSize);
//         this.buffer.copy(newbuff);
//         this.buffer = newbuff;
//         // show warning as either byte, kilobyte or megabyte
//         if(this.bufferSize > 1024 * 1024)
//           warn("Buffer size " + dir + " to " + (this.bufferSize / 1024 / 1024).toFixed(2) + " MB");
//         else if(this.bufferSize > 1024)
//           warn("Buffer size " + dir + " to " + (this.bufferSize / 1024).toFixed(2) + " KB");
//         else
//           warn("Buffer size " + dir + " to " + this.bufferSize + " bytes");
//       }
//       // this.buffer.copy(buffer, this.bufferIndex);
//       buffer.copy(this.buffer, this.writePointer);
//       this.writePointer += buffer.length;
//       if(this.writePointer > this.maxWritePointer) {
//         this.maxWritePointer = this.writePointer;
//       }
//       do {
//         var datalen = this.writePointer - this.readPointer;
//         if (datalen < 4) {
//           break;
//         }
//         const size = (this.buffer[this.readPointer + 3] << 24) + (this.buffer[this.readPointer + 2] << 16) + (this.buffer[this.readPointer + 1] << 8) + this.buffer[this.readPointer];
//         if (datalen < size + 4) {
//           break;
//         }
//         if(size == 0) {
//           warn("Received empty message !!!! removing 4 from buffer");
//           this.writePointer -= 4;
//           continue;
//         } if(size < 0) {
//           return callback(new Error("Invalid size " + size));
//         }
//         // Decode the message 
//         const start = this.readPointer + 4;
//         const end = start + size;
//         const messagebuffer = Buffer.allocUnsafe(size);
//         this.buffer.copy(messagebuffer, 0, start, end);

//         const message = this.Envelope.decode(messagebuffer);
//         // buffer = buffer.subarray(size + 4);

//         this.readPointer += size + 4;
//         if(this.readPointer  == this.writePointer) {
//           this.readPointer = 0;
//           this.writePointer = 0;
//         }
//         // var s = (size + 4);
//         // this.writePointer -= s;
//         // this.buffer.copy(this.buffer, 0, size + 4);
        
//         if (config.role() == "client") {
//           dumpdata(messagebuffer);
//         }
//         // if (config.ChecksumCheckPackages) {
//         //   const hash = (message.hash == '' ? '' : getChecksum(message.data));
//         //   if (hash != message.hash) {
//         //     return callback(new Error("Checksum mismatch got " + message.hash + " but expected " + hash));
//         //   }
//         // }
//         if(this.seq > message.seq) {
//           return callback(new Error("sequence " + message.seq + " is lower than last received sequence number " + (this.seq -1)));
//         }
//         this.messages.push(message);
//         // this.push(message);
//       } while (true);
//       this.messages.sort((a: any, b: any) => a.seq - b.seq);
//       while(this.messages.length > 0 && this.messages[0].seq == this.seq) {
//         const message = this.messages.shift();
//         this.push(message);
//         this.seq++;
//     }
//     if(this.messages.length > this.maxMessagesQueue) {
//       return callback(new Error("Too many messages in queue " + this.messages.length));
//     }
//     return callback();
//     } catch (error) {
//       return callback(error);
//     }
//   }
//   calculateMaxBufferSize() {
//     const now = new Date();
//     // @ts-ignore
//     const diff = now - this.lastDecreased;
//     let result = this.buffer.length;
//     if(diff > (this.DecreaseTimeCheck * 1000)) {
//       this.lastDecreased = now;
//       if(this.maxWritePointer > 0) {
//         result = this.maxWritePointer;
//         result -= this.bufferIncrement;
//         if(result < this.basebufferSize) result = this.basebufferSize;
//         this.maxWritePointer = 0;
//       }
//     }
//     return result;
//   }  
//   _flush(callback) {
//     callback();
//   }
// }
