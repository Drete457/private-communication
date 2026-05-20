type BackupExportProgressStage =
	| 'validating-passphrase'
	| 'deriving-keys'
	| 'writing-header'
	| 'exporting-identity'
	| 'exporting-peer-keys'
	| 'exporting-messages'
	| 'exporting-link-previews'
	| 'exporting-outbox'
	| 'exporting-attachments'
	| 'exporting-transfer-queue'
	| 'exporting-remote-media'
	| 'writing-manifest'
	| 'finalizing';

type BackupExportProgress = {
	stage: BackupExportProgressStage;
	processedItems?: number | undefined;
	totalItems?: number | undefined;
	processedBytes?: number | undefined;
	totalBytes?: number | undefined;
};

type BackupProgressHandler = (progress: BackupExportProgress) => void;

export type {
	BackupExportProgress,
	BackupExportProgressStage,
	BackupProgressHandler
};