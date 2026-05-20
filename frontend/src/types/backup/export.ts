import type { IdentityPayload } from '@/crypto';

import type { EncryptedMessage } from '../messages';
import type { BackupProgressHandler } from './progress';
import type { PCBKMode } from '@private-communication/pcbk-core';

type ExportBackupMode = PCBKMode;

type ExportBackupOptions = {
	mode: ExportBackupMode;
	passphrase: string;
	onProgress?: BackupProgressHandler | undefined;
	signal?: AbortSignal | undefined;
};

type BackupOutboxRecord = {
	id: string;
	recipientId: string;
	payload: EncryptedMessage;
	createdAt: number;
	lastAttemptAt?: number | undefined;
	attempts: number;
};

type BackupBlobExportSource = {
	id: string;
	size: number;
};

type IdentityRecordPayload = {
	identity: IdentityPayload;
};

export type {
	BackupBlobExportSource,
	BackupOutboxRecord,
	ExportBackupMode,
	ExportBackupOptions,
	IdentityRecordPayload
};