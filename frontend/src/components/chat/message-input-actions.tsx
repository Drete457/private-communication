import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';


import { Close, GifSticker, Plus } from '@/assets';
import { OverlayShell } from '@/components/common/modal';
import { isMobileDevice } from '@/helpers/navigation';
import { RenderIf } from '@/helpers/render-conditional';
import { getAttachmentPoliciesSnapshot, subscribeAttachmentPolicies } from '@/services/attachment-policy';
import type { AttachmentKind, AttachmentPolicy, AttachmentSelection, AttachmentSelectionResult, AttachmentState } from '@/types';

import { SmallGenericButton } from '@components/common/buttons/generic';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, FC, ChangeEvent, ReactNode } from 'react';

const ATTACHMENT_ACTION_ORDER: AttachmentKind[] = ['image', 'video', 'audio', 'document', 'other'];

const ATTACHMENT_ACTION_COPY: Record<AttachmentKind, { label: string; description: string; badge: string }> = {
	audio: {
		label: 'Audio',
		description: 'Voice notes, music, and audio clips.',
		badge: 'AU'
	},
	image: {
		label: 'Images',
		description: 'Photos, screenshots, and other images.',
		badge: 'IM'
	},
	video: {
		label: 'Videos',
		description: 'Clips and recordings allowed by the server.',
		badge: 'VI'
	},
	document: {
		label: 'Documents',
		description: 'PDF, text, archives, and office files.',
		badge: 'DOC'
	},
	other: {
		label: 'Files',
		description: 'Other file types currently accepted by the server.',
		badge: 'FILE'
	}
};

const buildFileInputAccept = (mimeRules: ReadonlyArray<string>): string => Array.from(new Set(mimeRules.map((rule) => rule.endsWith('/') ? `${rule}*` : rule))).join(',');

const shouldUseCompactActionSheet = (): boolean => {
	if (typeof window === 'undefined' || typeof navigator === 'undefined')
		return false;

	return isMobileDevice() && window.matchMedia('(max-width: 640px), (max-height: 760px)').matches;
};

type AttachmentActionOption = {
	key: string;
	label: string;
	description: string;
	badge: string;
	onSelect: () => void;
	icon?: ReactNode;
};

interface MessageInputActionsProps {
	onAttachFiles?: ((files: AttachmentSelection) => Promise<AttachmentSelectionResult | undefined> | AttachmentSelectionResult | undefined) | undefined;
	onOpenRecentGifs?: (() => void) | undefined;
	disabled?: boolean | undefined;
	attachmentState?: AttachmentState | undefined;
}

const MessageInputActions: FC<MessageInputActionsProps> = ({
	onAttachFiles,
	onOpenRecentGifs,
	disabled,
	attachmentState
}) => {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const actionMenuRef = useRef<HTMLDivElement>(null);
	const [actionMenuOpen, setActionMenuOpen] = useState(false);
	const [useCompactActionSheet, setUseCompactActionSheet] = useState<boolean>(() => shouldUseCompactActionSheet());
	const attachmentPolicies = useSyncExternalStore(subscribeAttachmentPolicies, getAttachmentPoliciesSnapshot, getAttachmentPoliciesSnapshot);

	const keepInputFocus = (event: ReactMouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
	};

	const handleAttach = useCallback((policy: AttachmentPolicy) => {
		if (!onAttachFiles || disabled)
			return;

		setActionMenuOpen(false);

		const input = fileInputRef.current;
		if (!input)
			return;

		input.accept = buildFileInputAccept(policy.mimeRules);
		input.click();
	}, [disabled, onAttachFiles]);

	const handleOpenRecentGifs = useCallback(() => {
		if (!onOpenRecentGifs || disabled)
			return;

		setActionMenuOpen(false);
		onOpenRecentGifs();
	}, [disabled, onOpenRecentGifs]);

	const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0 || !onAttachFiles) {
			event.target.value = '';
			event.target.accept = '';
			return;
		}

		await onAttachFiles(files);
		event.target.value = '';
		event.target.accept = '';
	};

	const actionOptions = useMemo<AttachmentActionOption[]>(() => {
		const attachmentOptions: AttachmentActionOption[] = [];

		if (onAttachFiles) {
			for (const kind of ATTACHMENT_ACTION_ORDER) {
				const policy = attachmentPolicies.find((candidate) => candidate.kind === kind);
				if (!policy)
					continue;

				const copy = ATTACHMENT_ACTION_COPY[kind];
				attachmentOptions.push({
					key: `attachment-${kind}`,
					label: copy.label,
					description: copy.description,
					badge: copy.badge,
					onSelect: () => handleAttach(policy)
				});
			}
		}

		const options = [...attachmentOptions];

		if (onOpenRecentGifs) {
			options.push({
				key: 'gif-library',
				label: 'GIFs',
				description: 'Open recent and favorite GIFs cached in this browser.',
				badge: 'GIF',
				onSelect: handleOpenRecentGifs,
				icon: <GifSticker />
			});
		}

		return options;
	}, [attachmentPolicies, handleAttach, handleOpenRecentGifs, onAttachFiles, onOpenRecentGifs]);

	const renderActionOptions = useCallback((compactLayout: boolean) => actionOptions.map((option) => (
		<button
			type="button"
			key={option.key}
			onClick={option.onSelect}
			className={`flex w-full items-start gap-3 px-3 text-left transition-colors hover:bg-white/6 ${compactLayout ? 'rounded-2xl py-3' : 'rounded-xl py-2.5'}`}
		>
			<div className={`${compactLayout ? 'h-11 w-11 rounded-2xl' : 'h-10 w-10 rounded-xl'} flex shrink-0 items-center justify-center overflow-hidden border border-primary-400/20 bg-primary-500/14 text-[0.65rem] font-semibold tracking-wide text-white`}>
				{option.icon ?? option.badge}
			</div>
			<div className="min-w-0">
				<p className={`${compactLayout ? 'text-[0.95rem]' : 'text-sm'} font-medium text-white`}>{option.label}</p>
				<p className="app-text-muted text-xs">{option.description}</p>
			</div>
		</button>
	)), [actionOptions]);

	useEffect(() => {
		const syncActionMenuLayout = () => {
			setUseCompactActionSheet(shouldUseCompactActionSheet());
		};

		syncActionMenuLayout();
		window.addEventListener('resize', syncActionMenuLayout);
		window.addEventListener('orientationchange', syncActionMenuLayout);

		return () => {
			window.removeEventListener('resize', syncActionMenuLayout);
			window.removeEventListener('orientationchange', syncActionMenuLayout);
		};
	}, []);

	useEffect(() => {
		if (!actionMenuOpen || useCompactActionSheet)
			return;

		const handlePointerDown = (event: PointerEvent) => {
			if (!actionMenuRef.current?.contains(event.target as Node))
				setActionMenuOpen(false);
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape')
				setActionMenuOpen(false);
		};

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [actionMenuOpen, useCompactActionSheet]);

	return (
		<RenderIf
			condition={actionOptions.length > 0}
			then={
				<>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						onChange={(event) =>
							void handleFileSelection(event)
						}
						className="hidden"
					/>
					<div ref={actionMenuRef} className="relative shrink-0">
						<SmallGenericButton
							title="Open attachments"
							onMouseDown={keepInputFocus}
							onPointerDown={keepInputFocus}
							onClick={() => setActionMenuOpen((current) => !current)}
							disabled={(disabled ?? false) || attachmentState === 'uploading'}
							className="flex min-h-12 min-w-12 items-center justify-center border-white/8 bg-dark-100/70 text-lg leading-none enabled:hover:bg-dark-100"
							aria-haspopup={useCompactActionSheet ? 'dialog' : 'menu'}
							aria-expanded={actionMenuOpen}
						>
							<Plus className="h-5 w-5" />
						</SmallGenericButton>
						<RenderIf
							condition={actionMenuOpen ? !useCompactActionSheet : false}
							then={
								<div className="app-panel absolute bottom-full left-0 z-20 mb-2 w-72 p-2.5 shadow-[0_24px_60px_rgba(0,0,0,0.34)]">
									{renderActionOptions(false)}
								</div>
							}
							otherwise={null}
						/>
					</div>
					<OverlayShell
						active={actionMenuOpen ? useCompactActionSheet : false}
						onClose={() => setActionMenuOpen(false)}
						mode="sheet"
						backdropClassName="px-3 pb-[calc(var(--safe-area-bottom)+6.5rem)] pt-[calc(var(--safe-area-top)+1rem)] sm:hidden"
						surfaceClassName="w-full max-w-none rounded-[1.75rem] border border-white/10 bg-dark-200/96 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.34)]"
					>
						<div className="flex items-start justify-between gap-3 px-1 pb-2">
							<div>
								<p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-100">Attachments</p>
								<p className="app-text-muted mt-1 text-xs">Choose a file type or jump into your GIF library without the menu getting clipped.</p>
							</div>
							<SmallGenericButton
								title="Close attachments"
								onClick={() => setActionMenuOpen(false)}
								className="inline-flex h-10 w-10 shrink-0 items-center justify-center px-0"
							>
								<Close className="h-4 w-4" />
							</SmallGenericButton>
						</div>
						<div className="space-y-1">
							{renderActionOptions(true)}
						</div>
					</OverlayShell>
				</>
			}
			otherwise={null}
		/>
	);
};

export default MessageInputActions;