import { create } from 'zustand';

import type { TransferQueueStatus, TransferQueueUiSource } from '@/types';

type AttachmentTransferPhase = 'preparing' | 'encrypting' | 'uploading' | 'finalizing' | 'decrypting' | 'sending';
type AttachmentTransferUiState = 'uploading' | 'uploaded' | 'failed';

type AttachmentTransferSnapshot = {
	uploadId: string;
	recipientId: string;
	fileName: string;
	source: TransferQueueUiSource;
	queueStatus?: TransferQueueStatus | undefined;
	retryCount?: number | undefined;
	phase: AttachmentTransferPhase;
	progress: number;
	state: AttachmentTransferUiState;
	error?: string | undefined;
	updatedAt: number;
};

type AttachmentTransferStoreState = {
	transfers: Record<string, AttachmentTransferSnapshot>;
	upsertTransfer: (snapshot: Omit<AttachmentTransferSnapshot, 'updatedAt'>) => void;
	clearTransfer: (uploadId: string) => void;
};

const useAttachmentTransferStore = create<AttachmentTransferStoreState>((set) => ({
	transfers: {},
	upsertTransfer: (snapshot) => set((state) => ({
		transfers: {
			...state.transfers,
			[snapshot.uploadId]: {
				...snapshot,
				updatedAt: Date.now()
			}
		}
	})),
	clearTransfer: (uploadId) => set((state) => {
		const transfers = Object.fromEntries(
			Object.entries(state.transfers).filter(([id]) => id !== uploadId)
		);
		return { transfers };
	})
}));

export { useAttachmentTransferStore };
export type { AttachmentTransferPhase, AttachmentTransferSnapshot, AttachmentTransferUiState };