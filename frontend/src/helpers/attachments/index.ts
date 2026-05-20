export { getAttachmentErrorMessage } from './error-message';
export {
	getAttachmentEncryptionMetadataIncompleteMessage,
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
} from './error-message';
export { toMessageAttachment } from './message-attachment';
export { getAttachmentContinuationHint, getAttachmentContinuationReminderMessage, getAttachmentContinuationReminderTitle } from './status';
export { getAttachmentForwardFailureMessage, getAttachmentForwardStartMessage, getAttachmentForwardSuccessMessage } from './status';
export { getAttachmentStateTextColor } from './status';
export { getAttachmentStorageFailureMessage } from './status';
export { getAttachmentTransferFeedback } from './status';
export { getAttachmentTransferStatusMessage } from './status';
export { getAttachmentUploadFailureMessage, getAttachmentUploadPartialFailureMessage, getAttachmentUploadSuccessMessage } from './status';
export {
	countActiveAttachmentDownloads,
	countActiveAttachmentUploadTransfers,
	isAttachmentUploadTransferActive,
	shouldKeepScreenAwakeForAttachmentTransfers,
	useAttachmentTransferScreenWakeLock
} from './transfer-activity';
export { isAttachmentNetworkErrorMessage, isAttachmentStorageErrorMessage } from './status';
export { normalizeAttachmentTransferDisplayProgress } from './status';
export type { AttachmentTransferDisplayProgress, AttachmentTransferFeedback, AttachmentTransferFeedbackInput, AttachmentTransferPhase, AttachmentTransferStatusMessageOptions } from './status';