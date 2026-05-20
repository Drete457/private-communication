
import type { IdentityPayload } from '@/crypto';
import type { StoredPeerKey } from '@/crypto/key-manager';
import type {
	AttachmentKind,
	AttachmentManifest,
	MessageAttachment,
	TransferQueueMessageDispatch,
	TransferQueueMeta,
	TransferQueueStatus,
	TransferQueueUiSource,
	TransferQueueUpload
	, DecryptedMessage, LinkPreviewRecord } from '@/types';

import type {
	BackupOutboxRecord,
	IdentityRecordPayload
} from './export';
import type {
	ManifestPayload,
	ParsedPrelude,
	PCBKClearHeader
} from '@private-communication/pcbk-core';

type BackupBatchPayload<T> = {
	items: T[];
};

type AttachmentMetaRecordPayload = {
	attachmentId: string;
	peerId: string | null;
	messageId: string | null;
	fileName: string;
	mimeType: string;
	size: number;
	kind: AttachmentKind | null;
	plaintextHashSha256: string | null;
	createdAt: number;
	updatedAt: number;
	lastAccessedAt: number;
	chunkSize: number;
	chunkCount: number;
};

type TransferQueueMetaRecordPayload = {
	id: string;
	recipientId: string;
	meta: TransferQueueMeta;
	upload: TransferQueueUpload | null;
	messageDispatch: TransferQueueMessageDispatch | null;
	uiSource: TransferQueueUiSource | null;
	attachment: MessageAttachment | null;
	manifest: AttachmentManifest | null;
	persistLocally: boolean;
	status: TransferQueueStatus;
	retryCount: number;
	createdAt: number;
	updatedAt: number;
	lastError: string | null;
	chunkSize: number;
	chunkCount: number;
};

type RemoteMediaMetaRecordPayload = {
	mediaId: string;
	url: string;
	mimeType: string;
	extension: string;
	isFavorite: boolean;
	sourceHost: string;
	peerId: string | null;
	messageId: string | null;
	createdAt: number;
	updatedAt: number;
	lastAccessedAt: number;
	expiresAt: number;
	chunkSize: number;
	chunkCount: number;
};

type ParsedChunkedBackupObject<TMeta> = {
	objectId: string;
	meta: TMeta;
	chunks: Uint8Array[];
	totalBytes: number;
};

type ParsedPcbkBackup = {
	prelude: ParsedPrelude;
	clearHeader: PCBKClearHeader;
	manifest: ManifestPayload;
	identity: IdentityPayload;
	peerKeys: StoredPeerKey[];
	messages: DecryptedMessage[];
	linkPreviews: LinkPreviewRecord[];
	outbox: BackupOutboxRecord[];
	attachments: Array<ParsedChunkedBackupObject<AttachmentMetaRecordPayload>>;
	transferQueue: Array<ParsedChunkedBackupObject<TransferQueueMetaRecordPayload>>;
	remoteMedia: Array<ParsedChunkedBackupObject<RemoteMediaMetaRecordPayload>>;
	totalRecordCount: number;
};

export type {
	AttachmentMetaRecordPayload,
	BackupBatchPayload,
	IdentityRecordPayload,
	ParsedChunkedBackupObject,
	ParsedPcbkBackup,
	RemoteMediaMetaRecordPayload,
	TransferQueueMetaRecordPayload
};