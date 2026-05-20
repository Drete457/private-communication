import type { PCBKMode } from '@private-communication/pcbk-core';

type BackupRestoreProgressStage =
	| 'reading-file'
	| 'parsing-prelude'
	| 'deriving-root-key'
	| 'authenticating-header'
	| 'unwrapping-content-key'
	| 'decrypting-records'
	| 'assembling-state'
	| 'applying-state'
	| 'rolling-back';

type BackupRestoreProgress = {
	stage: BackupRestoreProgressStage;
	mode?: PCBKMode | undefined;
	processedItems?: number | undefined;
	totalItems?: number | undefined;
	processedBytes?: number | undefined;
	totalBytes?: number | undefined;
};

type BackupRestoreProgressHandler = (progress: BackupRestoreProgress) => void;

type BackupRestoreErrorCode =
	| 'restore-canceled'
	| 'unsupported-file'
	| 'malformed-backup'
	| 'wrong-passphrase'
	| 'corrupted-backup'
	| 'apply-failed'
	| 'rollback-failed'
	| 'unknown';

interface BackupRestoreError extends Error {
	code: BackupRestoreErrorCode;
	stage?: BackupRestoreProgressStage | undefined;
	cause?: unknown;
}

type RestoreBackupOptions = {
	onProgress?: BackupRestoreProgressHandler | undefined;
	signal?: AbortSignal | undefined;
};

export type {
	BackupRestoreError,
	BackupRestoreErrorCode,
	BackupRestoreProgress,
	BackupRestoreProgressHandler,
	BackupRestoreProgressStage,
	RestoreBackupOptions
};