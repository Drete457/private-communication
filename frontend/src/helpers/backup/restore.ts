import type {
	BackupRestoreError,
	BackupRestoreProgress,
	BackupRestoreProgressStage
} from '@/types/backup';

import type { PCBKMode } from '@private-communication/pcbk-core';


const RESTORE_STAGE_ORDER: BackupRestoreProgressStage[] = [
	'reading-file',
	'parsing-prelude',
	'deriving-root-key',
	'authenticating-header',
	'unwrapping-content-key',
	'decrypting-records',
	'assembling-state',
	'applying-state',
	'rolling-back'
];

const RESTORE_STAGE_LABELS: Record<BackupRestoreProgressStage, string> = {
	'reading-file': 'Reading PCBK file',
	'parsing-prelude': 'Parsing backup prelude',
	'deriving-root-key': 'Deriving restore keys',
	'authenticating-header': 'Authenticating backup header',
	'unwrapping-content-key': 'Unlocking content key',
	'decrypting-records': 'Decrypting backup records',
	'assembling-state': 'Assembling restored state',
	'applying-state': 'Applying restored state',
	'rolling-back': 'Rolling back local changes'
};

const RESTORE_PANEL_COPY = {
	defaultTitle: 'Restore backup',
	defaultDescription: 'Use a PCBK identity or full backup file (.pcbk). Restore validates the backup before replacing current local identity and backed-up data on this device.',
	chooseFileButton: 'Choose PCBK Backup',
	noFileSelected: 'No PCBK file selected',
	passphraseLabel: 'Restore passphrase',
	passphrasePlaceholder: 'Enter the backup passphrase',
	progressTitle: 'Restore progress',
	preparingProgress: 'Preparing restore',
	restoreAction: 'Restore PCBK Backup',
	restoringAction: 'Restoring PCBK backup...',
	modalTitle: 'Restore PCBK backup?',
	modalMessage: 'This validates selected PCBK backup, then replaces current local identity and backed-up data on this device. If applying restored state fails, app attempts rollback to previous local state. Continue only if you trust backup source and know passphrase.',
	modalAccept: 'Restore now',
	modalRestoring: 'Restoring...',
	chooseAnyFileError: 'Choose a backup file before restoring.',
	choosePcbkFileError: 'Choose a `.pcbk` backup file.',
	selectedBackupLabelPrefix: 'Selected PCBK backup:',
	defaultError: 'Could not restore PCBK backup.',
	restoreCanceledError: 'Restore was canceled before completion.',
	unsupportedFileError: 'Choose a `.pcbk` backup file created by this app.',
	malformedBackupError: 'Selected file is not a valid PCBK backup or uses an unsupported format.',
	wrongPassphraseError: 'Could not unlock PCBK backup. Check passphrase and try again. If it still fails, backup may be damaged.',
	corruptedBackupError: 'PCBK backup appears corrupted or incomplete. Use another copy if available.',
	applyFailedError: 'Backup was validated, but app could not apply restored state. Previous local state was restored.',
	rollbackFailedError: 'Restore failed and rollback did not finish cleanly. Reload app and verify local data before trying again.',
	fullRestoreSuccess: 'Full PCBK backup restored. Reloading app...',
	identityRestoreSuccess: 'Identity PCBK backup restored. Reloading app...'
} as const;

const isPcbkBackupFile = (file: File): boolean => {
	return file.name.toLowerCase().endsWith('.pcbk');
};

const formatRestoreBytes = (value: number): string => {
	if (value < 1024)
		return `${value} B`;

	if (value < 1024 * 1024)
		return `${(value / 1024).toFixed(1)} KB`;

	return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const getRestoreProgressRatio = (progress: BackupRestoreProgress | null): number => {
	if (!progress)
		return 0;

	if (typeof progress.totalBytes === 'number' && progress.totalBytes > 0)
		return Math.max(0, Math.min(1, (progress.processedBytes ?? 0) / progress.totalBytes));

	if (typeof progress.totalItems === 'number' && progress.totalItems > 0)
		return Math.max(0, Math.min(1, (progress.processedItems ?? 0) / progress.totalItems));

	const stageIndex = RESTORE_STAGE_ORDER.indexOf(progress.stage);
	if (stageIndex === -1)
		return 0;

	return (stageIndex + 1) / RESTORE_STAGE_ORDER.length;
};

const getRestoreProgressLabel = (progress: BackupRestoreProgress | null): string => {
	if (!progress)
		return RESTORE_PANEL_COPY.preparingProgress;

	return RESTORE_STAGE_LABELS[progress.stage];
};

const getRestoreItemProgressLabel = (progress: BackupRestoreProgress | null): string | null => {
	if (!progress)
		return null;

	if (typeof progress.totalItems === 'number' && progress.totalItems > 0)
		return `${progress.processedItems ?? 0}/${progress.totalItems} items`;

	return null;
};

const getRestoreByteProgressLabel = (progress: BackupRestoreProgress | null): string | null => {
	if (!progress)
		return null;

	if (typeof progress.totalBytes === 'number' && progress.totalBytes > 0)
		return `${formatRestoreBytes(progress.processedBytes ?? 0)} / ${formatRestoreBytes(progress.totalBytes)}`;

	return null;
};

const isBackupRestoreError = (error: unknown): error is BackupRestoreError => {
	return error instanceof Error && 'code' in error;
};

const getRestoreErrorMessage = (error: unknown): string => {
	if (!isBackupRestoreError(error))
		return error instanceof Error ? error.message : RESTORE_PANEL_COPY.defaultError;

	switch (error.code) {
		case 'restore-canceled':
			return RESTORE_PANEL_COPY.restoreCanceledError;
		case 'unsupported-file':
			return RESTORE_PANEL_COPY.unsupportedFileError;
		case 'malformed-backup':
			return RESTORE_PANEL_COPY.malformedBackupError;
		case 'wrong-passphrase':
			return RESTORE_PANEL_COPY.wrongPassphraseError;
		case 'corrupted-backup':
			return RESTORE_PANEL_COPY.corruptedBackupError;
		case 'apply-failed':
			return RESTORE_PANEL_COPY.applyFailedError;
		case 'rollback-failed':
			return RESTORE_PANEL_COPY.rollbackFailedError;
		case 'unknown':
			return error.message || RESTORE_PANEL_COPY.defaultError;
		default:
			return error.message || RESTORE_PANEL_COPY.defaultError;
	}
};

const getRestoreSelectedFileStatus = (fileName: string): string => {
	return `${RESTORE_PANEL_COPY.selectedBackupLabelPrefix} ${fileName}`;
};

const getRestoreSuccessStatus = (mode: PCBKMode): string => {
	return mode === 'full'
		? RESTORE_PANEL_COPY.fullRestoreSuccess
		: RESTORE_PANEL_COPY.identityRestoreSuccess;
};

export {
	getRestoreByteProgressLabel,
	getRestoreErrorMessage,
	getRestoreItemProgressLabel,
	getRestoreProgressLabel,
	getRestoreProgressRatio,
	getRestoreSelectedFileStatus,
	getRestoreSuccessStatus,
	isPcbkBackupFile,
	RESTORE_PANEL_COPY
};