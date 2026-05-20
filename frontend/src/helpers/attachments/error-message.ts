import { formatFileSize } from '@/helpers/media';
import type { AttachmentErrorCode, AttachmentErrorDetails } from '@/types';

const getAttachmentLocalStorageCapacityMessage = (): string => 'Not enough local storage space available for this attachment transfer.';

const getAttachmentManifestMismatchMessage = (): string => 'Attachment manifest does not match the signed metadata.';

const getAttachmentManifestSignatureMissingMessage = (): string => 'Attachment manifest signature is missing.';

const getAttachmentUserIdentityNotInitializedMessage = (): string => 'User identity not initialized.';

const getAttachmentSenderIdentityMismatchMessage = (): string => 'Attachment sender identity mismatch.';

const getAttachmentSignerKeyMissingMessage = (): string => 'Sender signing key not found for attachment verification.';

const getAttachmentManifestVerificationFailedMessage = (): string => 'Attachment manifest signature verification failed.';

const getAttachmentTransferCanceledMessage = (): string => 'Attachment transfer was canceled.';

const getAttachmentEncryptionMetadataIncompleteMessage = (): string => 'Attachment encryption metadata is incomplete.';

const getAttachmentManifestSignatureMismatchMessage = (): string => 'Attachment manifest signature mismatch.';

const getQueuedAttachmentTransferMetadataIncompleteMessage = (): string => 'Queued attachment transfer metadata is incomplete.';

const getAttachmentSigningKeysNotInitializedMessage = (): string => 'Signing keys not initialized.';

const getAttachmentIntegrityVerificationFailedMessage = (): string => 'Attachment integrity verification failed.';

const getAttachmentLocalAvailabilityMessage = (fileName: string): string => `Attachment ${fileName} is not available locally yet.`;

const getAttachmentErrorMessage = (code?: AttachmentErrorCode, details?: AttachmentErrorDetails, status?: number): string => {
	if (!code) {
		if (status === 0)
			return 'Unable to reach the server. Check your connection and try again.';

		if (status === 413) 
			return 'The file exceeds the allowed upload size.';

		return status ? `Request failed with status ${status}` : 'Attachment transfer failed.';
	}

	switch (code) {
		case 'ATTACHMENTS_DISABLED':
			return 'Attachments are currently disabled on the server.';
		case 'INVALID_FILE_METADATA':
			return 'The selected file metadata is invalid.';
		case 'UNAUTHORIZED':
			return 'Your session is not authorized for attachment transfer.';
		case 'RECIPIENT_NOT_ALLOWED':
			return 'This attachment cannot be accessed by the selected contact.';
		case 'UPLOAD_ALREADY_EXISTS':
			return 'This upload already exists.';
		case 'UPLOAD_NOT_FOUND':
			return 'The upload session was not found or expired.';
		case 'UPLOAD_INCOMPLETE':
			return `Upload is incomplete${details?.missingChunks ? `: ${details.missingChunks} chunk(s) are still missing.` : '.'}`;
		case 'FILE_TOO_LARGE_FILE':
			return `The file is too large. Maximum allowed size is ${formatFileSize(details?.maxBytes)}.`;
		case 'FILE_TOO_LARGE_AUDIO':
			return `The audio file is too large. Maximum allowed size is ${formatFileSize(details?.maxBytes)}.`;
		case 'FILE_TOO_LARGE_IMAGE':
			return `The image is too large. Maximum allowed size is ${formatFileSize(details?.maxBytes)}.`;
		case 'FILE_TOO_LARGE_VIDEO':
			return `The video is too large. Maximum allowed size is ${formatFileSize(details?.maxBytes)}.`;
		case 'FILE_TOO_LARGE_DOCUMENT':
			return `The document is too large. Maximum allowed size is ${formatFileSize(details?.maxBytes)}.`;
		case 'FILE_TYPE_NOT_ALLOWED':
			return details?.mimeType
				? `The file type ${details.mimeType} is not allowed by the server.`
				: 'This file type is not allowed by the server.';
		case 'ATTACHMENT_NOT_FOUND':
			return 'The file was not found or has expired.';
		case 'CHUNK_NOT_FOUND':
			return 'The file of this attachment is missing from the server.';
		case 'CHUNK_HASH_MISMATCH':
			return getAttachmentIntegrityVerificationFailedMessage();
		case 'RATE_LIMITED':
			return 'Attachment transfer was rate-limited. Please try again.';
		case 'UPLOAD_STORAGE_ERROR':
			return 'The server failed to store the attachment.';
		default:
			return 'Attachment transfer failed.';
	}
};

export {
	getAttachmentEncryptionMetadataIncompleteMessage,
	getAttachmentErrorMessage,
	getAttachmentIntegrityVerificationFailedMessage,
	getAttachmentLocalAvailabilityMessage,
	getAttachmentLocalStorageCapacityMessage,
	getAttachmentManifestMismatchMessage,
	getAttachmentManifestSignatureMismatchMessage,
	getAttachmentManifestSignatureMissingMessage,
	getAttachmentManifestVerificationFailedMessage,
	getAttachmentSenderIdentityMismatchMessage,
	getAttachmentSignerKeyMissingMessage,
	getAttachmentSigningKeysNotInitializedMessage,
	getAttachmentTransferCanceledMessage,
	getAttachmentUserIdentityNotInitializedMessage,
	getQueuedAttachmentTransferMetadataIncompleteMessage
};