import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentType } from '@/types';

const mocks = vi.hoisted(() => ({
	buildIdentityProvisionResult: vi.fn(),
	createIdentityCapsule: vi.fn()
}));

vi.mock('@/services/identity-provision-service', () => ({
	buildIdentityProvisionResult: mocks.buildIdentityProvisionResult
}));

vi.mock('@/crypto', () => ({
	createIdentityCapsule: mocks.createIdentityCapsule
}));

import { assemblePreparedPcbkRestoreState } from '@/services/backup/restore/prepared-state';

type ParsedBackupInput = Parameters<typeof assemblePreparedPcbkRestoreState>[0];

const TEST_CREATED_AT = 1_700_000_000_000;

const createIdentityPayload = (userId = 'user-alice') => ({
	version: 1,
	createdAt: TEST_CREATED_AT - 1_000,
	identity: {
		userId,
		fingerprint: `fingerprint-${userId}`,
		encryption: {
			publicKeySpki: `enc-public-${userId}`,
			privateKeyPkcs8: `enc-private-${userId}`
		},
		signing: {
			publicKeySpki: `sign-public-${userId}`,
			privateKeyPkcs8: `sign-private-${userId}`
		}
	}
});

const createProvision = (identityPayload = createIdentityPayload()) => ({
	runtimeEncryptionKeyPair: {
		publicKey: {} as CryptoKey,
		privateKey: {} as CryptoKey
	},
	runtimeSigningKeyPair: {
		publicKey: {} as CryptoKey,
		privateKey: {} as CryptoKey
	},
	identityPayload,
	userId: identityPayload.identity.userId,
	fingerprint: identityPayload.identity.fingerprint,
	encryptionPublicKey: identityPayload.identity.encryption.publicKeySpki,
	signingPublicKey: identityPayload.identity.signing.publicKeySpki
});

const createParsedBackup = (mode: 'identity-only' | 'full'): ParsedBackupInput => {
	return {
		prelude: {} as ParsedBackupInput['prelude'],
		clearHeader: { mode } as ParsedBackupInput['clearHeader'],
		manifest: {} as ParsedBackupInput['manifest'],
		identity: createIdentityPayload(),
		peerKeys: [],
		messages: [],
		linkPreviews: [],
		outbox: [],
		attachments: [],
		transferQueue: [],
		remoteMedia: [],
		totalRecordCount: 0
	};
};

describe('prepared PCBK restore state', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createIdentityCapsule.mockResolvedValue({ createdAt: TEST_CREATED_AT, updatedAt: TEST_CREATED_AT });
	});

	it('builds empty persisted state for identity-only restores', async () => {
		const backup = createParsedBackup('identity-only');
		const provision = createProvision(backup.identity);
		mocks.buildIdentityProvisionResult.mockResolvedValue(provision);

		const prepared = await assemblePreparedPcbkRestoreState(backup);

		expect(prepared.mode).toBe('identity-only');
		expect(prepared.provision.userId).toBe(backup.identity.identity.userId);
		expect(prepared.peers).toHaveLength(0);
		expect(prepared.messageState.messages).toHaveLength(0);
		expect(prepared.messageState.attachments).toHaveLength(0);
		expect(prepared.messageState.transferQueue).toHaveLength(0);
	});

	it('rejects unexpected data inside identity-only restores', async () => {
		const backup = createParsedBackup('identity-only');
		const provision = createProvision(backup.identity);
		mocks.buildIdentityProvisionResult.mockResolvedValue(provision);
		backup.peerKeys = [{
			peerId: 'user-bob',
			fingerprint: 'peer-fingerprint',
			addedAt: TEST_CREATED_AT,
			encryptionPublicKey: 'peer-enc-public',
			signingPublicKey: 'peer-sign-public'
		}];

		await expect(assemblePreparedPcbkRestoreState(backup)).rejects.toMatchObject({
			code: 'malformed-backup',
			stage: 'assembling-state'
		});
	});

	it('maps full restores into blob-backed prepared state', async () => {
		const backup = createParsedBackup('full');
		const provision = createProvision(backup.identity);
		const attachmentBytes = new TextEncoder().encode('attachment-data');
		const transferQueueBytes = new TextEncoder().encode('transfer-queue-data');
		const remoteMediaBytes = new TextEncoder().encode('remote-media-data');
		mocks.buildIdentityProvisionResult.mockResolvedValue(provision);

		backup.peerKeys = [{
			peerId: 'user-bob',
			fingerprint: 'peer-fingerprint',
			addedAt: TEST_CREATED_AT,
			encryptionPublicKey: 'peer-enc-public',
			signingPublicKey: 'peer-sign-public',
			displayName: 'Bob'
		}];
		backup.messages = [{
			id: 'message-1',
			senderId: 'user-alice',
			recipientId: 'user-bob',
			timestamp: TEST_CREATED_AT,
			content: 'restored message',
			type: 'text',
			status: 'read'
		}];
		backup.linkPreviews = [{
			url: 'https://example.com',
			fetchedAt: TEST_CREATED_AT
		}];
		backup.outbox = [{
			id: 'outbox-1',
			recipientId: 'user-bob',
			payload: {
				id: 'encrypted-1',
				senderId: 'user-alice',
				recipientId: 'user-bob',
				timestamp: TEST_CREATED_AT,
				payload: {
					iv: 'iv-1',
					cipherText: 'cipher-1'
				},
				signature: 'signature-1'
			},
			createdAt: TEST_CREATED_AT,
			attempts: 0
		}];
		backup.attachments = [{
			objectId: 'attachment-1',
			meta: {
				attachmentId: 'attachment-1',
				peerId: 'user-bob',
				messageId: 'message-1',
				fileName: 'note.txt',
				mimeType: 'text/plain',
				size: attachmentBytes.length,
				kind: 'document',
				plaintextHashSha256: 'hash-attachment',
				createdAt: TEST_CREATED_AT,
				updatedAt: TEST_CREATED_AT,
				lastAccessedAt: TEST_CREATED_AT,
				chunkSize: attachmentBytes.length,
				chunkCount: 1
			},
			chunks: [attachmentBytes],
			totalBytes: attachmentBytes.length
		}];
		backup.transferQueue = [{
			objectId: 'transfer-1',
			meta: {
				id: 'transfer-1',
				recipientId: 'user-bob',
				meta: {
					name: 'queue.bin',
					size: transferQueueBytes.length,
					type: 'application/octet-stream',
					lastModified: TEST_CREATED_AT
				},
				upload: null,
				messageDispatch: {
					content: 'queued message'
				},
				uiSource: AttachmentType.chat,
				attachment: null,
				manifest: null,
				persistLocally: true,
				status: 'pending',
				retryCount: 0,
				createdAt: TEST_CREATED_AT,
				updatedAt: TEST_CREATED_AT,
				lastError: null,
				chunkSize: transferQueueBytes.length,
				chunkCount: 1
			},
			chunks: [transferQueueBytes],
			totalBytes: transferQueueBytes.length
		}];
		backup.remoteMedia = [{
			objectId: 'media-1',
			meta: {
				mediaId: 'media-1',
				url: 'https://example.com/image.png',
				mimeType: 'image/png',
				extension: 'png',
				isFavorite: true,
				sourceHost: 'example.com',
				peerId: 'user-bob',
				messageId: 'message-1',
				createdAt: TEST_CREATED_AT,
				updatedAt: TEST_CREATED_AT,
				lastAccessedAt: TEST_CREATED_AT,
				expiresAt: TEST_CREATED_AT + 1_000,
				chunkSize: remoteMediaBytes.length,
				chunkCount: 1
			},
			chunks: [remoteMediaBytes],
			totalBytes: remoteMediaBytes.length
		}];

		const prepared = await assemblePreparedPcbkRestoreState(backup);

		expect(prepared.mode).toBe('full');
		expect(prepared.peers).toHaveLength(1);
		expect(prepared.messageState.messages).toHaveLength(1);
		expect(prepared.messageState.attachments[0].blob.size).toBe(attachmentBytes.length);
		expect(prepared.messageState.transferQueue[0].fileBlob.size).toBe(transferQueueBytes.length);
		expect(prepared.messageState.remoteMedia[0].blob.size).toBe(remoteMediaBytes.length);
		expect(prepared.provision.capsule).toEqual({ createdAt: TEST_CREATED_AT, updatedAt: TEST_CREATED_AT });
	});
});