import { getAttachmentLocalAvailabilityMessage, normalizeAttachmentTransferDisplayProgress } from '@/helpers/attachments';
import type { DecryptedMessage, MessageAttachment } from '@/types';
import { AttachmentType } from '@/types';

import { getLocalAttachment } from './attachment-local-store';
import { downloadAttachment, uploadAttachment } from './attachment-upload-service';
import { extractFirstDirectRemoteMediaUrl } from './remote-media-cache';

type ForwardAttachmentProgress = {
	fileName: string;
	phase: 'preparing' | 'encrypting' | 'uploading' | 'finalizing' | 'sending';
	progress: number;
};

type ForwardAttachmentOptions = {
	message: DecryptedMessage;
	targetPeerId: string;
	userId: string;
	forwardedContent: string;
	onProgress?: (progress: ForwardAttachmentProgress) => void;
};

const getForwardedMessageContent = (message: DecryptedMessage): string => {
	const trimmedContent = message.content.trim();
	if (trimmedContent.length === 0)
		return '';

	const directRemoteMediaUrl = extractFirstDirectRemoteMediaUrl(trimmedContent);
	if (directRemoteMediaUrl && trimmedContent === directRemoteMediaUrl)
		return directRemoteMediaUrl;

	return `↪ Forward:\n ${message.content}`;
};

const resolveForwardSourcePeerId = (message: DecryptedMessage, userId: string): string => message.senderId === userId
	? message.recipientId
	: message.senderId;

const resolveForwardLocalAttachmentId = (attachment: MessageAttachment): string => (
	attachment.localReferenceId && attachment.localReferenceId.length > 0 ? attachment.localReferenceId : attachment.id
);

const getMessageAttachments = (message: DecryptedMessage): ReadonlyArray<MessageAttachment> => (
	message.attachments ?? []
);

const createForwardFile = async (message: DecryptedMessage, attachment: MessageAttachment, userId: string): Promise<{ file: File; localAttachmentId: string; }> => {
	const localAttachmentId = resolveForwardLocalAttachmentId(attachment);
	let localRecord = await getLocalAttachment(localAttachmentId);

	if (!localRecord) {
		await downloadAttachment(attachment, undefined, {
			peerId: resolveForwardSourcePeerId(message, userId),
			messageId: message.id
		});
		localRecord = await getLocalAttachment(localAttachmentId);
	}

	if (!localRecord)
		throw new Error(getAttachmentLocalAvailabilityMessage(attachment.name));

	return {
		localAttachmentId,
		file: new File([localRecord.blob], localRecord.fileName, {
			type: localRecord.mimeType,
			lastModified: localRecord.updatedAt
		})
	};
};

const forwardMessageAttachments = async ({ message, targetPeerId, userId, forwardedContent, onProgress }: ForwardAttachmentOptions): Promise<MessageAttachment[]> => {
	const forwardedAttachments: MessageAttachment[] = [];
	const messageAttachments = getMessageAttachments(message);
	const shouldAutoSendSingleAttachment = messageAttachments.length === 1;

	for (const attachment of messageAttachments) {
		onProgress?.({
			fileName: attachment.name,
			phase: 'preparing',
			progress: 0
		});

		const { file, localAttachmentId } = await createForwardFile(message, attachment, userId);
		const { attachment: uploadedAttachment } = await uploadAttachment(targetPeerId, file, (progress) => {
			if (progress.phase === 'decrypting')
				return;

			const displayProgress = normalizeAttachmentTransferDisplayProgress({
				phase: progress.phase,
				progress: progress.progress
			});

			onProgress?.({
				fileName: file.name,
				phase: displayProgress.phase,
				progress: displayProgress.progress
			});
		}, {
			persistLocally: false,
			uiSource: AttachmentType.forward,
			localReferenceId: localAttachmentId,
			messageDispatch: shouldAutoSendSingleAttachment
				? { content: forwardedContent }
				: undefined
		});

		forwardedAttachments.push({
			...uploadedAttachment,
			localReferenceId: localAttachmentId
		});
	}

	return forwardedAttachments;
};

export { forwardMessageAttachments, getForwardedMessageContent };
export type { ForwardAttachmentProgress, ForwardAttachmentOptions };