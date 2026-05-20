import {
	decryptMessage,
	deriveSharedKey,
	encryptMessage,
	getKeyPair
} from '@/crypto';

type ChatDraftScope = {
	userId: string;
	peerId: string;
};

type SaveChatDraftInput = ChatDraftScope & {
	draft: string;
};

type StoredEncryptedChatDraft = {
	version: 1;
	userId: string;
	peerId: string;
	updatedAt: number;
	iv: string;
	cipherText: string;
};

type StoredEncryptedChatDraftRecord = Record<string, unknown> & Partial<Record<keyof StoredEncryptedChatDraft, unknown>>;

const CHAT_DRAFT_STORAGE_PREFIX = 'pc-chat-draft:v1';

const isStoredEncryptedChatDraftRecord = (value: unknown): value is StoredEncryptedChatDraftRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return false;

	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const getStorage = (): Storage | null => {
	if (typeof globalThis.localStorage === 'undefined')
		return null;

	return globalThis.localStorage;
};

const getChatDraftStorageKey = ({ userId, peerId }: ChatDraftScope): string => {
	return `${CHAT_DRAFT_STORAGE_PREFIX}:${userId}:${peerId}`;
};

const parseStoredDraft = (raw: string): StoredEncryptedChatDraft | null => {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isStoredEncryptedChatDraftRecord(parsed))
			return null;

		if (parsed.version !== 1)
			return null;
		if (typeof parsed.userId !== 'string' || typeof parsed.peerId !== 'string')
			return null;
		if (typeof parsed.updatedAt !== 'number' || !Number.isSafeInteger(parsed.updatedAt) || parsed.updatedAt < 0)
			return null;
		if (typeof parsed.iv !== 'string' || typeof parsed.cipherText !== 'string')
			return null;

		return {
			version: 1,
			userId: parsed.userId,
			peerId: parsed.peerId,
			updatedAt: parsed.updatedAt,
			iv: parsed.iv,
			cipherText: parsed.cipherText
		};
	} catch {
		return null;
	}
};

const getDraftEncryptionKey = async (): Promise<CryptoKey | null> => {
	const encryptionKeyPair = await getKeyPair('encryption');
	if (!encryptionKeyPair)
		return null;

	return deriveSharedKey(encryptionKeyPair.privateKey, encryptionKeyPair.publicKey);
};

const clearChatDraft = (scope: ChatDraftScope): void => {
	const storage = getStorage();
	if (!storage)
		return;

	storage.removeItem(getChatDraftStorageKey(scope));
};

const loadChatDraft = async (scope: ChatDraftScope): Promise<string> => {
	const storage = getStorage();
	if (!storage)
		return '';

	const storageKey = getChatDraftStorageKey(scope);
	const raw = storage.getItem(storageKey);
	if (!raw)
		return '';

	const storedDraft = parseStoredDraft(raw);
	if (storedDraft?.userId !== scope.userId || storedDraft.peerId !== scope.peerId) {
		storage.removeItem(storageKey);
		return '';
	}

	const encryptionKey = await getDraftEncryptionKey();
	if (!encryptionKey)
		return '';

	try {
		return await decryptMessage(storedDraft.iv, storedDraft.cipherText, encryptionKey);
	} catch {
		storage.removeItem(storageKey);
		return '';
	}
};

const saveChatDraft = async ({ draft, ...scope }: SaveChatDraftInput): Promise<void> => {
	const storage = getStorage();
	if (!storage)
		return;

	const storageKey = getChatDraftStorageKey(scope);
	if (draft.length === 0) {
		storage.removeItem(storageKey);
		return;
	}

	const encryptionKey = await getDraftEncryptionKey();
	if (!encryptionKey)
		return;

	const encryptedDraft = await encryptMessage(draft, encryptionKey);
	const payload: StoredEncryptedChatDraft = {
		version: 1,
		userId: scope.userId,
		peerId: scope.peerId,
		updatedAt: Date.now(),
		iv: encryptedDraft.iv,
		cipherText: encryptedDraft.cipherText
	};

	storage.setItem(storageKey, JSON.stringify(payload));
};

export {
	clearChatDraft,
	loadChatDraft,
	saveChatDraft
};
export type {
	ChatDraftScope,
	SaveChatDraftInput
};