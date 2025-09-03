import crypto from 'crypto';

// Envelope = MAGIC(4)="11F1" | VER(1)=0x01 | IV(12) | TAG(16) | CIPHERTEXT(...)
const MAGIC = Buffer.from('11F1', 'utf8');
const VERSION = 0x01;

export function encryptEnvelopeGCM(plain, key) {
  const iv = crypto.randomBytes(12);
  const algo = key.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm';
  const cipher = crypto.createCipheriv(algo, key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ct]);
}

export function decryptEnvelopeGCM(envelope, key) {
  // detect our envelope
  if (
    envelope.length >= MAGIC.length + 1 + 12 + 16 &&
    envelope.slice(0, MAGIC.length).equals(MAGIC) &&
    envelope[MAGIC.length] === VERSION
  ) {
    let o = MAGIC.length + 1;
    const iv = envelope.slice(o, o + 12); o += 12;
    const tag = envelope.slice(o, o + 16); o += 16;
    const ct = envelope.slice(o);
    const algo = key.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm';
    const dec = crypto.createDecipheriv(algo, key, iv);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]);
  }
  // legacy plaintext (pre-encryption) → return as-is
  return envelope;
}
