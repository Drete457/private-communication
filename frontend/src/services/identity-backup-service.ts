import {
	unlockIdentityCapsule
	
} from '@/crypto';
import type {IdentityPayload} from '@/crypto';
import {
	getAllPeerKeys,
	getIdentityCapsule,
	getKeyPair
	
} from '@/crypto/key-manager';
import type {StoredPeerKey} from '@/crypto/key-manager';
import { getAuthSession } from '@/services/auth-session-service';
import {
	assemblePreparedPcbkRestoreState,
	exportBackup,
	parsePcbkBackupFile
} from '@/services/backup';
import {
	stageIdentityProvision
	
	
} from '@/services/backup/restore/prepared-state';
import type {PreparedMessageDatabaseState, PreparedRestoreState} from '@/services/backup/restore/prepared-state';
import {
	replaceKeyDatabaseState
} from '@/services/identity-provision-service';
import { clientLogger } from '@/services/logger';
import { db as messageDatabase } from '@/services/message-service';
import { removePushSubscription } from '@/services/push-service';
import { webSocketService } from '@/services/web-socket-service';
import type {
	BackupRestoreError,
	BackupRestoreErrorCode,
	BackupRestoreProgress,
	BackupRestoreProgressHandler,
	BackupRestoreProgressStage,
	ExportBackupOptions,
	RestoreBackupOptions
} from '@/types/backup';

import type { PCBKMode } from '@private-communication/pcbk-core';

type BackupExportInvocationOptions = Pick<ExportBackupOptions, 'onProgress' | 'signal'>;

type RestoreSnapshot = {
	identityPayload: IdentityPayload | null;
	peers: StoredPeerKey[];
	messageState: PreparedMessageDatabaseState;
};

const emitRestoreProgress = (
	onProgress: BackupRestoreProgressHandler | undefined,
	progress: BackupRestoreProgress
): void => {
	onProgress?.(progress);
};

const createBackupRestoreError = (
	code: BackupRestoreErrorCode,
	message: string,
	stage?: BackupRestoreProgressStage,
	cause?: unknown
): BackupRestoreError => {
	const error = new Error(message) as BackupRestoreError;
	error.name = 'BackupRestoreError';
	error.code = code;

	if (stage)
		error.stage = stage;

	if (cause !== undefined)
		error.cause = cause;

	return error;
};

const isBackupRestoreError = (error: unknown): error is BackupRestoreError => {
	return error instanceof Error && 'code' in error;
};

const assertRestoreNotAborted = (
	signal: AbortSignal | undefined,
	stage: BackupRestoreProgressStage
): void => {
	if (signal?.aborted)
		throw createBackupRestoreError('restore-canceled', 'Backup restore was canceled.', stage);
};

const getOperationalIdentityPayload = async (): Promise<IdentityPayload> => {
	const capsule = await getIdentityCapsule();
	if (!capsule)
		throw new Error('Identity capsule not found');

	const encryptionKeyPair = await getKeyPair('encryption');
	if (!encryptionKeyPair)
		throw new Error('Encryption key pair not found');

	return unlockIdentityCapsule(capsule, encryptionKeyPair.privateKey);
}

const replaceMessageDatabaseState = async (state: PreparedMessageDatabaseState): Promise<void> => {
	await messageDatabase.transaction(
		'rw',
		messageDatabase.tables,
		async () => {
			await Promise.all([
				messageDatabase.messages.clear(),
				messageDatabase.linkPreviews.clear(),
				messageDatabase.outbox.clear(),
				messageDatabase.localAttachments.clear(),
				messageDatabase.transferQueue.clear(),
				messageDatabase.remoteMedia.clear()
			]);

			if (state.messages.length > 0)
				await messageDatabase.messages.bulkPut(state.messages);
			if (state.linkPreviews.length > 0)
				await messageDatabase.linkPreviews.bulkPut(state.linkPreviews);
			if (state.outbox.length > 0)
				await messageDatabase.outbox.bulkPut(state.outbox);
			if (state.attachments.length > 0)
				await messageDatabase.localAttachments.bulkPut(state.attachments);
			if (state.transferQueue.length > 0)
				await messageDatabase.transferQueue.bulkPut(state.transferQueue);
			if (state.remoteMedia.length > 0)
				await messageDatabase.remoteMedia.bulkPut(state.remoteMedia);
		}
	);
};


const collectCurrentRestoreSnapshot = async (): Promise<RestoreSnapshot> => {
	const [peers, messages, attachments, remoteMedia, linkPreviews, outbox, transferQueue] = await Promise.all([
		getAllPeerKeys(),
		messageDatabase.messages.toArray(),
		messageDatabase.localAttachments.toArray(),
		messageDatabase.remoteMedia.toArray(),
		messageDatabase.linkPreviews.toArray(),
		messageDatabase.outbox.toArray(),
		messageDatabase.transferQueue.toArray()
	]);

	let identityPayload: IdentityPayload | null = null;
	try {
		identityPayload = await getOperationalIdentityPayload();
	} catch {
		identityPayload = null;
	}

	return {
		identityPayload,
		peers,
		messageState: {
			messages,
			attachments,
			remoteMedia,
			linkPreviews,
			outbox,
			transferQueue
		}
	};
};

const rollbackRestore = async (snapshot: RestoreSnapshot): Promise<void> => {
	try {
		await replaceMessageDatabaseState(snapshot.messageState);
		const rollbackProvision = snapshot.identityPayload
			? await stageIdentityProvision(snapshot.identityPayload)
			: null;
		await replaceKeyDatabaseState(rollbackProvision, snapshot.peers);
		webSocketService.setUserId(snapshot.identityPayload?.identity.userId ?? null);
		if (snapshot.identityPayload?.identity.userId) {
			try {
				await webSocketService.connect();
			} catch (error) {
				clientLogger.warn('Failed to reconnect after restore rollback:', error);
			}
		}
	} catch (error) {
		clientLogger.error('Failed to rollback restore state:', error);
		throw error;
	}
};

const applyPreparedRestore = async (preparedRestore: PreparedRestoreState): Promise<void> => {
	webSocketService.disconnect();
	try {
		await removePushSubscription(getAuthSession().userId);
	} catch (error) {
		clientLogger.warn('Failed to remove push subscription during restore:', error);
	}

	await replaceMessageDatabaseState(preparedRestore.messageState);
	await replaceKeyDatabaseState(preparedRestore.provision, preparedRestore.peers);
};

const exportIdentityBackup = async (passphrase: string, options: BackupExportInvocationOptions = {}): Promise<void> => {
	await exportBackup({
		mode: 'identity-only',
		passphrase,
		...options
	});
}

const exportFullBackup = async (passphrase: string, options: BackupExportInvocationOptions = {}): Promise<void> => {
	await exportBackup({
		mode: 'full',
		passphrase,
		...options
	});
}

const normalizeRestoreError = (error: unknown): BackupRestoreError => {
	if (isBackupRestoreError(error))
		return error;

	if (error instanceof Error) {
		if (error instanceof SyntaxError || error.message.startsWith('Unsupported')) {
			return createBackupRestoreError(
				'malformed-backup',
				'Could not restore backup. The selected file is not a valid backup.',
				'reading-file',
				error
			);
		}

		if (error.name === 'OperationError'
			|| error.message.includes('operation-specific')
			|| error.message.includes('AES-GCM')) {
			return createBackupRestoreError(
				'wrong-passphrase',
				'Could not restore backup. The passphrase is wrong or the backup file is corrupted.',
				'deriving-root-key',
				error
			);
		}

		return createBackupRestoreError('unknown', `Could not restore backup. ${error.message}`, undefined, error);
	}

	return createBackupRestoreError('unknown', 'Could not restore backup. An unexpected error occurred.');
};

const restoreBackup = async (file: File, passphrase: string, options: RestoreBackupOptions = {}): Promise<PCBKMode> => {
	const { onProgress, signal } = options;

	try {
		const parsedBackup = await parsePcbkBackupFile(file, passphrase, options);

		emitRestoreProgress(onProgress, {
			stage: 'assembling-state',
			mode: parsedBackup.clearHeader.mode
		});
		assertRestoreNotAborted(signal, 'assembling-state');

		const preparedRestore = await assemblePreparedPcbkRestoreState(parsedBackup);
		assertRestoreNotAborted(signal, 'assembling-state');

		const snapshot = await collectCurrentRestoreSnapshot();
		assertRestoreNotAborted(signal, 'applying-state');

		try {
			emitRestoreProgress(onProgress, {
				stage: 'applying-state',
				mode: preparedRestore.mode
			});
			await applyPreparedRestore(preparedRestore);
		} catch (error) {
			emitRestoreProgress(onProgress, {
				stage: 'rolling-back',
				mode: preparedRestore.mode
			});

			try {
				await rollbackRestore(snapshot);
			} catch (rollbackError) {
				throw createBackupRestoreError(
					'rollback-failed',
					'Could not restore backup. Restore failed and rollback did not complete cleanly.',
					'rolling-back',
					rollbackError
				);
			}

			throw createBackupRestoreError(
				'apply-failed',
				'Could not restore backup. Failed while applying restored state.',
				'applying-state',
				error
			);
		}

		return preparedRestore.mode;
	} catch (error) {
		throw normalizeRestoreError(error);
	}
}

export {
	exportIdentityBackup,
	exportFullBackup,
	restoreBackup,
	getOperationalIdentityPayload
};