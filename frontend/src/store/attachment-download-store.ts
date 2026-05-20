import { create } from 'zustand';

type AttachmentDownloadSnapshot = {
	attachmentId: string;
	fileName: string;
	progress: number;
	updatedAt: number;
};

type AttachmentDownloadStoreState = {
	downloads: Record<string, AttachmentDownloadSnapshot>;
	upsertDownload: (snapshot: Omit<AttachmentDownloadSnapshot, 'updatedAt'>) => void;
	clearDownload: (attachmentId: string) => void;
	clearAllDownloads: () => void;
};

const useAttachmentDownloadStore = create<AttachmentDownloadStoreState>((set) => ({
	downloads: {},
	upsertDownload: (snapshot) => set((state) => ({
		downloads: {
			...state.downloads,
			[snapshot.attachmentId]: {
				...snapshot,
				updatedAt: Date.now()
			}
		}
	})),
	clearDownload: (attachmentId) => set((state) => {
		const downloads = Object.fromEntries(
			Object.entries(state.downloads).filter(([id]) => id !== attachmentId)
		);
		return { downloads };
	}),
	clearAllDownloads: () => set({ downloads: {} })
}));

export { useAttachmentDownloadStore };
export type { AttachmentDownloadSnapshot };
