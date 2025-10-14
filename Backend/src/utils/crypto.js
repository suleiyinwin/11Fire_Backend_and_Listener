import crypto from "crypto";
import {
  emitFileEncrypted,
  emitFileDecrypted,
  emitFileEncryptionFailed,
  emitFileDecryptionFailed,
} from "./eventSystem.js";

// Envelope = MAGIC(4)="11F1" | VER(1)=0x01 | IV(12) | TAG(16) | CIPHERTEXT(...)
const MAGIC = Buffer.from("11F1", "utf8");
const VERSION = 0x01;

export function encryptEnvelopeGCM(plain, key, fileContext = null) {
  try {
    const startTime = Date.now();
    const iv = crypto.randomBytes(12);
    const algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
    const cipher = crypto.createCipheriv(algo, key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([
      MAGIC,
      Buffer.from([VERSION]),
      iv,
      tag,
      ct,
    ]);
    const encryptionTime = Date.now() - startTime;

    // Emit encryption event if file context is provided
    if (fileContext) {
      emitFileEncrypted(
        fileContext.filename,
        fileContext.fileSize,
        fileContext.username,
        fileContext.userId,
        fileContext.swarmId,
        fileContext.swarmName,
        fileContext.description || `File encrypted using ${algo}`,
        {
          algorithm: algo,
          keySize: key.length * 8,
          ivSize: iv.length,
          originalSize: plain.length,
          encryptedSize: envelope.length,
          encryptionTime: encryptionTime,
          compressionRatio: envelope.length / plain.length,
        }
      );
    }

    return envelope;
  } catch (e) {
    if (fileContext) {
      emitFileEncryptionFailed(
        fileContext.filename,
        fileContext.fileSize,
        fileContext.username,
        fileContext.userId,
        fileContext.swarmId,
        fileContext.swarmName,
        fileContext.description || "File encryption failed",
        e
      );
    }
    throw e;
  }
}

export function decryptEnvelopeGCM(envelope, key, fileContext = null) {
  try {
    const startTime = Date.now();

    // detect our envelope
    if (
      envelope.length >= MAGIC.length + 1 + 12 + 16 &&
      envelope.slice(0, MAGIC.length).equals(MAGIC) &&
      envelope[MAGIC.length] === VERSION
    ) {
      let o = MAGIC.length + 1;
      const iv = envelope.slice(o, o + 12);
      o += 12;
      const tag = envelope.slice(o, o + 16);
      o += 16;
      const ct = envelope.slice(o);
      const algo = key.length === 16 ? "aes-128-gcm" : "aes-256-gcm";
      const dec = crypto.createDecipheriv(algo, key, iv);
      dec.setAuthTag(tag);
      const decrypted = Buffer.concat([dec.update(ct), dec.final()]);
      const decryptionTime = Date.now() - startTime;

      // Emit decryption event if file context is provided
      if (fileContext) {
        emitFileDecrypted(
          fileContext.filename,
          fileContext.fileSize,
          fileContext.username,
          fileContext.userId,
          fileContext.swarmId,
          fileContext.swarmName,
          fileContext.description || `File decrypted using ${algo}`,
          {
            algorithm: algo,
            keySize: key.length * 8,
            encryptedSize: envelope.length,
            decryptedSize: decrypted.length,
            decryptionTime: decryptionTime,
            wasEncrypted: true,
          }
        );
      }

      return decrypted;
    }

    // legacy plaintext (pre-encryption) → return as-is
    if (fileContext) {
      emitFileDecrypted(
        fileContext.filename,
        fileContext.fileSize,
        fileContext.username,
        fileContext.userId,
        fileContext.swarmId,
        fileContext.swarmName,
        "File was not encrypted (legacy plaintext)",
        {
          wasEncrypted: false,
          decryptionTime: 0,
          message: "File was not encrypted (legacy plaintext)",
        }
      );
    }

    return envelope;
  } catch (error) {
    if (fileContext) {
      emitFileDecryptionFailed(
        fileContext.filename,
        fileContext.fileSize,
        fileContext.username,
        fileContext.userId,
        fileContext.swarmId,
        fileContext.swarmName,
        fileContext.description || "File decryption failed",
        error
      );
    }
    throw error;
  }
}
