import {
	createIdentityCapsule,
	createIdentityPayload,
	exportPublicKey,
	generateFingerprint,
	generateExportableEncryptionKeyPair,
	generateExportableSigningKeyPair,
	hashPublicKey,
	importKeyPairFromExported
	
	
	
	
} from '@/crypto';
import type {ExportedKeyPair, IdentityPayload, KeyPair, ProtectedIdentityCapsule} from '@/crypto';
import {
	db as keyDatabase
	
} from '@/crypto/key-manager';
import type {StoredPeerKey} from '@/crypto/key-manager';

type IdentityProvisionResult = {
	runtimeEncryptionKeyPair: KeyPair;
	runtimeSigningKeyPair: KeyPair;
	identityPayload: IdentityPayload;
	userId: string;
	fingerprint: string;
	encryptionPublicKey: string;
	signingPublicKey: string;
};

type PersistedIdentityProvision = IdentityProvisionResult & {
	capsule: ProtectedIdentityCapsule;
};

const toExportedKeyPair = (keyMaterial: IdentityPayload['identity']['encryption']): ExportedKeyPair => ({
	publicKey: keyMaterial.publicKeySpki,
	privateKey: keyMaterial.privateKeyPkcs8
});

const buildIdentityProvisionResult = async (identityPayload: IdentityPayload): Promise<IdentityProvisionResult> => {
	const [runtimeEncryptionKeyPair, runtimeSigningKeyPair] = await Promise.all([
		importKeyPairFromExported(toExportedKeyPair(identityPayload.identity.encryption), 'ECDH', false),
		importKeyPairFromExported(toExportedKeyPair(identityPayload.identity.signing), 'ECDSA', false)
	]);

	const [encryptionPublicKey, signingPublicKey, userId, fingerprint] = await Promise.all([
		exportPublicKey(runtimeEncryptionKeyPair.publicKey),
		exportPublicKey(runtimeSigningKeyPair.publicKey),
		hashPublicKey(runtimeEncryptionKeyPair.publicKey),
		generateFingerprint(runtimeEncryptionKeyPair.publicKey)
	]);

	return {
		runtimeEncryptionKeyPair,
		runtimeSigningKeyPair,
		identityPayload,
		userId,
		fingerprint,
		encryptionPublicKey,
		signingPublicKey
	};
};

const replaceKeyDatabaseState = async (provision: PersistedIdentityProvision | null, peers: StoredPeerKey[]): Promise<void> => {
	await keyDatabase.transaction(
		'rw',
		keyDatabase.keyPairs,
		keyDatabase.peerKeys,
		keyDatabase.identityCapsules,
		async () => {
			await Promise.all([
				keyDatabase.keyPairs.clear(),
				keyDatabase.peerKeys.clear(),
				keyDatabase.identityCapsules.clear()
			]);

			if (provision) {
				const createdAt = Date.now();
				await keyDatabase.keyPairs.bulkPut([
					{
						id: 'encryption',
						type: 'encryption',
						publicKey: provision.runtimeEncryptionKeyPair.publicKey,
						privateKey: provision.runtimeEncryptionKeyPair.privateKey,
						createdAt
					},
					{
						id: 'signing',
						type: 'signing',
						publicKey: provision.runtimeSigningKeyPair.publicKey,
						privateKey: provision.runtimeSigningKeyPair.privateKey,
						createdAt
					}
				]);

				await keyDatabase.identityCapsules.put({
					id: 'identity',
					capsule: provision.capsule,
					createdAt: provision.capsule.createdAt,
					updatedAt: Date.now()
				});
			}

			if (peers.length > 0)
				await keyDatabase.peerKeys.bulkPut(peers);
		}
	);
};

const createNewIdentity = async (): Promise<IdentityProvisionResult> => {
	const [setupEncryptionKeyPair, setupSigningKeyPair] = await Promise.all([
		generateExportableEncryptionKeyPair(),
		generateExportableSigningKeyPair()
	]);
	const identityPayload = await createIdentityPayload(setupEncryptionKeyPair, setupSigningKeyPair);
	const provision = await buildIdentityProvisionResult(identityPayload);
	const capsule = await createIdentityCapsule(identityPayload, provision.runtimeEncryptionKeyPair.publicKey);

	await replaceKeyDatabaseState({
		...provision,
		capsule
	}, []);

	return provision;
};

export {
	buildIdentityProvisionResult,
	createNewIdentity,
	replaceKeyDatabaseState,
	type IdentityProvisionResult,
	type PersistedIdentityProvision
};