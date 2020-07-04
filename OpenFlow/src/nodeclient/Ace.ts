import { Binary } from "bson";
const ace_right_bits: number = 1000;

export class Ace {
    constructor() {
        var arr:Uint8Array = new Uint8Array(ace_right_bits/8);
        this.rights = new Binary(Buffer.from(arr), 0);
        this.deny = false;
    }
    static assign(a:Ace): Ace {
        var result: Ace = Object.assign(new Ace(), a);
        if(typeof result.rights === "string") {
            result.rights = new Binary(Buffer.from(result.rights, "base64"), 0);
        }
        return result;
    }
    public _id:string;
    public name:string;
    public deny: boolean = false;
    public rights: Binary;
    reset():void {
        var arr: Uint8Array = new Uint8Array(ace_right_bits/8);
        this.rights = new Binary(Buffer.from(arr), 0);
    }
    getview():Uint8Array {
        var buf:Buffer = this.rights.read(0, this.rights.length());
        return new Uint8Array(buf);
    }
    getMask(bit:number):number {
        return Math.pow(2, bit);
    }
    setBit(bit:number):void {
        bit--;
        var buf:Buffer = this.rights.read(0, this.rights.length());
        var view:Uint8Array = new Uint8Array(buf);
        if(bit===-2) {
            for(var i:number=0; i<view.length; i++) {
                view[i] = 255;
            }
        } else {
            var octet: number = Math.floor(bit / 8);
            var currentValue: number = view[octet];
            var _bit: number = (bit % 8);
            var mask: number = this.getMask(_bit);
// tslint:disable-next-line: no-bitwise
            var newValue: number = currentValue | mask;
            view[octet] = newValue;
        }
        this.rights = new Binary(Buffer.from(view), 0);
    }
    unsetBit(bit:number): void {
        bit--;
        var buf:Buffer = this.rights.read(0, this.rights.length());
        var view: Uint8Array = new Uint8Array(buf);

        var octet: number = Math.floor(bit / 8);
        var currentValue: number = view[octet];
        var _bit: number = (bit % 8);
        var mask: number = this.getMask(_bit);
// tslint:disable-next-line: no-bitwise
        var newValue: number = currentValue &= ~mask;
        view[octet] = newValue;
        this.rights = new Binary(Buffer.from(view), 0);
    }
    getBit(bit:number): boolean {
        bit--;
        var buf:Buffer = this.rights.read(0, this.rights.length());
        var view:Uint8Array = new Uint8Array(buf);

        var octet: number = Math.floor(bit / 8);
        var currentValue: number = view[octet];
        var _bit: number = (bit % 8);
        var bitValue: number = Math.pow(2, _bit);
// tslint:disable-next-line: no-bitwise
        return (currentValue & bitValue) !== 0;
    }
}