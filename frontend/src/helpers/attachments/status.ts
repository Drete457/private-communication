import type { AttachmentState, TransferQueueStatus } from '@/types';

type AttachmentTransferPhase = 'preparing' | 'encrypting' | 'uploading' | 'finalizing' | 'decrypting' | 'sending';

type AttachmentTransferStatusMessageOptions = {
	uploadLabel?: string;
	sendingLabel?: string;
	queuePosition?: {
		current: number;
		total: number;
	};
};

type AttachmentTransferDisplayProgress = {
	phase: 'preparing' | 'uploading' | 'finalizing' | 'sending';
	progress: number;
};

type AttachmentTransferFeedback = {
	state: AttachmentState;
	message: string;
};

type AttachmentTransferFeedbackInput = {
	fileName: string;
	phase: AttachmentTransferPhase;
	progress: number;
	state: 'uploading' | 'uploaded' | 'failed';
	queueStatus?: TransferQueueStatus | undefined;
	retryCount?: number | undefined;
	error?: string | undefined;
};

const STORAGE_ERROR_PATTERN = /(not enough local storage|insufficient storage)/i;
const NETWORK_ERROR_PATTERN = /(connection lost|network|failed to fetch|load failed|waiting for network|unable to reach the server|check your connection)/i;

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const isAttachmentStorageErrorMessage = (message?: string): boolean =>
	typeof message === 'string' && STORAGE_ERROR_PATTERN.test(message);

const isAttachmentNetworkErrorMessage = (message?: string): boolean =>
	typeof message === 'string' && NETWORK_ERROR_PATTERN.test(message);

const getAttachmentStorageFailureMessage = (): string => 'Failed (insufficient storage).';

const getAttachmentUploadSuccessMessage = (totalFiles: number, fileName?: string): string =>
	totalFiles === 1 && fileName
		? `Shared ${fileName}`
		: `Shared ${totalFiles} files`;

const getAttachmentUploadPartialFailureMessage = (successCount: number, totalFiles: number, failedCount: number): string =>
	`Shared ${successCount}/${totalFiles} files. ${failedCount} failed.`;

const getAttachmentUploadFailureMessage = (failedCount: number, totalFiles: number): string =>
	`${failedCount}/${totalFiles} files failed.`;

const getAttachmentForwardStartMessage = (fileName?: string): string =>
	fileName ? `Preparing ${fileName}...` : 'Forwarding message...';

const getAttachmentForwardSuccessMessage = (fileName?: string): string =>
	fileName ? `Shared ${fileName}` : 'Message forwarded';

const getAttachmentForwardFailureMessage = (): string => 'Forward failed';

const getAttachmentContinuationHint = (kind: 'upload' | 'download'): string =>
	kind === 'upload'
		? 'Keep the app open to continue uploads.'
		: 'Keep the app open to finish downloads.';

const getAttachmentContinuationReminderTitle = (kind: 'upload' | 'download'): string =>
	kind === 'upload' ? 'Upload paused' : 'Download paused';

const getAttachmentContinuationReminderMessage = (kind: 'upload' | 'download', count = 1): string => {
	const noun = kind === 'upload'
		? (count === 1 ? 'upload' : 'uploads')
		: (count === 1 ? 'download' : 'downloads');

	return `Open the app to finish ${count} ${noun}.`;
};

const getAttachmentStateTextColor = (attachmentState: AttachmentState): string => {
	if (attachmentState === 'uploading') return 'text-yellow-400';
	if (attachmentState === 'uploaded') return 'text-green-400';
	if (attachmentState === 'failed') return 'text-red-400';

	return 'text-gray-400';
};

const getAttachmentTransferStatusMessage = (
	fileName: string,
	progress: { phase: AttachmentTransferPhase; progress: number },
	options?: AttachmentTransferStatusMessageOptions
): string => {
	const percentage = Math.round(progress.progress * 100);
	const uploadLabel = getNonEmptyStringOrFallback(options?.uploadLabel, 'Uploading');
	const sendingLabel = getNonEmptyStringOrFallback(options?.sendingLabel, 'Sending');
	const queuePrefix = options?.queuePosition ? `${options.queuePosition.current}/${options.queuePosition.total} - ` : '';

	if (progress.phase === 'preparing')
		return `${queuePrefix}Preparing ${fileName}...`;

	if (progress.phase === 'encrypting')
		return `${queuePrefix}Encrypting ${fileName}... ${percentage}%`;

	if (progress.phase === 'uploading')
		return `${queuePrefix}${uploadLabel} ${fileName}... ${percentage}%`;

	if (progress.phase === 'decrypting')
		return `${queuePrefix}Decrypting ${fileName}... ${percentage}%`;

	if (progress.phase === 'sending')
		return `${queuePrefix}${sendingLabel} ${fileName} to chat...`;

	return `${queuePrefix}Finalizing ${fileName}...`;
};

const normalizeAttachmentTransferDisplayProgress = (
	progress: { phase: AttachmentTransferPhase; progress: number }
): AttachmentTransferDisplayProgress => {
	switch (progress.phase) {
		case 'encrypting':
		case 'decrypting':
			return {
				phase: 'uploading',
				progress: progress.progress
			};
		case 'preparing':
			return {
				phase: 'preparing',
				progress: progress.progress
			};
		case 'uploading':
			return {
				phase: 'uploading',
				progress: progress.progress
			};
		case 'finalizing':
			return {
				phase: 'finalizing',
				progress: progress.progress
			};
		case 'sending':
			return {
				phase: 'sending',
				progress: progress.progress
			};
	}
};

const getAttachmentTransferFeedback = (
	transfer: AttachmentTransferFeedbackInput,
	options?: AttachmentTransferStatusMessageOptions
): AttachmentTransferFeedback => {
	const queuePrefix = options?.queuePosition ? `${options.queuePosition.current}/${options.queuePosition.total} - ` : '';
	const percentage = Math.round(transfer.progress * 100);

	if (transfer.queueStatus === 'pending') {
		return {
			state: 'uploading',
			message: `${queuePrefix}Queued ${transfer.fileName}...`
		};
	}

	if (transfer.queueStatus === 'stalled') {
		if (isAttachmentStorageErrorMessage(transfer.error)) {
			return {
				state: 'failed',
				message: `${queuePrefix}Failed ${transfer.fileName} (insufficient storage).`
			};
		}

		if (isAttachmentNetworkErrorMessage(transfer.error)) {
			return {
				state: 'failed',
				message: `${queuePrefix}Interrupted ${transfer.fileName} (network). Retrying automatically.`
			};
		}

		return {
			state: 'failed',
			message: getNonEmptyStringOrFallback(transfer.error, `${queuePrefix}Upload paused for ${transfer.fileName}. Retrying automatically.`)
		};
	}

	if (transfer.state === 'failed') {
		if (isAttachmentStorageErrorMessage(transfer.error)) {
			return {
				state: 'failed',
				message: `${queuePrefix}Failed ${transfer.fileName} (insufficient storage).`
			};
		}

		return {
			state: 'failed',
			message: getNonEmptyStringOrFallback(transfer.error, `${queuePrefix}${transfer.fileName} failed.`)
		};
	}

	if ((transfer.retryCount ?? 0) > 0 && transfer.state === 'uploading' && transfer.phase !== 'sending') {
		if (transfer.phase === 'preparing' && percentage === 0) {
			return {
				state: 'uploading',
				message: `${queuePrefix}Resuming ${transfer.fileName}...`
			};
		}

		return {
			state: 'uploading',
			message: `${queuePrefix}Resuming ${transfer.fileName}... ${percentage}%`
		};
	}

	return {
		state: transfer.state === 'uploaded' ? 'uploaded' : 'uploading',
		message: getAttachmentTransferStatusMessage(transfer.fileName, {
			phase: transfer.phase,
			progress: transfer.progress
		}, options)
	};
};

export { getAttachmentStateTextColor };
export { getAttachmentContinuationHint, getAttachmentContinuationReminderMessage, getAttachmentContinuationReminderTitle };
export { getAttachmentForwardFailureMessage, getAttachmentForwardStartMessage, getAttachmentForwardSuccessMessage };
export { getAttachmentStorageFailureMessage };
export { getAttachmentTransferStatusMessage };
export { getAttachmentTransferFeedback };
export { getAttachmentUploadFailureMessage, getAttachmentUploadPartialFailureMessage, getAttachmentUploadSuccessMessage };
export { isAttachmentNetworkErrorMessage, isAttachmentStorageErrorMessage };
export { normalizeAttachmentTransferDisplayProgress };
export type { AttachmentTransferDisplayProgress, AttachmentTransferFeedback, AttachmentTransferFeedbackInput, AttachmentTransferPhase, AttachmentTransferStatusMessageOptions };