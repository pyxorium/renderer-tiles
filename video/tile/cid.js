// Content addresses: CIDv1, raw codec, sha-256, base32 ("bafkrei…"): the address a PDS gives a blob, so the video renderer
// can check each piece it is handed against the address its record lists. A copy of muxl-tile's tile/cid.js.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** The raw sha-256 CID for a 32-byte sha-256 digest. */
export function cidFromDigest(digest) {
  const d = digest instanceof Uint8Array ? digest : new Uint8Array(digest);
  if (d.length !== 32) throw new Error('a sha-256 digest is 32 bytes');
  const bytes = new Uint8Array(36);
  bytes.set([0x01, 0x55, 0x12, 0x20]);
  bytes.set(d, 4);
  return 'b' + base32(bytes);
}

export function hex(digest) {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha-256 of some bytes with WebCrypto (browser and Node 20+). */
export async function sha256(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('WebCrypto is not available here');
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}
