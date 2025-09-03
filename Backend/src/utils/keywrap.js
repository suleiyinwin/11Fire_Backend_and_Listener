// Wrap/unwrap a 32-byte data key using an app master key with AES-256-GCM.

import crypto from 'crypto';

// Retrieve the master key from environment variable and validate its length
function getMasterKey() {
  // Read base64-encoded master key from environment variable
  const b64 = process.env.DATA_MASTER_KEY_B64 || '';
  // Decode base64 string to Buffer
  const key = Buffer.from(b64, 'base64');
  if (!(key.length === 16 || key.length === 32)) {
    throw new Error('DATA_MASTER_KEY_B64 must be base64 for 16 (AES-128) or 32 (AES-256) bytes');
  }
  return key;
}

// Encrypt (wrap) a 32-byte data key using the master key
export function wrapKey(plainKey) {
  // Validate input: must be a Buffer of length 32
  if (!Buffer.isBuffer(plainKey) || (plainKey.length !== 16 && plainKey.length !== 32)) {
    throw new Error('wrapKey: plainKey must be 16 or 32 bytes');
  }
  const kek = getMasterKey();
  // Generate a random 12-byte IV for AES-GCM
  const iv = crypto.randomBytes(12);
  // Create AES-256-GCM cipher instance
  const cipher = crypto.createCipheriv(kek.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm', kek, iv);
  // Encrypt the plain key
  const ct = Buffer.concat([cipher.update(plainKey), cipher.final()]);
  // Get the authentication tag for integrity
  const tag = cipher.getAuthTag();
  // Return wrapped key object with metadata and base64-encoded values
  return {
    alg: 'aes-gcm@kek-v1', // Algorithm identifier
    version: 1,                // Version
    ivB64: iv.toString('base64'),   // IV in base64
    tagB64: tag.toString('base64'), // Auth tag in base64
    ctB64: ct.toString('base64'),   // Ciphertext in base64
  };
}

// Decrypt (unwrap) a wrapped key object using the master key
export function unwrapKey(wrapped) {
  // Validate input: must be a supported wrapped key format
  if (!wrapped || wrapped.alg !== 'aes-gcm@kek-v1') {
    throw new Error('unwrapKeyWithMaster: unsupported wrapped key format');
  }
  const kek = getMasterKey();
  // Decode IV, tag, and ciphertext from base64
  const iv = Buffer.from(wrapped.ivB64, 'base64');
  const tag = Buffer.from(wrapped.tagB64, 'base64');
  const ct = Buffer.from(wrapped.ctB64, 'base64');

  // Create AES-256-GCM decipher instance
  const decipher = crypto.createDecipheriv(kek.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm', kek, iv);
  // Set the authentication tag for integrity check
  decipher.setAuthTag(tag);
  // Decrypt the ciphertext to recover the original key
  return Buffer.concat([decipher.update(ct), decipher.final()]); // returns 16 or 32-byte key
}
