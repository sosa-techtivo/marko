/**
 * SSRF guard for the SEO crawler. Server-side fetches target URLs the client
 * registered themselves, so every fetch (and every redirect hop) must be
 * validated against this before connecting: only http/https, no localhost
 * hostnames, and no private/loopback/link-local/multicast/reserved IP
 * destinations (checked by resolving the hostname first).
 *
 * Residual limitation: there is a narrow theoretical DNS-rebinding race
 * between the `dns.lookup` validation here and `fetch`'s own internal
 * resolution (the hostname could re-resolve to a different address between
 * the two). Not fully closed — `node:undici` (which would allow pinning the
 * resolved IP at the connection level) isn't available as a built-in module
 * on this Node version, so closing it fully would require a new dependency,
 * which is out of scope here.
 */
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export type SafeToFetchResult = { ok: true } | { ok: false; reason: string };

const blockList = new BlockList();

// IPv4 special-purpose ranges (IANA).
const IPV4_BLOCKED_SUBNETS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32], // limited broadcast
];

// IPv6 special-purpose ranges (IANA).
const IPV6_BLOCKED_SUBNETS: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["2001:db8::", 32], // documentation
  ["ff00::", 8], // multicast
];

for (const [address, prefix] of IPV4_BLOCKED_SUBNETS) {
  blockList.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of IPV6_BLOCKED_SUBNETS) {
  blockList.addSubnet(address, prefix, "ipv6");
}

function isPublicIpAddress(address: string, family: 4 | 6): boolean {
  return !blockList.check(address, family === 4 ? "ipv4" : "ipv6");
}

function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower === "localhost" || lower.endsWith(".localhost");
}

export async function assertSafeToFetch(url: URL): Promise<SafeToFetchResult> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Protocol "${url.protocol}" is not allowed.` };
  }

  // URL.hostname wraps IPv6 literals in brackets, e.g. "[::1]".
  const rawHostname = url.hostname;
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;

  if (isLocalhostHostname(hostname)) {
    return { ok: false, reason: "Requests to localhost are not allowed." };
  }

  const ipFamily = isIP(hostname);
  if (ipFamily === 4 || ipFamily === 6) {
    if (!isPublicIpAddress(hostname, ipFamily)) {
      return { ok: false, reason: `"${hostname}" is a private/reserved IP address.` };
    }
    return { ok: true };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dnsLookup(hostname, { all: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DNS error";
    return { ok: false, reason: `Could not resolve "${hostname}" (${message}).` };
  }

  if (resolved.length === 0) {
    return { ok: false, reason: `"${hostname}" did not resolve to any address.` };
  }

  for (const { address, family } of resolved) {
    if (family !== 4 && family !== 6) continue;
    if (!isPublicIpAddress(address, family)) {
      return {
        ok: false,
        reason: `"${hostname}" resolves to a private/reserved IP address (${address}).`,
      };
    }
  }

  return { ok: true };
}
