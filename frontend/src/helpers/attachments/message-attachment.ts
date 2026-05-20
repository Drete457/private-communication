import type { AttachmentManifest, MessageAttachment } from '@/types';

const toMessageAttachment = (manifest: AttachmentManifest): MessageAttachment => ({
	id: manifest.attachmentId,
	name: manifest.fileName,
	type: manifest.mimeType,
	size: manifest.totalSize,
	kind: manifest.kind,
	chunkCount: manifest.chunkCount,
	chunkSize: manifest.chunkSize,
	expiresAt: manifest.expiresAt,
	hashSha256: manifest.hashSha256,
	manifestSignature: manifest.signature
});

export { toMessageAttachment };