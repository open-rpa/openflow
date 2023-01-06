
const { Transform } = require('stream');
export class Throttler extends Transform {
  constructor(delay) {
    super({ objectMode: true });
    this.delay = delay;
  }

  _transform(chunk, encoding, callback) {
    this.push(chunk);
    if(this.delay > 0) { setTimeout(callback, this.delay); }
      else { callback(); }
  }
}
