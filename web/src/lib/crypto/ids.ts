export const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_BYTES = 16;

/** Big-endian bits → lowercase Crockford base32, zero-padding the last group. */
export function encodeBase32(b: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const x of b) {
    acc = (acc << 8) | x;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

/** 16 random bytes → 26 chars (spec §2). */
export const newId = (): string => encodeBase32(crypto.getRandomValues(new Uint8Array(ID_BYTES)));

/** RFC 3339 UTC, seconds, trailing Z (spec §2). */
export const formatTime = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
