import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from "crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const PBKDF2_ITERATIONS = 100000
const ENCRYPTION_VERSION = "v1"

/**
 * Derive encryption key from service salt
 */
export function deriveEncryptionKey(identifier: string, serviceSalt: string): Buffer {
  const material = `${identifier}:${serviceSalt}:pbtc-wallet-encryption`

  return pbkdf2Sync(material, serviceSalt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256")
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encryptData(plaintext: string, key: Buffer): string {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext must be a non-empty string")
  }

  if (!key || key.length !== KEY_LENGTH) {
    throw new Error("Encryption key must be 32 bytes")
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])

  const authTag = cipher.getAuthTag()

  return [ENCRYPTION_VERSION, iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":")
}

/**
 * Decrypt data encrypted with encryptData()
 */
export function decryptData(encryptedData: string, key: Buffer): string {
  if (!encryptedData || typeof encryptedData !== "string") {
    throw new Error("Encrypted data must be a non-empty string")
  }

  if (!key || key.length !== KEY_LENGTH) {
    throw new Error("Encryption key must be 32 bytes")
  }

  const parts = encryptedData.split(":")

  if (parts.length !== 4) {
    throw new Error("Invalid encrypted data format")
  }

  const [version, ivB64, authTagB64, encryptedB64] = parts

  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`)
  }

  const iv = Buffer.from(ivB64, "base64")
  const authTag = Buffer.from(authTagB64, "base64")
  const encrypted = Buffer.from(encryptedB64, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString("utf8")
  } catch {
    throw new Error("Decryption failed: data may be corrupted or key is incorrect")
  }
}

/**
 * Decrypt stored private key
 */
export function decryptPrivateKey(encryptedPrivateKey: string, identifier: string, serviceSalt: string): string {
  const key = deriveEncryptionKey(identifier, serviceSalt)
  return decryptData(encryptedPrivateKey, key)
}
