import * as pm2 from "pm2";
export async function pm2connect() {
    return new Promise<void>((resolve, reject) => {
        pm2.connect((err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}
export function pm2disconnect() {
    pm2.disconnect();
}
export async function pm2list() {
    return new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
        pm2.list((err, list) => {
            if (err) return reject(err);
            resolve(list);
        });
    });
}
export async function pm2stop(name: string) {
    return new Promise<pm2.Proc>((resolve, reject) => {
        pm2.stop(name, (err, proc) => {
            if (err) return reject(err);
            resolve(proc);
        });
    });
}
export async function pm2restart(name: string) {
    return new Promise<pm2.Proc>((resolve, reject) => {
        pm2.restart(name, (err, proc) => {
            if (err) return reject(err);
            resolve(proc);
        });
    });
}
export async function pm2delete(name: string) {
    return new Promise<pm2.Proc>((resolve, reject) => {
        pm2.delete(name, (err, proc) => {
            if (err) return reject(err);
            resolve(proc);
        });
    });
}
export async function pm2start(options: pm2.StartOptions) {
    return new Promise<pm2.Proc>((resolve, reject) => {
        pm2.start(options, (err, proc) => {
            if (err) return reject(err);
            resolve(proc);
        });
    });
}
export type Platform = 'ubuntu' | 'centos' | 'redhat' | 'gentoo' | 'systemd' | 'darwin' | 'amazon';
export async function pm2startup(platform: Platform) {
    return new Promise<pm2.Proc>((resolve, reject) => {
        pm2.startup(platform, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

export async function pm2dump() {
    return new Promise<pm2.Proc>((resolve, reject) => {
        (pm2 as any).dump(true, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

export async function pm2exists(name: string) {
    return new Promise<boolean>(async (resolve, reject) => {
        try {
            var instances = await pm2list();
            if (instances.filter(x => x.name == name).length > 0) {
                resolve(true);
            } else {
                resolve(false);
            }
        } catch (error) {
            reject(error);
        }
    });
}
