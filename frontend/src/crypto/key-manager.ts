// KeyManager - Secure key storage and management using IndexedDB

/* Handles:
 * - Storing non-exportable private keys in IndexedDB
 * - Managing peer public keys
 * - Key backup with passphrase encryption (key wrapping)
 * 
 * Security Note: Private keys should be stored as non-exportable CryptoKey
 * objects whenever possible. Export only for encrypted backups.
 */

import Dexie from 'dexie';

import type { KeyPair, ProtectedIdentityCapsule } from './crypto-service';
import type { Table } from 'dexie';

interface StoredKeyPair {
  id: string;
  type: 'encryption' | 'signing';
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: number;
}

interface StoredPeerKey {
  peerId: string;
	encryptionPublicKey?: string | undefined; // Base64 encoded for peers
	signingPublicKey?: string | undefined; // Base64 encoded for peers
	displayName?: string | undefined;
  fingerprint: string;
  addedAt: number;
	lastVerified?: number | undefined;
}

interface StoredIdentityCapsule {
	id: 'identity';
	capsule: ProtectedIdentityCapsule;
	createdAt: number;
	updatedAt: number;
}

class KeyDatabase extends Dexie {
	keyPairs!: Table<StoredKeyPair>;
	peerKeys!: Table<StoredPeerKey>;
	identityCapsules!: Table<StoredIdentityCapsule>;

	constructor() {
		super('PrivateCommunicationKeys');

		this.version(1).stores({
			keyPairs: 'id, type, createdAt',
			peerKeys: 'peerId, addedAt',
			identityCapsules: 'id, createdAt, updatedAt'
		});
	}
}

const db = new KeyDatabase();

// Store user's own key pair securely in IndexedDB
const storeKeyPair = async (
	type: 'encryption' | 'signing',
	keyPair: KeyPair
): Promise<void> => {
	await db.keyPairs.put({
		id: type,
		type,
		publicKey: keyPair.publicKey,
		privateKey: keyPair.privateKey,
		createdAt: Date.now()
	});
}

// Retrieve user's key pair from IndexedDB
const getKeyPair = async (
	type: 'encryption' | 'signing'
): Promise<KeyPair | null> => {
	const stored = await db.keyPairs.get(type);
	if (!stored) return null;
  
	return {
		publicKey: stored.publicKey,
		privateKey: stored.privateKey
	};
}

// Check if user has initialized their keys
const hasKeys = async (): Promise<boolean> => {
	const encryptionKey = await db.keyPairs.get('encryption');
	const signingKey = await db.keyPairs.get('signing');
	return Boolean(encryptionKey && signingKey);
}

const storeIdentityCapsule = async (capsule: ProtectedIdentityCapsule): Promise<void> => {
	await db.identityCapsules.put({
		id: 'identity',
		capsule,
		createdAt: capsule.createdAt,
		updatedAt: Date.now()
	});
}

const getIdentityCapsule = async (): Promise<ProtectedIdentityCapsule | null> => {
	const stored = await db.identityCapsules.get('identity');
	return stored?.capsule ?? null;
}

const clearIdentityCapsule = async (): Promise<void> => {
	await db.identityCapsules.clear();
}

// Store a peer's public key
const storePeerKey = async (
	peerId: string,
	encryptionPublicKey: string,
	signingPublicKey: string,
	fingerprint: string,
	displayName?: string
): Promise<void> => {
	await db.peerKeys.put({
		peerId,
		encryptionPublicKey,
		signingPublicKey,
		fingerprint,
		displayName,
		addedAt: Date.now()
	});
}

// Get a peer's public key
const getPeerKey = async (peerId: string): Promise<StoredPeerKey | null> => {
	const peer = await db.peerKeys.get(peerId);
	if (!peer) return null;

	return peer;
}

// Get all stored peer keys
const getAllPeerKeys = async (): Promise<StoredPeerKey[]> => {
	return db.peerKeys.toArray();
}

// Delete a peer's key
const deletePeerKey = async (peerId: string): Promise<void> => {
	await db.peerKeys.delete(peerId);
}

// Update a peer's display name
const updatePeerDisplayName = async (peerId: string, displayName: string): Promise<void> => {
	await db.peerKeys.update(peerId, { displayName });
}

// Mark a peer's key as verified (after out-of-band fingerprint comparison)
const markPeerKeyVerified = async (peerId: string): Promise<void> => {
	await db.peerKeys.update(peerId, { lastVerified: Date.now() });
}

// Clear all stored keys (use with caution!)
const clearAllKeys = async (): Promise<void> => {
	await db.keyPairs.clear();
	await db.peerKeys.clear();
	await db.identityCapsules.clear();
}

export {
	db,
	storeKeyPair,
	getKeyPair,
	hasKeys,
	storeIdentityCapsule,
	getIdentityCapsule,
	clearIdentityCapsule,
	storePeerKey,
	getPeerKey,
	getAllPeerKeys,
	deletePeerKey,
	updatePeerDisplayName,
	markPeerKeyVerified,
	clearAllKeys
};
export type { StoredPeerKey, StoredIdentityCapsule };
