type PCBKMode = 'identity-only' | 'full';

type PCBKRecordType =
	| 'identity'
	| 'peer-keys-batch'
	| 'messages-batch'
	| 'link-previews-batch'
	| 'outbox-batch'
	| 'attachment-meta'
	| 'attachment-chunk'
	| 'transfer-queue-meta'
	| 'transfer-queue-chunk'
	| 'remote-media-meta'
	| 'remote-media-chunk'
	| 'manifest';

type PCBKRecordEncoding = 'cbor' | 'bytes';

type Argon2ProfileName = 'recommended-standard' | 'minimum-acceptable' | 'controlled-fallback';

type Argon2Profile = {
	name: Argon2ProfileName;
	memoryKiB: number;
	iterations: number;
	parallelism: 1;
	hashLength: 32;
	saltLength: 16;
};

type PassphraseValidationResult = {
	valid: boolean;
	errors: string[];
	normalizedPassphrase: string;
};

type GeneratedPassphraseResult = {
	standard: 'bip39';
	language: 'english';
	wordCount: 12;
	words: string[];
	value: string;
};

type DeriveRootKeyInput = {
	passphrase: string;
	salt: Uint8Array;
	memoryKiB: number;
	iterations: number;
	parallelism: number;
	hashLength?: number;
};

type DeriveSubkeyInput = {
	rootKey: Uint8Array;
	info: string;
	length: number;
	salt?: Uint8Array;
};

type BuildClearHeaderInput = {
	mode: PCBKMode;
	createdAt: number;
	backupId: Uint8Array;
	kdfProfile: Argon2Profile;
	salt: Uint8Array;
	wrapIv: Uint8Array;
	noncePrefix: Uint8Array;
	wrappedContentKey: Uint8Array;
};

type BuildKeyWrapAadInput = Omit<BuildClearHeaderInput, 'wrappedContentKey'>;

type BuildClearHeaderResult = {
	clearHeaderBytes: Uint8Array;
};

type ParsedPrelude = {
	magic: string;
	formatVersion: number;
	flags: number;
	clearHeaderLength: number;
	clearHeaderBytes: Uint8Array;
	headerAuthTag: Uint8Array;
	preludeLength: number;
};

type PCBKClearHeaderKdf = {
	algorithm: 'argon2id';
	version: 19;
	salt: Uint8Array;
	memoryKiB: number;
	iterations: number;
	parallelism: number;
	outputLength: 32;
};

type PCBKClearHeaderHkdf = {
	algorithm: 'HKDF-SHA-256';
};

type PCBKClearHeaderKeyWrap = {
	algorithm: 'AES-GCM-256';
	iv: Uint8Array;
	wrappedContentKey: Uint8Array;
};

type PCBKClearHeaderRecordCipher = {
	algorithm: 'AES-GCM-256';
	noncePrefix: Uint8Array;
	tagLengthBits: 128;
};

type PCBKClearHeaderManifestPolicy = {
	required: true;
	mustBeFinalRecord: true;
};

type PCBKClearHeader = {
	headerVersion: 1;
	mode: PCBKMode;
	createdAt: number;
	backupId: Uint8Array;
	kdf: PCBKClearHeaderKdf;
	hkdf: PCBKClearHeaderHkdf;
	keyWrap: PCBKClearHeaderKeyWrap;
	recordCipher: PCBKClearHeaderRecordCipher;
	manifest: PCBKClearHeaderManifestPolicy;
};

type AuthenticateHeaderInput = {
	rootKey: Uint8Array;
	magic: string;
	formatVersion: number;
	flags: number;
	clearHeaderBytes: Uint8Array;
};

type VerifyHeaderAuthenticationInput = AuthenticateHeaderInput & {
	headerAuthTag: Uint8Array;
};

type WrapContentKeyInput = {
	rootKey: Uint8Array;
	contentKey: Uint8Array;
	keyWrapAadHeaderBytes: Uint8Array;
	iv: Uint8Array;
};

type WrappedContentKeyResult = {
	wrappedContentKey: Uint8Array;
};

type UnwrapContentKeyInput = {
	rootKey: Uint8Array;
	clearHeader: PCBKClearHeader;
	magic: string;
	formatVersion: number;
	flags: number;
};

type UnwrappedContentKeyResult = {
	contentKey: Uint8Array;
};

type PCBKRecordHeader = {
	recordVersion: 1;
	type: PCBKRecordType;
	index: number;
	encoding: PCBKRecordEncoding;
	plainLength: number;
	cipherLength: number;
	objectId?: string;
	chunkIndex?: number;
	chunkCount?: number;
};

type BuildRecordHeaderInput = Omit<PCBKRecordHeader, 'recordVersion'> & {
	recordVersion: number;
};

type EncryptRecordInput = {
	contentKey: CryptoKey | Uint8Array;
	nonce: Uint8Array;
	headerBytes: Uint8Array;
	payloadBytes: Uint8Array;
};

type EncryptedRecord = {
	headerBytes: Uint8Array;
	ciphertext: Uint8Array;
};

type DecryptRecordInput = {
	contentKey: CryptoKey | Uint8Array;
	nonce: Uint8Array;
	headerBytes: Uint8Array;
	ciphertext: Uint8Array;
};

type DecryptedRecord = {
	headerBytes: Uint8Array;
	payloadBytes: Uint8Array;
};

type ManifestSummary = {
	backupId: Uint8Array;
	mode: PCBKMode;
	createdAt: number;
	totalRecordCount: number;
};

type ManifestCounts = {
	peerKeys: number;
	messages: number;
	linkPreviews: number;
	outbox: number;
	attachments: number;
	attachmentChunks: number;
	transferQueue: number;
	transferQueueChunks: number;
	remoteMedia: number;
	remoteMediaChunks: number;
};

type ManifestObjectEntry = {
	objectId: string;
	chunkCount: number;
	size: number;
};

type ManifestObjects = {
	attachments: ManifestObjectEntry[];
	transferQueue: ManifestObjectEntry[];
	remoteMedia: ManifestObjectEntry[];
};

type ManifestPayload = ManifestSummary & {
	counts: ManifestCounts;
	objects: ManifestObjects;
};

export type {
	Argon2Profile,
	Argon2ProfileName,
	AuthenticateHeaderInput,
	BuildClearHeaderInput,
	BuildClearHeaderResult,
	BuildKeyWrapAadInput,
	BuildRecordHeaderInput,
	DecryptRecordInput,
	DecryptedRecord,
	DeriveRootKeyInput,
	DeriveSubkeyInput,
	EncryptedRecord,
	EncryptRecordInput,
	GeneratedPassphraseResult,
	ManifestCounts,
	PCBKClearHeader,
	PCBKClearHeaderHkdf,
	PCBKClearHeaderKdf,
	PCBKClearHeaderKeyWrap,
	PCBKClearHeaderManifestPolicy,
	PCBKClearHeaderRecordCipher,
	ManifestObjectEntry,
	ManifestObjects,
	ManifestPayload,
	ManifestSummary,
	ParsedPrelude,
	PassphraseValidationResult,
	PCBKMode,
	PCBKRecordEncoding,
	PCBKRecordHeader,
	PCBKRecordType,
	UnwrapContentKeyInput,
	UnwrappedContentKeyResult,
	VerifyHeaderAuthenticationInput,
	WrapContentKeyInput,
	WrappedContentKeyResult
};