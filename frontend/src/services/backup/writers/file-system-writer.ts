import type {
	BackupWriter,
	SaveFilePickerWindow
} from '@/types/backup';

const UNSUPPORTED_BACKUP_EXPORT_MESSAGE = 'Backup export requires a supported browser with File System Access API.';
const CANCELED_BACKUP_EXPORT_MESSAGE = 'Backup export was canceled.';

const getSaveFilePicker = (): NonNullable<SaveFilePickerWindow['showSaveFilePicker']> => {
	const pickerWindow = window as SaveFilePickerWindow;

	if (typeof pickerWindow.showSaveFilePicker !== 'function')
		throw new Error(UNSUPPORTED_BACKUP_EXPORT_MESSAGE);

	return pickerWindow.showSaveFilePicker;
};

const isBackupExportSupported = (): boolean => {
	if (typeof window === 'undefined')
		return false;

	const pickerWindow = window as SaveFilePickerWindow;
	return typeof pickerWindow.showSaveFilePicker === 'function';
};

const createFileSystemBackupWriter = async (suggestedName: string): Promise<BackupWriter> => {
	const showSaveFilePicker = getSaveFilePicker();

	try {
		const handle = await showSaveFilePicker({
			suggestedName,
			excludeAcceptAllOption: true,
			types: [{
				description: 'Private Communication Backup',
				accept: {
					'application/x-private-communication-backup': ['.pcbk']
				}
			}]
		});
		const writable = await handle.createWritable();

		return {
			write: async (chunk) => {
				await writable.write(chunk);
			},
			close: async () => {
				await writable.close();
			},
			abort: async (reason) => {
				await writable.abort(reason);
			}
		};
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError')
			throw new Error(CANCELED_BACKUP_EXPORT_MESSAGE);

		throw error;
	}
};

export {
	CANCELED_BACKUP_EXPORT_MESSAGE,
	UNSUPPORTED_BACKUP_EXPORT_MESSAGE,
	createFileSystemBackupWriter,
	isBackupExportSupported
};