import { useMemo } from 'react';

import { getAttachmentContinuationHint, getAttachmentTransferFeedback } from '@/helpers/attachments';
import { RenderIf } from '@/helpers/render-conditional';
import type { AttachmentTransferSnapshot} from '@/store/attachment-transfer-store';
import { useAttachmentTransferStore } from '@/store/attachment-transfer-store';

import type { FC} from 'react';

const getActiveTransfer = (transfers: Record<string, AttachmentTransferSnapshot>): AttachmentTransferSnapshot | null =>
	Object.values(transfers)
		.filter((transfer) => transfer.state !== 'uploaded')
		.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

const getMessage = (transfer: AttachmentTransferSnapshot | null) => {
	if (!transfer) return '';

	return getAttachmentTransferFeedback({
		fileName: transfer.fileName,
		phase: transfer.phase,
		progress: transfer.progress,
		state: transfer.state,
		queueStatus: transfer.queueStatus,
		retryCount: transfer.retryCount,
		error: transfer.error
	}).message;
}

const GlobalTransferBanner: FC = () => {
	const transfers = useAttachmentTransferStore((state) => state.transfers);
	const transfer = useMemo(() => getActiveTransfer(transfers), [transfers]);

	return (
		<RenderIf condition={Boolean(transfer)}
			then={
				<div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3 sm:px-4 md:top-4 md:px-6">
					<div
						className="max-w-3xl rounded-2xl border border-primary-400/30 bg-dark-200/92 px-4 py-2.5 text-center text-sm text-primary-100 shadow-lg backdrop-blur"
						aria-live="polite"
					>
						<p>{getMessage(transfer)}</p>
						<p className="mt-1 text-xs text-primary-100/75">{getAttachmentContinuationHint('upload')}</p>
					</div>
				</div>
			}
			otherwise={null}
		/>
	);
};

export default GlobalTransferBanner;