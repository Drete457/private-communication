import { useEffect, useRef, useState } from 'react';

import { DeleteButton } from '@/components/common/buttons/delete';
import { SmallGenericButton } from '@/components/common/buttons/generic';
import { RenderIf } from '@/helpers/render-conditional';
import { getLocalAttachment } from '@/services/attachment-local-store';
import { getOrFetchRemoteMedia } from '@/services/remote-media-cache';

import type { LibraryItemCardProps } from './library-item-card';
import type { FC} from 'react';

const ignoreSelectionToggle = (): void => undefined;

const getLibraryMediaKindLabel = (kindLabel: string | undefined): string => (
	kindLabel && kindLabel.length > 0 ? kindLabel : 'Media'
);

const getSelectionAriaLabel = (
	selectionAriaLabel: string | undefined,
	isSelected: boolean,
	label: string
): string => (
	selectionAriaLabel && selectionAriaLabel.length > 0 ? selectionAriaLabel : `${isSelected ? 'Deselect' : 'Select'} ${label}`
);

const LibraryMediaCard: FC<LibraryItemCardProps> = ({
	id,
	label,
	metadata,
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
	selectionAriaLabel,
	kindLabel,
	source,
	attachmentId,
	remoteMediaUrl,
	peerLabel,
	sourceLabel,
	relativeTimeLabel,
	absoluteTimeLabel,
	sizeLabel
}) => {
	const objectUrlRef = useRef<string | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewFailed, setPreviewFailed] = useState<boolean>(false);

	useEffect(() => {
		let cancelled = false;

		const clearPreviewUrl = () => {
			if (objectUrlRef.current) {
				URL.revokeObjectURL(objectUrlRef.current);
				objectUrlRef.current = null;
			}
		};

		const fetchPreview = async () => {
			try {
				if (source === 'local-attachment' && attachmentId) {
					const record = await getLocalAttachment(attachmentId);
					if (!record)
						throw new Error('Local preview unavailable');

					if (cancelled)
						return;

					objectUrlRef.current = URL.createObjectURL(record.blob);
					setPreviewFailed(false);
					setPreviewUrl(objectUrlRef.current);
					return;
				}

				if (source === 'remote-media' && remoteMediaUrl) {
					const record = await getOrFetchRemoteMedia(remoteMediaUrl);
					if (cancelled)
						return;

					objectUrlRef.current = URL.createObjectURL(record.blob);
					setPreviewFailed(false);
					setPreviewUrl(objectUrlRef.current);
					return;
				}

				throw new Error('Unsupported preview source');
			} catch {
				if (!cancelled) {
					setPreviewUrl(null);
					setPreviewFailed(true);
				}
			}
		};

		void fetchPreview();

		return () => {
			cancelled = true;
			clearPreviewUrl();
		};
	}, [attachmentId, remoteMediaUrl, source, id]);

	return (
		<div className={`app-panel-muted overflow-hidden ${isSelected
			? 'border-primary-300/28 bg-primary-500/10 shadow-[0_18px_42px_rgba(8,145,178,0.18)]'
			: ''}`.trim()}>
			<div className="relative flex aspect-4/5 flex-col justify-between border-b border-white/8 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_36%),linear-gradient(180deg,rgba(19,33,56,0.92),rgba(10,18,33,0.96))] p-4">
				<RenderIf
					condition={previewUrl !== null}
					then={<img src={previewUrl ?? undefined} alt={label} className="absolute inset-0 h-full w-full object-cover object-center" />}
					otherwise={null}
				/>
				<div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,20,0.18),rgba(5,10,20,0.24)_38%,rgba(5,10,20,0.82))]" />
				<RenderIf
					condition={previewFailed}
					then={<div className="absolute inset-x-4 top-16 rounded-2xl border border-white/10 bg-dark-400/70 px-3 py-2 text-xs text-white/62">Preview unavailable</div>}
					otherwise={null}
				/>
				<div className="relative flex flex-wrap gap-2">
					<div className="inline-flex w-fit rounded-full border border-white/10 bg-dark-400/45 px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/72 backdrop-blur-sm">
						{getLibraryMediaKindLabel(kindLabel)}
					</div>
					{peerLabel ? <div className="inline-flex w-fit rounded-full border border-primary-300/24 bg-[rgba(8,19,32,0.82)] px-2.5 py-1 text-[0.64rem] font-semibold text-primary-50 shadow-[0_8px_20px_rgba(0,0,0,0.28)] backdrop-blur-md">{peerLabel}</div> : null}
				</div>
				<div className="relative">
					<RenderIf condition={relativeTimeLabel !== undefined}
						then={
							<span className="inline-flex rounded-full border border-white/10 bg-dark-400/45 px-2.5 py-1 text-[0.68rem] font-medium text-white/72 backdrop-blur-sm sm:hidden" title={absoluteTimeLabel}>{relativeTimeLabel}</span>
						}
						otherwise={null}
					/>
					<div className="hidden sm:block">
						<p className="wrap-break-word text-base font-semibold leading-snug text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]" title={label}>{label}</p>
						<div className="mt-2 flex flex-wrap gap-2 text-[0.68rem]">
							{sourceLabel ? <span className="rounded-full border border-white/10 bg-dark-400/45 px-2.5 py-1 font-medium text-white/72 backdrop-blur-sm">{sourceLabel}</span> : null}
							{relativeTimeLabel ? <span className="rounded-full border border-white/10 bg-dark-400/45 px-2.5 py-1 font-medium text-white/72 backdrop-blur-sm" title={absoluteTimeLabel}>{relativeTimeLabel}</span> : null}
							{absoluteTimeLabel ? <span className="rounded-full border border-white/10 bg-dark-400/45 px-2.5 py-1 font-medium text-white/72 backdrop-blur-sm">{absoluteTimeLabel}</span> : null}
							{sizeLabel ? <span className="rounded-full border border-cyan-300/18 bg-cyan-400/14 px-2.5 py-1 font-semibold text-cyan-50 backdrop-blur-sm">{sizeLabel}</span> : null}
						</div>
					</div>
					{metadata && metadata !== absoluteTimeLabel ? <p className="mt-2 hidden wrap-break-word text-xs leading-relaxed text-white/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:block">{metadata}</p> : null}
				</div>
			</div>
			<div className={`p-3 ${selectionMode
				? 'flex flex-col gap-2 sm:flex-row sm:items-center'
				: 'flex items-center gap-2'}`.trim()}>
				<SmallGenericButton
					onClick={onPrimaryAction}
					disabled={primaryActionDisabled}
					className={`min-w-0 ${selectionMode ? 'w-full sm:flex-1' : 'flex-1'}`.trim()}
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
							className={`w-full sm:min-w-23 sm:w-auto ${isSelected
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

export default LibraryMediaCard;