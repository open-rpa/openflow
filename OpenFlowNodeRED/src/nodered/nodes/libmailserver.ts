import { Readable } from "stream";
import { SMTPServerSession, SMTPServer } from "smtp-server";
import { EventEmitter } from "events";
import { Logger } from "../../Logger";

const test = require('@nodemailer/mailparser2');
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
            Logger.instanse.error("libmailserver", "onMailFrom", err);
        }
        callback();
    }
    onRcptTo(address, session, callback) {
        return callback(); // Accept the address
    }
    async onData(stream: Readable, session: SMTPServerSession, callback: (err?: Error) => void) {
        const mail = await simpleParser(stream);
        libmailserver.current.emit('email', mail);
        callback();
    }
    onAuth(auth, session, callback) {
        callback(null, { user: 123 }); // where 123 is the user id or similar property
    }
    static current: libmailserver;
    server: SMTPServer;
    static setupSMTP(port: number) {
        return new Promise<libmailserver>(async (resolve, reject) => {
            if (libmailserver.current) {
                Logger.instanse.debug("libmailserver", "setupSMTP", 'Smtpserver is allready listening on ' + port);
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
                Logger.instanse.info("libmailserver", "setupSMTP", 'Smtpserver listening on ' + port);
                await libmailserver.current.server.listen(port);
                resolve(libmailserver.current);
            } catch (err) {
                reject(err);
            }
        });
    }

}    