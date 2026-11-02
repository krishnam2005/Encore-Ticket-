// Local-only workaround for networks with no usable IPv6 route: Node's default dual-stack
// lookup of the Neon host fails there (ENOTFOUND). Forces IPv4 resolution.
// Usage (PowerShell):  $env:NODE_OPTIONS = "--require ./scripts/ipv4-dns.cjs"
const dns = require("node:dns");
const original = dns.lookup;

dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (typeof options === "number") {
    options = { family: options };
  }
  return original.call(dns, hostname, { ...options, family: 4 }, callback);
};
