/**
 * Cryptographic utilities for server-side operations
 * 
 * Note: The server only verifies signatures and generates challenges.
 * It NEVER has access to private keys or decrypted message content.
 */

import { createHash, randomBytes, createVerify } from 'crypto';

/**
 * Generate a cryptographically secure random nonce for authentication
 */
export const generateNonce = (): string => {
  return randomBytes(32).toString('hex');
}

/**
 * Hash a public key to create a user ID
 */
export const hashPublicKey = (publicKey: string): string => {
  return createHash('sha256').update(publicKey).digest('hex');
}

/**
 * Hash a base64-encoded SPKI public key to create a user ID
 * (Matches the frontend hashPublicKey behavior)
 */
export const hashPublicKeySpki = (base64Key: string): string => {
  try {
    const buffer = Buffer.from(base64Key, 'base64');
    return createHash('sha256').update(buffer).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Verify an ECDSA signature
 * Used for authentication challenge-response
 */
export const verifySignature = (
  data: string,
  signature: string,
  publicKeyPem: string
): boolean => {
  try {
    const signatureBuffer = Buffer.from(signature, 'base64');

    const verifyP1363 = createVerify('SHA256');
    verifyP1363.update(data);
    verifyP1363.end();
    if (verifyP1363.verify({ key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, signatureBuffer)) {
      return true;
    }

    const verifyDer = createVerify('SHA256');
    verifyDer.update(data);
    verifyDer.end();
    return verifyDer.verify(publicKeyPem, signatureBuffer);
  } catch (_error) {
    return false;
  }
}

/**
 * Convert a base64-encoded SPKI public key to PEM format
 */
export const spkiToPem = (base64Key: string): string => {
  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  
  // Split key into 64-character lines
  const keyLines = base64Key.match(/.{1,64}/g) ?? [];
  
  return `${pemHeader}\n${keyLines.join('\n')}\n${pemFooter}`;
}
