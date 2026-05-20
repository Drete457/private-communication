
import { getAttachmentContinuationHint } from '@/helpers/attachments';
import { RenderIf } from '@/helpers/render-conditional';

import { SmallGenericButton } from '@components/common/buttons/generic';

import OverlayShell from './overlay-shell';

import type { FC } from 'react';

type AttachmentUploadFailure = {
	fileName: string;
	reason: string;
};

interface AttachmentUploadDetailsModalProps {
	active: boolean;
	failedFiles: ReadonlyArray<AttachmentUploadFailure>;
	onClose: () => void;
}

const AttachmentUploadDetailsModal: FC<AttachmentUploadDetailsModalProps> = ({ active, failedFiles, onClose }) => (
	<RenderIf
		condition={active}
		then={
			<OverlayShell active={active} onClose={onClose} mode="sheet" surfaceClassName="w-full max-w-lg p-4 sm:p-6">
				<header className="mb-4 space-y-1">
					<h3 className="text-xl font-semibold text-white">Upload Failures</h3>
					<p className="text-sm text-primary-100/80">{getAttachmentContinuationHint('upload')}</p>
					<p className="text-xs text-white/60">{failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} need attention.</p>
				</header>
				<div className="max-h-[min(52dvh,24rem)] space-y-3 overflow-y-auto pr-1">
					{failedFiles.map(({ fileName, reason }) => (
						<div key={`${fileName}-${reason}`} className="rounded-2xl border border-red-400/20 bg-red-500/5 p-3">
							<p className="truncate text-sm font-semibold text-red-200">{fileName}</p>
							<p className="mt-1 text-sm text-gray-300">{reason}</p>
						</div>
					))}
				</div>
				<div className="mt-6 flex justify-end">
					<SmallGenericButton onClick={onClose} className="w-full sm:w-auto">
							Close
					</SmallGenericButton>
				</div>
			</OverlayShell>
		}
		otherwise={null}
	/>
);

export default AttachmentUploadDetailsModal;
export type { AttachmentUploadFailure };