import type { AttachmentKind, DecryptedMessage, ReplyReference, ReplyAttachmentReference } from '@/types';

const REPLY_ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
	image: 'Image',
	video: 'Video',
	audio: 'Audio',
	document: 'Document',
	other: 'File'
};

const hasReplyMessageAttachments = (reply: DecryptedMessage | ReplyReference): reply is DecryptedMessage => 'attachments' in reply;

const hasReplyAttachmentReference = (reply: DecryptedMessage | ReplyReference): reply is ReplyReference => 'attachment' in reply;

const getReplyAttachmentLabel = (attachment?: ReplyAttachmentReference): string => {
	if (!attachment)
		return '';

	const kindLabel = attachment.kind ? REPLY_ATTACHMENT_KIND_LABELS[attachment.kind] : "File";

	if (attachment.count > 1)
		return `${kindLabel}: ${attachment.name} (+${attachment.count - 1})`;

	return `${kindLabel}: ${attachment.name}`;
};

const getReplyPreviewText = (reply?: ReplyReference | DecryptedMessage | null): string => {
	if (!reply)
		return '';

	if (reply.content.trim().length > 0)
		return reply.content;

	if (hasReplyMessageAttachments(reply) && reply.attachments && reply.attachments.length > 0) {
		const firstAttachment = reply.attachments[0];
		if (!firstAttachment)
			return '';

		return getReplyAttachmentLabel({
			name: firstAttachment.name,
			kind: firstAttachment.kind,
			count: reply.attachments.length
		});
	}

	if (hasReplyAttachmentReference(reply))
		return getReplyAttachmentLabel(reply.attachment);

	return '';
};

const createReplyReference = (message: DecryptedMessage): ReplyReference => {
	const firstAttachment = message.attachments?.[0];

	return {
		id: message.id,
		senderId: message.senderId,
		content: message.content,
		timestamp: message.timestamp,
		...(firstAttachment
			? {
				attachment: {
					name: firstAttachment.name,
					kind: firstAttachment.kind,
					count: message.attachments?.length ?? 1
				}
			}
			: {})
	};
};

const getReplyAuthorFallback = (peerDisplayName?: string): string => (
	peerDisplayName && peerDisplayName.length > 0 ? peerDisplayName : "Contact"
);

const replyAuthor = (senderId?: string, userId?: string | null, peerDisplayName?: string) => {
	let author = "";

	if (senderId === userId) 
		author = "You";

	if (senderId !== userId) 
		author = getReplyAuthorFallback(peerDisplayName);
  
	return author;
}

export { createReplyReference, getReplyAttachmentLabel, getReplyPreviewText, replyAuthor };