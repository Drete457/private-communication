import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getKeyPair: vi.fn()
}));

vi.mock('@/crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/crypto')>();

	return {
		...actual,
		getKeyPair: mocks.getKeyPair
	};
});

import { clearChatDraft, loadChatDraft, saveChatDraft } from '@/services/chat-draft-store';

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return Array.from(this.values.keys())[index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

const storage = new MemoryStorage();

const createEncryptionKeyPair = async (): Promise<CryptoKeyPair> => {
	return crypto.subtle.generateKey(
		{
			name: 'ECDH',
			namedCurve: 'P-256'
		},
		true,
		['deriveKey', 'deriveBits']
	);
};

describe('chat draft store', () => {
	beforeEach(() => {
		storage.clear();
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
			writable: true
		});
	});

	it('stores drafts encrypted and loads them back per chat', async () => {
		const keyPair = await createEncryptionKeyPair();
		mocks.getKeyPair.mockResolvedValue({
			publicKey: keyPair.publicKey,
			privateKey: keyPair.privateKey
		});

		await saveChatDraft({
			userId: 'user-alice',
			peerId: 'user-bob',
			draft: 'draft text for bob'
		});

		const raw = storage.getItem('pc-chat-draft:v1:user-alice:user-bob');
		expect(raw).not.toBeNull();
		expect(raw).not.toContain('draft text for bob');

		await expect(loadChatDraft({ userId: 'user-alice', peerId: 'user-bob' })).resolves.toBe('draft text for bob');
		await expect(loadChatDraft({ userId: 'user-alice', peerId: 'user-charlie' })).resolves.toBe('');
	});

	it('clears stored drafts', async () => {
		const keyPair = await createEncryptionKeyPair();
		mocks.getKeyPair.mockResolvedValue({
			publicKey: keyPair.publicKey,
			privateKey: keyPair.privateKey
		});

		await saveChatDraft({
			userId: 'user-alice',
			peerId: 'user-bob',
			draft: 'temporary draft'
		});
		await clearChatDraft({ userId: 'user-alice', peerId: 'user-bob' });

		expect(storage.getItem('pc-chat-draft:v1:user-alice:user-bob')).toBeNull();
		await expect(loadChatDraft({ userId: 'user-alice', peerId: 'user-bob' })).resolves.toBe('');
	});

	it('drops malformed encrypted drafts', async () => {
		const keyPair = await createEncryptionKeyPair();
		mocks.getKeyPair.mockResolvedValue({
			publicKey: keyPair.publicKey,
			privateKey: keyPair.privateKey
		});

		storage.setItem('pc-chat-draft:v1:user-alice:user-bob', JSON.stringify({
			version: 1,
			userId: 'user-alice',
			peerId: 'user-bob',
			updatedAt: Date.now(),
			iv: 'bad-iv',
			cipherText: 'bad-cipher'
		}));

		await expect(loadChatDraft({ userId: 'user-alice', peerId: 'user-bob' })).resolves.toBe('');
		expect(storage.getItem('pc-chat-draft:v1:user-alice:user-bob')).toBeNull();
	});
});