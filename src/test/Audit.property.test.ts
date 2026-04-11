import { suite, test } from "@testdeck/mocha";
import * as fc from "fast-check";
import { Audit } from "../Audit.js";
import { Config } from "../Config.js";

const arbOctet = fc.integer({ min: 0, max: 255 });
const arbIp = fc.tuple(arbOctet, arbOctet, arbOctet, arbOctet)
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

@suite class ip_conversion_property_tests {
    @test "dot2num then num2dot roundtrips any valid IPv4"() {
        fc.assert(fc.property(arbIp, (ip) => {
            const num = Audit.dot2num(ip);
            const back = Audit.num2dot(num);
            return back === ip;
        }));
    }

    @test "dot2num produces unique number for each IP"() {
        fc.assert(fc.property(arbIp, arbIp, (ip1, ip2) => {
            fc.pre(ip1 !== ip2);
            return Audit.dot2num(ip1) !== Audit.dot2num(ip2);
        }));
    }

    @test "dot2num result is in valid 32-bit range"() {
        fc.assert(fc.property(arbIp, (ip) => {
            const num = Audit.dot2num(ip);
            return num >= 0 && num <= 4294967295; // 0.0.0.0 to 255.255.255.255
        }));
    }

    @test "dot2num returns 0 for null, undefined, empty"() {
        fc.assert(fc.property(
            fc.constantFrom(null, undefined, ""),
            (v) => Audit.dot2num(v) === 0
        ));
    }

    @test "dot2num returns 0 for strings without dots"() {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }).filter(s => !s.includes(".")),
            (s) => Audit.dot2num(s) === 0
        ));
    }

    @test "num2dot returns empty for 0 and negative"() {
        fc.assert(fc.property(
            fc.integer({ min: -1000, max: 0 }),
            (n) => Audit.num2dot(n) === ""
        ));
    }

    @test "known IPs convert correctly"() {
        // 127.0.0.1 = 2130706433, 192.168.1.1 = 3232235777, 10.0.0.1 = 167772161
        fc.assert(fc.property(
            fc.constantFrom(
                { ip: "127.0.0.1", num: 2130706433 },
                { ip: "192.168.1.1", num: 3232235777 },
                { ip: "10.0.0.1", num: 167772161 },
                { ip: "0.0.0.1", num: 1 },
                { ip: "255.255.255.255", num: 4294967295 },
            ),
            ({ ip, num }) => Audit.dot2num(ip) === num && Audit.num2dot(num) === ip
        ));
    }
}

@suite class url_property_tests {
    @test "baseurl always ends with /"() {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.[a-z]{2,6}$/),
            fc.constantFrom(80, 443, 3000, 8080, 9090, 12345),
            fc.constantFrom("http", "https"),
            (domain, port, protocol) => {
                // Save and restore
                const origDomain = Config.domain;
                const origPort = Config.port;
                const origProtocol = Config.protocol;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.domain = domain;
                    Config.port = port;
                    Config.protocol = protocol;
                    Config.tls_crt = "";
                    Config.tls_key = "";
                    const url = Config.baseurl();
                    return url.endsWith("/");
                } finally {
                    Config.domain = origDomain;
                    Config.port = origPort;
                    Config.protocol = origProtocol;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "baseurl contains the domain"() {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.[a-z]{2,6}$/),
            (domain) => {
                const orig = Config.domain;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.domain = domain;
                    Config.tls_crt = "";
                    Config.tls_key = "";
                    return Config.baseurl().includes(domain);
                } finally {
                    Config.domain = orig;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "basewsurl uses ws:// when protocol is http (no TLS)"() {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.[a-z]{2,6}$/),
            (domain) => {
                const origDomain = Config.domain;
                const origProtocol = Config.protocol;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.domain = domain;
                    Config.protocol = "http";
                    Config.tls_crt = "";
                    Config.tls_key = "";
                    return Config.basewsurl().startsWith("ws://");
                } finally {
                    Config.domain = origDomain;
                    Config.protocol = origProtocol;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "basewsurl uses wss:// when TLS is configured"() {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.[a-z]{2,6}$/),
            (domain) => {
                const origDomain = Config.domain;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.domain = domain;
                    Config.tls_crt = "somecert";
                    Config.tls_key = "somekey";
                    return Config.basewsurl().startsWith("wss://");
                } finally {
                    Config.domain = origDomain;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "non-standard ports appear in both baseurl and basewsurl"() {
        fc.assert(fc.property(
            fc.integer({ min: 1024, max: 65535 }).filter(p => p !== 3000),
            (port) => {
                const origPort = Config.port;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.port = port;
                    Config.tls_crt = "";
                    Config.tls_key = "";
                    const url = Config.baseurl();
                    const wsurl = Config.basewsurl();
                    return url.includes(":" + port) && wsurl.includes(":" + port);
                } finally {
                    Config.port = origPort;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "standard ports (80, 443, 3000) are omitted from URLs"() {
        fc.assert(fc.property(
            fc.constantFrom(80, 443, 3000),
            (port) => {
                const origPort = Config.port;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.port = port;
                    Config.tls_crt = "";
                    Config.tls_key = "";
                    const url = Config.baseurl();
                    return !url.includes(":" + port);
                } finally {
                    Config.port = origPort;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }

    @test "baseurl and basewsurl protocol consistency"() {
        fc.assert(fc.property(
            fc.stringMatching(/^[a-z][a-z0-9-]{2,20}\.[a-z]{2,6}$/),
            (domain) => {
                const origDomain = Config.domain;
                const origProtocol = Config.protocol;
                const origTlsCrt = Config.tls_crt;
                const origTlsKey = Config.tls_key;
                try {
                    Config.domain = domain;
                    Config.tls_crt = "";
                    Config.tls_key = "";

                    Config.protocol = "http";
                    const httpUrl = Config.baseurl();
                    const wsUrl = Config.basewsurl();
                    const httpConsistent = httpUrl.startsWith("http://") && wsUrl.startsWith("ws://");

                    Config.protocol = "https";
                    const httpsUrl = Config.baseurl();
                    const wssUrl = Config.basewsurl();
                    const httpsConsistent = httpsUrl.startsWith("https://") && wssUrl.startsWith("wss://");

                    return httpConsistent && httpsConsistent;
                } finally {
                    Config.domain = origDomain;
                    Config.protocol = origProtocol;
                    Config.tls_crt = origTlsCrt;
                    Config.tls_key = origTlsKey;
                }
            }
        ));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Audit.property.test.ts"
