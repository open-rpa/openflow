import { Readable } from "stream";
import { SMTPServerSession, SMTPServer } from "smtp-server";
import { EventEmitter } from "events";

var test = require('@nodemailer/mailparser2');
const simpleParser = test.SimpleParser;

export class libmailserver extends EventEmitter {
    constructor() {
        super();
    }
    onMailFrom(address, session, callback) {
        // session.xForward is a Map structure
        try {
            //config.log(4, 'XFORWARD ADDR=%s', session.xForward.get('ADDR'));
        } catch (err) {
            console.log(err);
        }
        callback();
    }
    onRcptTo(address, session, callback) {
        //console.log(address.address);
        //config.log(4, address.address);
        // if (address.address !== 'allan@zenamic.dk') {
        //     return callback(new Error('Non-existent email address'));
        // }
        return callback(); // Accept the address
    }
    async onData(stream: Readable, session: SMTPServerSession, callback: (err?: Error) => void) {
        //var mail:ParsedMail = await simpleParser(stream);
        var mail = await simpleParser(stream);
        libmailserver.current.emit('email', mail);
        //config.log(4, mail);
        callback();
    }
    onAuth(auth, session, callback) {
        // config.log(4, auth);
        callback(null, { user: 123 }); // where 123 is the user id or similar property
    }
    static current: libmailserver;
    server: SMTPServer;
    static setupSMTP(port: number) {
        return new Promise<libmailserver>(async (resolve, reject) => {
            if (libmailserver.current) {
                console.log('Smtpserver is allready listening on %s', port);
                return resolve(libmailserver.current);
            }

            libmailserver.current = new libmailserver();
            try {
                const SMTPServer = require('smtp-server').SMTPServer;
                libmailserver.current.server = new SMTPServer({
                    secure: false,
                    logger: false,
                    authOptional: true,
                    disableReverseLookup: true,
                    useXClient: true,
                    disabledCommands: ['STARTTLS', 'AUTH'],
                    onMailFrom: libmailserver.current.onMailFrom,
                    onRcptTo: libmailserver.current.onRcptTo,
                    onAuth: libmailserver.current.onAuth,
                    onData: libmailserver.current.onData
                });
                console.log('Smtpserver listening on %s', port);
                await libmailserver.current.server.listen(port);
                resolve(libmailserver.current);
            } catch (err) {
                reject(err);
            }
        });
    }

}    