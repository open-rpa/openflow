export class Util {
    public static IsNullUndefinded(obj: any) {
        if (obj === null || obj === undefined) { return true; }
        return false;
    }
    public static IsNullEmpty(obj: any) {
        if (obj === null || obj === undefined || obj === "") { return true; }
        return false;
    }
    public static IsString(obj: any) {
        if (typeof obj === 'string' || obj instanceof String) { return true; }
        return false;
    }
    public static isObject(obj: any): boolean {
        return obj === Object(obj);
    }
    static isNumeric(num) {
        return !isNaN(num)
    }
    public static FetchFromObject(obj: any, prop: string): any {
        if (typeof obj === 'undefined') {
            return false;
        }
        var _index = prop.indexOf('.')
        if (_index > -1) {
            return Util.FetchFromObject(obj[prop.substring(0, _index)], prop.substr(_index + 1));
        }
        return obj[prop];
    }
    public static saveToObject(obj: any, path: string, value: any): any {
        const pList = path.split('.');
        const key = pList.pop();
        const pointer = pList.reduce((accumulator, currentValue) => {
            if (accumulator[currentValue] === undefined) accumulator[currentValue] = {};
            return accumulator[currentValue];
        }, obj);
        if (Util.isObject(pointer)) {
            pointer[key] = value;
        } else {
            throw new Error(path + ' is not an object!')
        }
        return obj;
    }
}