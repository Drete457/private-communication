import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const createTable = () => ({
		toArray: vi.fn(),
		clear: vi.fn(),
		bulkPut: vi.fn()
	});
	const messageDatabase = {
		transaction: vi.fn(),
		tables: [] as unknown[],
		messages: createTable(),
		linkPreviews: createTable(),
		outbox: createTable(),
		localAttachments: createTable(),
		transferQueue: createTable(),
		remoteMedia: createTable()
	};

	messageDatabase.tables = [
		messageDatabase.messages,
		messageDatabase.linkPreviews,
		messageDatabase.outbox,
		messageDatabase.localAttachments,
		messageDatabase.transferQueue,
		messageDatabase.remoteMedia
	];

	return {
		exportBackup: vi.fn(),
		parsePcbkBackupFile: vi.fn(),
		assemblePreparedPcbkRestoreState: vi.fn(),
		buildIdentityProvisionResult: vi.fn(),
		createIdentityCapsule: vi.fn(),
		replaceKeyDatabaseState: vi.fn(),
		removePushSubscription: vi.fn(),
		getAllPeerKeys: vi.fn(),
		getIdentityCapsule: vi.fn(),
		getKeyPair: vi.fn(),
		unlockIdentityCapsule: vi.fn(),
		webSocketService: {
			disconnect: vi.fn(),
			setUserId: vi.fn(),
			connect: vi.fn()
		},
		messageDatabase
	};
});

vi.mock('@/services/backup', () => ({
	exportBackup: mocks.exportBackup,
	parsePcbkBackupFile: mocks.parsePcbkBackupFile,
	assemblePreparedPcbkRestoreState: mocks.assemblePreparedPcbkRestoreState
}));

vi.mock('@/services/identity-provision-service', () => ({
	buildIdentityProvisionResult: mocks.buildIdentityProvisionResult,
	replaceKeyDatabaseState: mocks.replaceKeyDatabaseState
}));

vi.mock('@/services/message-service', () => ({
	db: mocks.messageDatabase
}));

vi.mock('@/services/push-service', () => ({
	removePushSubscription: mocks.removePushSubscription
}));

vi.mock('@/services/web-socket-service', () => ({
	webSocketService: mocks.webSocketService
}));

vi.mock('@/crypto/key-manager', () => ({
	getAllPeerKeys: mocks.getAllPeerKeys,
	getIdentityCapsule: mocks.getIdentityCapsule,
	getKeyPair: mocks.getKeyPair
}));

vi.mock('@/crypto', () => ({
	createIdentityCapsule: mocks.createIdentityCapsule,
	unlockIdentityCapsule: mocks.unlockIdentityCapsule
}));

import { restoreBackup } from '@/services/identity-backup-service';

const TEST_CREATED_AT = 1_700_000_000_000;

const tableEntries = [
	'messages',
	'linkPreviews',
	'outbox',
	'localAttachments',
	'transferQueue',
	'remoteMedia'
] as const;

const createIdentityPayload = (userId = 'snapshot-user') => ({
	version: 1,
	createdAt: TEST_CREATED_AT,
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

const createPreparedRestore = (mode: 'identity-only' | 'full' = 'full') => {
	const identityPayload = createIdentityPayload('restored-user');

	return {
		mode,
		provision: {
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
			signingPublicKey: identityPayload.identity.signing.publicKeySpki,
			capsule: { createdAt: TEST_CREATED_AT, updatedAt: TEST_CREATED_AT }
		},
		peers: [{
			peerId: 'restored-peer',
			fingerprint: 'restored-peer-fingerprint',
			addedAt: TEST_CREATED_AT,
			encryptionPublicKey: 'restored-peer-enc',
			signingPublicKey: 'restored-peer-sign'
		}],
		messageState: {
			messages: [{
				id: 'restored-message',
				senderId: 'restored-user',
				recipientId: 'restored-peer',
				timestamp: TEST_CREATED_AT,
				content: 'restored',
				type: 'text',
				status: 'read'
			}],
			attachments: [],
			remoteMedia: [],
			linkPreviews: [],
			outbox: [],
			transferQueue: []
		}
	};
};

describe('identity backup restore service', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.messageDatabase.transaction.mockImplementation(async (...args: unknown[]) => {
			const callback = args.at(-1) as () => Promise<void>;
			return callback();
		});

		for (const tableName of tableEntries) {
			mocks.messageDatabase[tableName].toArray.mockResolvedValue([]);
			mocks.messageDatabase[tableName].clear.mockResolvedValue(undefined);
			mocks.messageDatabase[tableName].bulkPut.mockResolvedValue(undefined);
		}

		mocks.messageDatabase.messages.toArray.mockResolvedValue([{
			id: 'snapshot-message',
			senderId: 'snapshot-user',
			recipientId: 'snapshot-peer',
			timestamp: TEST_CREATED_AT,
			content: 'snapshot',
			type: 'text',
			status: 'read'
		}]);
		mocks.getAllPeerKeys.mockResolvedValue([{
			peerId: 'snapshot-peer',
			fingerprint: 'snapshot-peer-fingerprint',
			addedAt: TEST_CREATED_AT,
			encryptionPublicKey: 'snapshot-peer-enc',
			signingPublicKey: 'snapshot-peer-sign'
		}]);
		mocks.getIdentityCapsule.mockResolvedValue({ createdAt: TEST_CREATED_AT, updatedAt: TEST_CREATED_AT });
		mocks.getKeyPair.mockResolvedValue({ privateKey: {} as CryptoKey });
		mocks.unlockIdentityCapsule.mockResolvedValue(createIdentityPayload());
		mocks.buildIdentityProvisionResult.mockImplementation(async (identityPayload) => ({
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
		}));
		mocks.createIdentityCapsule.mockResolvedValue({ createdAt: TEST_CREATED_AT, updatedAt: TEST_CREATED_AT });
		mocks.parsePcbkBackupFile.mockResolvedValue({ clearHeader: { mode: 'full' } });
		mocks.assemblePreparedPcbkRestoreState.mockResolvedValue(createPreparedRestore());
		mocks.replaceKeyDatabaseState.mockResolvedValue(undefined);
		mocks.removePushSubscription.mockResolvedValue(undefined);
		mocks.webSocketService.connect.mockResolvedValue(undefined);
	});

	it('applies prepared PCBK restore state on success', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'backup.pcbk', { type: 'application/octet-stream' });
		const preparedRestore = createPreparedRestore();
		mocks.assemblePreparedPcbkRestoreState.mockResolvedValue(preparedRestore);

		await expect(restoreBackup(file, 'passphrase')).resolves.toBe('full');

		expect(mocks.parsePcbkBackupFile).toHaveBeenCalledTimes(1);
		expect(mocks.messageDatabase.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.webSocketService.disconnect).toHaveBeenCalledTimes(1);
		expect(mocks.removePushSubscription).toHaveBeenCalledTimes(1);
		expect(mocks.replaceKeyDatabaseState).toHaveBeenCalledWith(preparedRestore.provision, preparedRestore.peers);
	});

	it('rolls back snapshot when apply fails after parse and assembly', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'backup.pcbk', { type: 'application/octet-stream' });
		mocks.replaceKeyDatabaseState
			.mockImplementationOnce(async () => { throw new Error('apply failed'); })
			.mockImplementationOnce(async () => undefined);

		await expect(restoreBackup(file, 'passphrase')).rejects.toMatchObject({
			code: 'apply-failed',
			stage: 'applying-state'
		});

		expect(mocks.messageDatabase.transaction).toHaveBeenCalledTimes(2);
		expect(mocks.replaceKeyDatabaseState).toHaveBeenCalledTimes(2);
		expect(mocks.replaceKeyDatabaseState.mock.calls[1][1]).toEqual([{
			peerId: 'snapshot-peer',
			fingerprint: 'snapshot-peer-fingerprint',
			addedAt: TEST_CREATED_AT,
			encryptionPublicKey: 'snapshot-peer-enc',
			signingPublicKey: 'snapshot-peer-sign'
		}]);
		expect(mocks.webSocketService.setUserId).toHaveBeenCalledWith('snapshot-user');
		expect(mocks.webSocketService.connect).toHaveBeenCalledTimes(1);
	});

	it('surfaces rollback-failed when rollback also breaks', async () => {
		const file = new File([new Uint8Array([1, 2, 3])], 'backup.pcbk', { type: 'application/octet-stream' });
		mocks.replaceKeyDatabaseState
			.mockImplementationOnce(async () => { throw new Error('apply failed'); })
			.mockImplementationOnce(async () => { throw new Error('rollback failed'); });

		await expect(restoreBackup(file, 'passphrase')).rejects.toMatchObject({
			code: 'rollback-failed',
			stage: 'rolling-back'
		});

		expect(mocks.messageDatabase.transaction).toHaveBeenCalledTimes(2);
		expect(mocks.replaceKeyDatabaseState).toHaveBeenCalledTimes(2);
	});
});