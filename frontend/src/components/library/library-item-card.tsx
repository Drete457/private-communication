
import { DeleteButton } from '@/components/common/buttons/delete';
import { SmallGenericButton } from '@/components/common/buttons/generic';
import { RenderIf } from '@/helpers/render-conditional';
import type { LibraryItemSource } from '@/services/library-service';

import type { FC } from 'react';

type LibraryItemCardProps = {
	id: string;
	label: string;
	metadata?: string | undefined;
	kindLabel?: string | undefined;
	source?: LibraryItemSource | undefined;
	attachmentId?: string | undefined;
	remoteMediaUrl?: string | undefined;
	peerLabel?: string | undefined;
	sourceLabel?: string | undefined;
	relativeTimeLabel?: string | undefined;
	absoluteTimeLabel?: string | undefined;
	sizeLabel?: string | undefined;
	primaryActionLabel: string;
	onPrimaryAction: () => void;
	onDelete: () => void;
	primaryActionDisabled: boolean;
	deleteDisabled: boolean;
	deleteAriaLabel: string;
	selectionMode?: boolean | undefined;
	isSelected?: boolean | undefined;
	onToggleSelection?: (() => void) | undefined;
	selectionDisabled?: boolean | undefined;
	selectionAriaLabel?: string | undefined;
};

const ignoreSelectionToggle = (): void => undefined;

const getSelectionAriaLabel = (
	selectionAriaLabel: string | undefined,
	isSelected: boolean,
	label: string
): string => (
	selectionAriaLabel && selectionAriaLabel.length > 0 ? selectionAriaLabel : `${isSelected ? 'Deselect' : 'Select'} ${label}`
);

const LibraryItemCard: FC<LibraryItemCardProps> = ({
	label,
	metadata,
	peerLabel,
	sourceLabel,
	relativeTimeLabel,
	absoluteTimeLabel,
	sizeLabel,
	primaryActionLabel,
	onPrimaryAction,
	onDelete,
	primaryActionDisabled,
	deleteDisabled,
	deleteAriaLabel,
	selectionMode = false,
	isSelected = false,
	onToggleSelection,
	selectionDisabled = false,
	selectionAriaLabel
}) => {
	const detailLine = metadata && metadata !== absoluteTimeLabel ? metadata : undefined;

	return (
		<div className={`app-panel-muted flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between ${isSelected
			? 'border-primary-300/28 bg-primary-500/10 shadow-[0_16px_40px_rgba(8,145,178,0.14)]'
			: ''}`.trim()}>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-white" title={label}>
					<span className="sm:hidden wrap-break-word">{label}</span>
					<span className="hidden wrap-break-word sm:block sm:truncate">{label}</span>
				</p>
				<div className="mt-2 flex flex-wrap gap-2 text-[0.68rem]">
					{peerLabel ? <span className="rounded-full border border-primary-300/20 bg-primary-400/10 px-2.5 py-1 font-semibold text-primary-50">{peerLabel}</span> : null}
					{sourceLabel ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-medium text-white/60">{sourceLabel}</span> : null}
					{relativeTimeLabel ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-medium text-white/68" title={absoluteTimeLabel}>{relativeTimeLabel}</span> : null}
					{absoluteTimeLabel ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-medium text-white/60">{absoluteTimeLabel}</span> : null}
					{sizeLabel ? <span className="rounded-full border border-cyan-300/18 bg-cyan-400/10 px-2.5 py-1 font-semibold text-cyan-50">{sizeLabel}</span> : null}
				</div>
				{detailLine ? <p className="mt-2 text-xs wrap-break-word text-white/50 sm:truncate">{detailLine}</p> : null}
			</div>
			<div className="flex items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
				<SmallGenericButton
					onClick={onPrimaryAction}
					disabled={primaryActionDisabled}
					className="min-w-0 flex-1 sm:flex-none sm:w-auto"
				>
					{primaryActionLabel}
				</SmallGenericButton>
				<RenderIf condition={selectionMode}
					then={
						<SmallGenericButton
							onClick={onToggleSelection ?? ignoreSelectionToggle}
							disabled={selectionDisabled}
							aria-pressed={isSelected}
							aria-label={getSelectionAriaLabel(selectionAriaLabel, isSelected, label)}
							className={`min-w-0 flex-1 sm:flex-none sm:w-auto ${isSelected
								? 'border-primary-300/36 bg-primary-500/18 text-primary-50 enabled:hover:border-primary-200/48 enabled:hover:bg-primary-500/24'
								: 'border-white/10 bg-white/5 text-white/72 enabled:hover:border-white/20 enabled:hover:bg-white/8'}`.trim()}
						>
							{isSelected ? 'Selected' : 'Select'}
						</SmallGenericButton>
					}
					otherwise={
						<DeleteButton
							onClick={onDelete}
							disabled={deleteDisabled}
							ariaLabel={deleteAriaLabel}
						/>
					}
				/>
			</div>
		</div>
	);
};

export default LibraryItemCard;
export type { LibraryItemCardProps };