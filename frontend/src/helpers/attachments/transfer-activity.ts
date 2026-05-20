import { useScreenWakeLock } from '@/helpers/media/use-screen-wake-lock';
import { useAttachmentDownloadStore  } from '@/store/attachment-download-store';
import type {AttachmentDownloadSnapshot} from '@/store/attachment-download-store';
import { useAttachmentTransferStore   } from '@/store/attachment-transfer-store';
import type {AttachmentTransferSnapshot, AttachmentTransferUiState} from '@/store/attachment-transfer-store';

type AttachmentTransferSnapshots = Record<string, AttachmentTransferSnapshot>;
type AttachmentDownloadSnapshots = Record<string, AttachmentDownloadSnapshot>;

const isAttachmentUploadTransferActive = (transferState: AttachmentTransferUiState): boolean => (
	transferState !== 'uploaded' && transferState !== 'failed'
);

const countActiveAttachmentUploadTransfers = (transfers: AttachmentTransferSnapshots): number => (
	Object.values(transfers)
		.filter((transfer) => isAttachmentUploadTransferActive(transfer.state))
		.length
);

const countActiveAttachmentDownloads = (downloads: AttachmentDownloadSnapshots): number => (
	Object.keys(downloads).length
);

const shouldKeepScreenAwakeForAttachmentTransfers = (
	activeAttachmentUploadTransferCount: number,
	activeAttachmentDownloadCount: number
): boolean => activeAttachmentUploadTransferCount > 0 || activeAttachmentDownloadCount > 0;

const useAttachmentTransferScreenWakeLock = (): void => {
	const activeAttachmentUploadTransferCount = useAttachmentTransferStore((state) => countActiveAttachmentUploadTransfers(state.transfers));
	const activeAttachmentDownloadCount = useAttachmentDownloadStore((state) => countActiveAttachmentDownloads(state.downloads));
	const shouldKeepScreenAwake = shouldKeepScreenAwakeForAttachmentTransfers(
		activeAttachmentUploadTransferCount,
		activeAttachmentDownloadCount
	);

	useScreenWakeLock({ isActive: shouldKeepScreenAwake });
};

export {
	countActiveAttachmentDownloads,
	countActiveAttachmentUploadTransfers,
	isAttachmentUploadTransferActive,
	shouldKeepScreenAwakeForAttachmentTransfers,
	useAttachmentTransferScreenWakeLock
};