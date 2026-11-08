// Loaded before server code. Never log URLs, headers, arguments, or credentials.
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';

const literalLookup = dns.lookup.bind(dns);
const literalPromiseLookup = dns.promises.lookup.bind(dns.promises);

function deny(surface) {
  return function () {
    appendFileSync(process.env.QA_NETWORK_AUDIT, `${surface}\n`, { mode: 0o600 });
    throw new Error(`QA_OUTBOUND_BLOCKED:${surface}`);
  };
}
net.Socket.prototype.connect = deny('net');
tls.connect = deny('tls');
for (const module of [http, https]) {
  module.request = deny('http');
  module.get = deny('http');
}
http2.connect = deny('http2');
for (const name of Object.keys(dns)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dns[name] === 'function') dns[name] = deny('dns');
}
for (const name of Object.keys(dns.promises)) {
  if (/^(lookup|resolve|reverse)/.test(name)) dns.promises[name] = deny('dns');
}
// Node's listen(0, '127.0.0.1') calls lookup even for a literal IP; it requires no DNS traffic.
dns.lookup = function (hostname, ...args) {
  if (typeof hostname === 'string' && net.isIP(hostname)) return literalLookup(hostname, ...args);
  return deny('dns')();
};
dns.promises.lookup = function (hostname, ...args) {
  if (typeof hostname === 'string' && net.isIP(hostname)) return literalPromiseLookup(hostname, ...args);
  return deny('dns')();
};
dgram.createSocket = deny('udp');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = deny('subprocess');
}
globalThis.fetch = deny('fetch');
globalThis.WebSocket = deny('websocket');
syncBuiltinESMExports();
