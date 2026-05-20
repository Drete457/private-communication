// CryptoService - End-to-End Encryption using Web Crypto API
  
/* Implements:
 * - ECDH (Elliptic Curve Diffie-Hellman) for key exchange
 * - AES-GCM for symmetric encryption of message content
 * - ECDSA for digital signatures (message integrity)
 * 
 * Security Note: Private keys are stored as non-exportable CryptoKey objects
 * in IndexedDB to prevent extraction.
 */

const ECDH_ALGORITHM: EcKeyGenParams = {
	name: 'ECDH',
	namedCurve: 'P-256'
};

const ECDSA_ALGORITHM: EcKeyGenParams = {
	name: 'ECDSA',
	namedCurve: 'P-256'
};

const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const IDENTITY_PAYLOAD_VERSION = 1;
const IDENTITY_CAPSULE_VERSION = 1;

// Utility functions for encoding/decoding
const arrayBufferToBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

const arrayBufferToHex = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

const concatArrayBuffers = (buffers: ArrayBuffer[]): ArrayBuffer => {
	const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
	const merged = new Uint8Array(totalBytes);
	let offset = 0;

	for (const buffer of buffers) {
		merged.set(new Uint8Array(buffer), offset);
		offset += buffer.byteLength;
	}

	return merged.buffer;
}

interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

interface ExportedKeyPair {
  publicKey: string;  // Base64 encoded
  privateKey: string; // Base64 encoded (only for backup, encrypted)
}

interface IdentityKeyMaterial {
	publicKeySpki: string;
	privateKeyPkcs8: string;
}

interface IdentityPayload {
	version: number;
	createdAt: number;
	identity: {
		userId: string;
		fingerprint: string;
		encryption: IdentityKeyMaterial;
		signing: IdentityKeyMaterial;
	};
}

interface ProtectedIdentityCapsule {
	version: number;
	createdAt: number;
	kdf: {
		type: 'browser-ecdh';
	};
	capsulePublicKeySpki: string;
	iv: string;
	cipherText: string;
}

type IdentityPayloadRecordKey = 'createdAt' | 'encryption' | 'fingerprint' | 'identity' | 'privateKeyPkcs8' | 'publicKeySpki' | 'signing' | 'userId' | 'version';
type IdentityPayloadRecord = Record<string, unknown> & Partial<Record<IdentityPayloadRecordKey, unknown>>;

const isIdentityPayloadRecord = (value: unknown): value is IdentityPayloadRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return false;

	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isNonNegativeSafeInteger = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
};

const assertIdentityPayloadCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition)
		throw new Error(message);
};

const validateIdentityKeyMaterial = (value: unknown, label: string): IdentityKeyMaterial => {
	assertIdentityPayloadCondition(isIdentityPayloadRecord(value), `${label} key material must be an object`);
	assertIdentityPayloadCondition(typeof value.publicKeySpki === 'string', `${label} publicKeySpki must be a string`);
	assertIdentityPayloadCondition(typeof value.privateKeyPkcs8 === 'string', `${label} privateKeyPkcs8 must be a string`);

	return {
		publicKeySpki: value.publicKeySpki,
		privateKeyPkcs8: value.privateKeyPkcs8
	};
};

const validateIdentityPayload = (value: unknown): IdentityPayload => {
	assertIdentityPayloadCondition(isIdentityPayloadRecord(value), 'Identity payload must be an object');
	assertIdentityPayloadCondition(value.version === IDENTITY_PAYLOAD_VERSION, 'Unsupported identity payload version');
	assertIdentityPayloadCondition(isNonNegativeSafeInteger(value.createdAt), 'Identity payload createdAt must be a non-negative safe integer');
	assertIdentityPayloadCondition(isIdentityPayloadRecord(value.identity), 'Identity payload identity must be an object');
	assertIdentityPayloadCondition(typeof value.identity.userId === 'string', 'Identity userId must be a string');
	assertIdentityPayloadCondition(typeof value.identity.fingerprint === 'string', 'Identity fingerprint must be a string');

	return {
		version: IDENTITY_PAYLOAD_VERSION,
		createdAt: value.createdAt,
		identity: {
			userId: value.identity.userId,
			fingerprint: value.identity.fingerprint,
			encryption: validateIdentityKeyMaterial(value.identity.encryption, 'Identity encryption'),
			signing: validateIdentityKeyMaterial(value.identity.signing, 'Identity signing')
		}
	};
};

const generateExportableEncryptionKeyPair = async (): Promise<KeyPair> => {
	const keyPair = await crypto.subtle.generateKey(
		ECDH_ALGORITHM,
		true,
		['deriveKey', 'deriveBits']
	);

	return {
		publicKey: keyPair.publicKey,
		privateKey: keyPair.privateKey
	};
}

const generateExportableSigningKeyPair = async (): Promise<KeyPair> => {
	const keyPair = await crypto.subtle.generateKey(
		ECDSA_ALGORITHM,
		true,
		['sign', 'verify']
	);

	return {
		publicKey: keyPair.publicKey,
		privateKey: keyPair.privateKey
	};
}

// Export a public key to Base64 string for transmission
const exportPublicKey = async (publicKey: CryptoKey): Promise<string> => {
	const exported = await crypto.subtle.exportKey('spki', publicKey);
	return arrayBufferToBase64(exported);
}

const exportPrivateKeyPkcs8 = async (privateKey: CryptoKey): Promise<string> => {
	const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
	return arrayBufferToBase64(exported);
}

// Import a public key from Base64 string
const importPublicKey = async (
	base64Key: string, 
	algorithm: 'ECDH' | 'ECDSA' = 'ECDH'
): Promise<CryptoKey> => {
	const keyBuffer = base64ToArrayBuffer(base64Key);
	const keyAlgorithm = algorithm === 'ECDH' ? ECDH_ALGORITHM : ECDSA_ALGORITHM;
	const usages: KeyUsage[] = algorithm === 'ECDH' ? [] : ['verify'];
  
	return crypto.subtle.importKey(
		'spki',
		keyBuffer,
		keyAlgorithm,
		true,
		usages
	);
}

const importPrivateKeyPkcs8 = async (
	base64Key: string,
	algorithm: 'ECDH' | 'ECDSA' = 'ECDH',
	extractable = false
): Promise<CryptoKey> => {
	const keyBuffer = base64ToArrayBuffer(base64Key);
	const keyAlgorithm = algorithm === 'ECDH' ? ECDH_ALGORITHM : ECDSA_ALGORITHM;
	const usages: KeyUsage[] = algorithm === 'ECDH' ? ['deriveKey', 'deriveBits'] : ['sign'];

	return crypto.subtle.importKey(
		'pkcs8',
		keyBuffer,
		keyAlgorithm,
		extractable,
		usages
	);
}

const importKeyPairFromExported = async (
	exportedKeyPair: ExportedKeyPair,
	algorithm: 'ECDH' | 'ECDSA',
	extractable = false
): Promise<KeyPair> => {
	const [publicKey, privateKey] = await Promise.all([
		importPublicKey(exportedKeyPair.publicKey, algorithm),
		importPrivateKeyPkcs8(exportedKeyPair.privateKey, algorithm, extractable)
	]);

	return {
		publicKey,
		privateKey
	};
}

// Derive a shared AES-GCM key from ECDH key exchange
const deriveSharedKey = async (
	privateKey: CryptoKey,
	peerPublicKey: CryptoKey
): Promise<CryptoKey> => {
	return crypto.subtle.deriveKey(
		{
			name: 'ECDH',
			public: peerPublicKey
		},
		privateKey,
		{
			name: AES_ALGORITHM,
			length: AES_KEY_LENGTH
		},
		false,
		['encrypt', 'decrypt']
	);
}

const generateSymmetricKey = async (): Promise<CryptoKey> => {
	return crypto.subtle.generateKey(
		{
			name: AES_ALGORITHM,
			length: AES_KEY_LENGTH
		},
		true,
		['encrypt', 'decrypt']
	);
}

const exportSymmetricKey = async (key: CryptoKey): Promise<string> => {
	const exported = await crypto.subtle.exportKey('raw', key);
	return arrayBufferToBase64(exported);
}

const importSymmetricKey = async (base64Key: string): Promise<CryptoKey> => {
	return crypto.subtle.importKey(
		'raw',
		base64ToArrayBuffer(base64Key),
		{
			name: AES_ALGORITHM,
			length: AES_KEY_LENGTH
		},
		false,
		['encrypt', 'decrypt']
	);
}

const createIdentityPayload = async (
	encryptionKeyPair: KeyPair,
	signingKeyPair: KeyPair
): Promise<IdentityPayload> => {
	const [
		encryptionPublicKey,
		encryptionPrivateKey,
		signingPublicKey,
		signingPrivateKey,
		userId,
		fingerprint
	] = await Promise.all([
		exportPublicKey(encryptionKeyPair.publicKey),
		exportPrivateKeyPkcs8(encryptionKeyPair.privateKey),
		exportPublicKey(signingKeyPair.publicKey),
		exportPrivateKeyPkcs8(signingKeyPair.privateKey),
		hashPublicKey(encryptionKeyPair.publicKey),
		generateFingerprint(encryptionKeyPair.publicKey)
	]);

	return {
		version: IDENTITY_PAYLOAD_VERSION,
		createdAt: Date.now(),
		identity: {
			userId,
			fingerprint,
			encryption: {
				publicKeySpki: encryptionPublicKey,
				privateKeyPkcs8: encryptionPrivateKey
			},
			signing: {
				publicKeySpki: signingPublicKey,
				privateKeyPkcs8: signingPrivateKey
			}
		}
	};
}

const createIdentityCapsule = async (
	identityPayload: IdentityPayload,
	identityEncryptionPublicKey: CryptoKey
): Promise<ProtectedIdentityCapsule> => {
	const capsulePair = await crypto.subtle.generateKey(
		ECDH_ALGORITHM,
		true,
		['deriveKey', 'deriveBits']
	);
	const wrappingKey = await deriveSharedKey(capsulePair.privateKey, identityEncryptionPublicKey);
	const payloadBytes = new TextEncoder().encode(JSON.stringify(identityPayload));
	const { iv, cipherBytes } = await encryptBytes(payloadBytes.buffer, wrappingKey);
	const capsulePublicKeySpki = await exportPublicKey(capsulePair.publicKey);

	return {
		version: IDENTITY_CAPSULE_VERSION,
		createdAt: Date.now(),
		kdf: {
			type: 'browser-ecdh'
		},
		capsulePublicKeySpki,
		iv,
		cipherText: arrayBufferToBase64(cipherBytes)
	};
}

const unlockIdentityCapsule = async (
	capsule: ProtectedIdentityCapsule,
	identityEncryptionPrivateKey: CryptoKey
): Promise<IdentityPayload> => {
	const capsulePublicKey = await importPublicKey(capsule.capsulePublicKeySpki, 'ECDH');
	const wrappingKey = await deriveSharedKey(identityEncryptionPrivateKey, capsulePublicKey);
	const decrypted = await decryptBytes(
		capsule.iv,
		base64ToArrayBuffer(capsule.cipherText),
		wrappingKey
	);
	const parsedPayload: unknown = JSON.parse(new TextDecoder().decode(decrypted));
	const identityPayload = validateIdentityPayload(parsedPayload);

	return identityPayload;
}

/**
 * Encrypt a message using AES-GCM
 * Returns the IV and ciphertext as Base64 strings
 */
const encryptMessage = async (
	plaintext: string,
	sharedKey: CryptoKey
): Promise<{ iv: string; cipherText: string }> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(plaintext);
  
	// Generate random IV for each message (critical for security)
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
	const cipherText = await crypto.subtle.encrypt(
		{
			name: AES_ALGORITHM,
			iv
		},
		sharedKey,
		data
	);
  
	return {
		iv: arrayBufferToBase64(iv),
		cipherText: arrayBufferToBase64(cipherText)
	};
}

// Decrypt a message using AES-GCM
const decryptMessage = async (
	iv: string,
	cipherText: string,
	sharedKey: CryptoKey
): Promise<string> => {
	const ivBuffer = base64ToArrayBuffer(iv);
	const cipherBuffer = base64ToArrayBuffer(cipherText);
  
	const decrypted = await crypto.subtle.decrypt(
		{
			name: AES_ALGORITHM,
			iv: ivBuffer
		},
		sharedKey,
		cipherBuffer
	);
  
	const decoder = new TextDecoder();
	return decoder.decode(decrypted);
}

const encryptBytes = async (
	plaintext: ArrayBuffer,
	key: CryptoKey
): Promise<{ iv: string; cipherBytes: ArrayBuffer }> => {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const cipherBytes = await crypto.subtle.encrypt(
		{
			name: AES_ALGORITHM,
			iv
		},
		key,
		plaintext
	);

	return {
		iv: arrayBufferToBase64(iv),
		cipherBytes
	};
}

const encryptBytesWithIv = async (
	plaintext: ArrayBuffer,
	ivBase64: string,
	key: CryptoKey
): Promise<ArrayBuffer> => {
	const iv = base64ToArrayBuffer(ivBase64);
	const cipherBytes = await crypto.subtle.encrypt(
		{
			name: AES_ALGORITHM,
			iv
		},
		key,
		plaintext
	);

	return cipherBytes;
}

const decryptBytes = async (
	iv: string,
	cipherBytes: ArrayBuffer,
	key: CryptoKey
): Promise<ArrayBuffer> => {
	return crypto.subtle.decrypt(
		{
			name: AES_ALGORITHM,
			iv: base64ToArrayBuffer(iv)
		},
		key,
		cipherBytes
	);
}

const hashBytes = async (data: ArrayBuffer): Promise<string> => {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return arrayBufferToHex(hashBuffer);
}

// Sign data using ECDSA
const signData = async (
	data: string,
	privateKey: CryptoKey
): Promise<string> => {
	const encoder = new TextEncoder();
	const dataBuffer = encoder.encode(data);
  
	const signature = await crypto.subtle.sign(
		{
			name: 'ECDSA',
			hash: 'SHA-256'
		},
		privateKey,
		dataBuffer
	);
  
	return arrayBufferToBase64(signature);
}

// Verify a signature using ECDSA
const verifySignature = async (
	data: string,
	signature: string,
	publicKey: CryptoKey
): Promise<boolean> => {
	const encoder = new TextEncoder();
	const dataBuffer = encoder.encode(data);
	const signatureBuffer = base64ToArrayBuffer(signature);
  
	return crypto.subtle.verify(
		{
			name: 'ECDSA',
			hash: 'SHA-256'
		},
		publicKey,
		signatureBuffer,
		dataBuffer
	);
}

// Generate a SHA-256 hash of a public key to create UserId
const hashPublicKey = async (publicKey: CryptoKey): Promise<string> => {
	const exported = await crypto.subtle.exportKey('spki', publicKey);
	const hashBuffer = await crypto.subtle.digest('SHA-256', exported);
	return arrayBufferToHex(hashBuffer);
}

// Generate a human-readable fingerprint for key verification
const generateFingerprint = async (publicKey: CryptoKey): Promise<string> => {
	const hash = await hashPublicKey(publicKey);
	// Format as groups of 4 characters for readability
	return hash.match(/.{1,4}/g)?.join(' ').toUpperCase() ?? hash;
}

export {
	generateExportableEncryptionKeyPair,
	generateExportableSigningKeyPair,
	exportPublicKey,
	exportPrivateKeyPkcs8,
	importPublicKey,
	importPrivateKeyPkcs8,
	importKeyPairFromExported,
	deriveSharedKey,
	generateSymmetricKey,
	exportSymmetricKey,
	importSymmetricKey,
	createIdentityPayload,
	validateIdentityPayload,
	createIdentityCapsule,
	unlockIdentityCapsule,
	encryptMessage,
	decryptMessage,
	encryptBytes,
	encryptBytesWithIv,
	decryptBytes,
	signData,
	verifySignature,
	hashBytes,
	concatArrayBuffers,
	hashPublicKey,
	generateFingerprint,
	arrayBufferToBase64,
	base64ToArrayBuffer
};
export type {
	KeyPair,
	ExportedKeyPair,
	IdentityKeyMaterial,
	IdentityPayload,
	ProtectedIdentityCapsule
};