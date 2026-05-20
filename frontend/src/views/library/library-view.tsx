import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SmallGenericButton } from '@/components/common/buttons/generic';
import { RedButton } from '@/components/common/buttons/red';
import { MediaPreviewOverlay } from '@/components/common/media';
import { ErrorMessage } from '@/components/common/messages/error';
import { StatusMessage } from '@/components/common/messages/status';
import { Modal } from '@/components/common/modal';
import { Notification } from '@/components/common/notifications';
import { LibraryExplorerBar, LibraryHero, LibrarySectionCard, LibrarySelectionBar } from '@/components/library/index';
import { formatFileSize } from '@/helpers/media';
import { RenderIf } from '@/helpers/render-conditional';
import { exportLocalAttachment, getLocalAttachment } from '@/services/attachment-local-store';
import type {
	LibraryItem,
	LibraryKind
} from '@/services/library-service';
import {
	deleteLibraryItem,
	deleteLibraryItems,
	deleteLibraryItemsByKind,
	getLibraryItems,
	LIBRARY_CONTENT_TYPES
} from '@/services/library-service';
import { getRemoteMedia } from '@/services/remote-media-cache';
import { useAuthStore } from '@/store/auth-store';
import { usePeersStore } from '@/store/peers-store';
import type { Notification as NotificationProps } from '@/types';

import type { FC } from 'react';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'short',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit'
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const formatRelativeTimestamp = (timestamp: number): string => {
	const diffMs = timestamp - Date.now();
	const minuteMs = 60 * 1000;
	const hourMs = 60 * minuteMs;
	const dayMs = 24 * hourMs;
	const weekMs = 7 * dayMs;
	const monthMs = 30 * dayMs;
	const yearMs = 365 * dayMs;
	const absDiffMs = Math.abs(diffMs);

	if (absDiffMs < minuteMs)
		return 'just now';

	if (absDiffMs < hourMs)
		return relativeTimeFormatter.format(Math.round(diffMs / minuteMs), 'minute');

	if (absDiffMs < dayMs)
		return relativeTimeFormatter.format(Math.round(diffMs / hourMs), 'hour');

	if (absDiffMs < weekMs)
		return relativeTimeFormatter.format(Math.round(diffMs / dayMs), 'day');

	if (absDiffMs < monthMs)
		return relativeTimeFormatter.format(Math.round(diffMs / weekMs), 'week');

	if (absDiffMs < yearMs)
		return relativeTimeFormatter.format(Math.round(diffMs / monthMs), 'month');

	return relativeTimeFormatter.format(Math.round(diffMs / yearMs), 'year');
};

type PendingLibraryAction = {
	title: string;
	message: string;
	confirmLabel: string;
	countdownSeconds?: number;
	onConfirm: () => Promise<void>;
};

type PreviewState = {
	title: string;
	kind: 'gif' | 'image' | 'video' | 'audio';
	url: string;
	mimeType?: string;
	details?: string;
};

type LibraryFilter = 'all' | LibraryKind;
type LibrarySortOrder = 'recent' | 'oldest' | 'largest' | 'name';

const SECTION_PAGE_SIZE = 50;
const LOCAL_CACHE_FILTER_ID = '__local__';
const LIBRARY_SORT_OPTIONS: ReadonlyArray<{ id: LibrarySortOrder; label: string }> = [
	{ id: 'recent', label: 'Most recent' },
	{ id: 'oldest', label: 'Oldest first' },
	{ id: 'largest', label: 'Largest size' },
	{ id: 'name', label: 'Name (A-Z)' }
];

const kindLabelMap: Record<LibraryKind, string> = {
	gif: 'GIF',
	image: 'image',
	video: 'video',
	audio: 'audio',
	file: 'file',
	link: 'link'
};

const getTextFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const getPeerDisplayLabel = (peerId: string, displayName?: string): string => (
	getTextFallback(displayName, `${peerId.slice(0, 8)}...`)
);

const getGroupedItems = (groupedItems: ReadonlyMap<LibraryKind, LibraryItem[]>, kind: LibraryKind): LibraryItem[] => (
	groupedItems.get(kind) ?? []
);

const getPendingConfirmLabel = (pendingAction: PendingLibraryAction | null): string => (
	getTextFallback(pendingAction?.confirmLabel, 'Confirm')
);

const LibraryView: FC = () => {
	const { userId } = useAuthStore();
	const { peers, loadPeers } = usePeersStore();
	const [items, setItems] = useState<LibraryItem[]>([]);
	const [isLoading, setIsLoading] = useState<boolean>(true);
	const [isDeleting, setIsDeleting] = useState<boolean>(false);
	const [feedback, setFeedback] = useState<NotificationProps | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionStatus, setActionStatus] = useState<string | null>(null);
	const [pendingAction, setPendingAction] = useState<PendingLibraryAction | null>(null);
	const [deleteCountdown, setDeleteCountdown] = useState<number>(0);
	const [previewState, setPreviewState] = useState<PreviewState | null>(null);
	const [activeItemId, setActiveItemId] = useState<string | null>(null);
	const [activeFilter, setActiveFilter] = useState<LibraryFilter>('all');
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [activePeerFilter, setActivePeerFilter] = useState<string>('all');
	const [sortOrder, setSortOrder] = useState<LibrarySortOrder>('recent');
	const [selectionMode, setSelectionMode] = useState<boolean>(false);
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
	const [visibleCounts, setVisibleCounts] = useState<Record<LibraryKind, number>>({
		gif: SECTION_PAGE_SIZE,
		image: SECTION_PAGE_SIZE,
		video: SECTION_PAGE_SIZE,
		audio: SECTION_PAGE_SIZE,
		file: SECTION_PAGE_SIZE,
		link: SECTION_PAGE_SIZE
	});
	const refreshRequestIdRef = useRef<number>(0);
	const previewUrlRef = useRef<string | null>(null);

	const peerNameMap = useMemo(() => {
		const map = new Map<string, string>();
		peers.forEach((peer) => {
			map.set(peer.userId, getPeerDisplayLabel(peer.userId, peer.displayName));
		});
		return map;
	}, [peers]);
	const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
	const explorerItems = useMemo(() => {
		const matchingItems = items.filter((item) => {
			const peerFilterMatches = activePeerFilter === 'all'
				? true
				: activePeerFilter === LOCAL_CACHE_FILTER_ID
					? item.peerId.length === 0
					: item.peerId === activePeerFilter;

			if (!peerFilterMatches)
				return false;

			if (!normalizedSearchQuery)
				return true;

			const peerLabel = (item.peerId ? (peerNameMap.get(item.peerId) ?? item.peerId.slice(0, 8)) : 'Local cache').toLowerCase();
			const label = item.label.toLowerCase();
			const linkUrl = item.linkUrl?.toLowerCase() ?? '';

			return label.includes(normalizedSearchQuery)
				|| linkUrl.includes(normalizedSearchQuery)
				|| peerLabel.includes(normalizedSearchQuery);
		});

		return [...matchingItems].sort((left, right) => {
			switch (sortOrder) {
				case 'oldest':
					return left.timestamp - right.timestamp;
				case 'largest':
					return right.sizeBytes - left.sizeBytes;
				case 'name':
					return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
				case 'recent':
				default:
					return right.timestamp - left.timestamp;
			}
		});
	}, [activePeerFilter, items, normalizedSearchQuery, peerNameMap, sortOrder]);
	const peerFilterOptions = useMemo(() => {
		const uniquePeerIds = Array.from(new Set(items.map((item) => item.peerId)));
		const scopedOptions = uniquePeerIds
			.map((peerId) => ({
				id: peerId.length > 0 ? peerId : LOCAL_CACHE_FILTER_ID,
				label: peerId.length > 0 ? (peerNameMap.get(peerId) ?? `${peerId.slice(0, 8)}...`) : 'Local cache'
			}))
			.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));

		return [{ id: 'all', label: 'All contacts' }, ...scopedOptions];
	}, [items, peerNameMap]);

	const groupedItems = useMemo(() => {
		const grouped = new Map<LibraryKind, LibraryItem[]>();
		LIBRARY_CONTENT_TYPES.forEach(({ kind }) => grouped.set(kind, []));
		explorerItems.forEach((item) => {
			grouped.get(item.kind)?.push(item);
		});
		return grouped;
	}, [explorerItems]);
	const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
	const selectedItems = useMemo(() => Array.from(selectedItemIds)
		.map((itemId) => itemMap.get(itemId))
		.filter((item): item is LibraryItem => item !== undefined), [itemMap, selectedItemIds]);

	const explorerSizeBytes = useMemo(() => explorerItems.reduce((sum, item) => sum + item.sizeBytes, 0), [explorerItems]);
	const activeFilterTitle = useMemo(() => {
		if (activeFilter === 'all')
			return 'All categories';

		return LIBRARY_CONTENT_TYPES.find((section) => section.kind === activeFilter)?.title ?? 'Selected category';
	}, [activeFilter]);
	const filteredSections = useMemo(() => {
		if (activeFilter === 'all')
			return LIBRARY_CONTENT_TYPES;

		return LIBRARY_CONTENT_TYPES.filter((section) => section.kind === activeFilter);
	}, [activeFilter]);
	const filteredItemCount = useMemo(() => {
		if (activeFilter === 'all')
			return explorerItems.length;

		return getGroupedItems(groupedItems, activeFilter).length;
	}, [activeFilter, explorerItems.length, groupedItems]);
	const filteredSizeBytes = useMemo(() => {
		if (activeFilter === 'all')
			return explorerSizeBytes;

		return getGroupedItems(groupedItems, activeFilter).reduce((sum, item) => sum + item.sizeBytes, 0);
	}, [activeFilter, explorerSizeBytes, groupedItems]);
	const explorerCategoryOptions = useMemo(() => ([
		{
			id: 'all',
			title: 'All categories',
			count: explorerItems.length,
			active: activeFilter === 'all',
			onClick: () => setActiveFilter('all')
		},
		...LIBRARY_CONTENT_TYPES.map((section) => ({
			id: section.kind,
			title: section.title,
			count: getGroupedItems(groupedItems, section.kind).length,
			active: activeFilter === section.kind,
			onClick: () => setActiveFilter(section.kind)
		}))
	]), [activeFilter, explorerItems.length, groupedItems]);
	const hasActiveExplorerFilters = normalizedSearchQuery.length > 0 || activePeerFilter !== 'all' || sortOrder !== 'recent' || activeFilter !== 'all';
	const hasScopedDeleteFilters = normalizedSearchQuery.length > 0 || activePeerFilter !== 'all';
	const activePeerFilterLabel = useMemo(() => {
		return peerFilterOptions.find((option) => option.id === activePeerFilter)?.label ?? 'All contacts';
	}, [activePeerFilter, peerFilterOptions]);
	const activeSortLabel = useMemo(() => {
		return LIBRARY_SORT_OPTIONS.find((option) => option.id === sortOrder)?.label ?? 'Most recent';
	}, [sortOrder]);

	const getSectionVisibleCount = useCallback((kind: LibraryKind): number => {
		return visibleCounts[kind];
	}, [visibleCounts]);

	const visibleItemIds = useMemo(() => filteredSections.flatMap((section) => {
		const sectionItems = getGroupedItems(groupedItems, section.kind);
		return sectionItems.slice(0, getSectionVisibleCount(section.kind)).map((item) => item.id);
	}), [filteredSections, getSectionVisibleCount, groupedItems]);
	const allVisibleSelected = useMemo(() => visibleItemIds.length > 0 && visibleItemIds.every((itemId) => selectedItemIds.has(itemId)), [selectedItemIds, visibleItemIds]);

	const getPeerLabel = useCallback((peerId: string): string => {
		if (!peerId)
			return 'Local cache';

		return peerNameMap.get(peerId) ?? `${peerId.slice(0, 8)}...`;
	}, [peerNameMap]);

	const getItemSourceLabel = useCallback((item: LibraryItem): string => {
		if (item.source === 'message-link')
			return 'Link in chat';

		if (item.source === 'remote-media')
			return 'Remote cache';

		return item.peerId ? '' : 'Local attachment';
	}, []);

	const buildPreviewDetails = useCallback((item: LibraryItem, mimeType?: string): string => {
		const baseDetails = `${getPeerLabel(item.peerId)} • ${dateFormatter.format(new Date(item.timestamp))} • ${formatFileSize(item.sizeBytes)}`;
		return mimeType ? `${baseDetails} • ${mimeType}` : baseDetails;
	}, [getPeerLabel]);

	const replacePreviewState = useCallback((nextState: PreviewState | null) => {
		if (previewUrlRef.current && previewUrlRef.current !== nextState?.url)
			URL.revokeObjectURL(previewUrlRef.current);

		previewUrlRef.current = nextState?.url ?? null;
		setPreviewState(nextState);
	}, []);

	const applyLibraryItems = useCallback((nextItems: LibraryItem[]) => {
		const nextItemIds = new Set(nextItems.map((item) => item.id));

		setItems(nextItems);
		setLoadError(null);
		setSelectedItemIds((current) => {
			const existingItemIds = Array.from(current).filter((itemId) => nextItemIds.has(itemId));

			return existingItemIds.length === current.size ? current : new Set(existingItemIds);
		});

		if (nextItems.length === 0)
			setSelectionMode(false);
	}, []);

	const refreshLibrary = useCallback(async () => {
		const requestId = refreshRequestIdRef.current + 1;
		refreshRequestIdRef.current = requestId;
		setIsLoading(true);
		setLoadError(null);

		try {
			const nextItems = await getLibraryItems(userId);
			if (refreshRequestIdRef.current !== requestId)
				return;

			applyLibraryItems(nextItems);
		} catch (_error) {
			if (refreshRequestIdRef.current !== requestId)
				return;

			setLoadError('Could not load your local Library. Check storage availability and try again.');
		} finally {
			if (refreshRequestIdRef.current === requestId)
				setIsLoading(false);
		}
	}, [applyLibraryItems, userId]);

	const closePendingAction = () => {
		if (isDeleting)
			return;

		setPendingAction(null);
		setDeleteCountdown(0);
	};

	const closePreview = () => {
		replacePreviewState(null);
	};

	const exitSelectionMode = useCallback(() => {
		if (isDeleting)
			return;

		setSelectionMode(false);
		setSelectedItemIds(new Set());
	}, [isDeleting]);

	const toggleItemSelection = useCallback((itemId: string) => {
		setSelectionMode(true);
		setSelectedItemIds((current) => {
			const next = new Set(current);

			if (next.has(itemId))
				next.delete(itemId);
			else
				next.add(itemId);

			return next;
		});
	}, []);

	const toggleVisibleSelection = useCallback(() => {
		setSelectionMode(true);
		setSelectedItemIds((current) => {
			const next = new Set(current);

			if (allVisibleSelected)
				visibleItemIds.forEach((itemId) => next.delete(itemId));
			else
				visibleItemIds.forEach((itemId) => next.add(itemId));

			return next;
		});
	}, [allVisibleSelected, visibleItemIds]);

	const runPendingAction = async () => {
		if (!pendingAction)
			return;

		if ((pendingAction.countdownSeconds ?? 0) > 0 && deleteCountdown > 0)
			return;

		setIsDeleting(true);
		setActionError(null);
		setActionStatus(`${pendingAction.confirmLabel} in progress...`);

		try {
			await pendingAction.onConfirm();
			setPendingAction(null);
		} catch {
			setActionError('Unable to complete the requested Library action. Please try again.');
			setFeedback({ message: 'Unable to complete library cleanup.', type: 'error' });
		} finally {
			setActionStatus(null);
			setIsDeleting(false);
		}
	};

	const queueDeleteItem = (item: LibraryItem) => {
		setActionError(null);
		setDeleteCountdown(0);
		setPendingAction({
			title: `Delete ${kindLabelMap[item.kind]}`,
			message: item.source === 'message-link'
				? 'This removes the selected link from your local message history. If that message only contains this link, the local message entry will be removed as well.'
				: 'This removes the selected item from local storage and updates the Library immediately.',
			confirmLabel: 'Delete item',
			onConfirm: async () => {
				const deleted = await deleteLibraryItem(item);
				if (!deleted)
					throw new Error('Delete failed');

				await refreshLibrary();
				setFeedback({ message: `${kindLabelMap[item.kind]} removed from Library.`, type: 'success' });
			}
		});
	};

	const queueDeleteKind = (kind: LibraryKind, count: number) => {
		setActionError(null);
		setDeleteCountdown(5);
		setPendingAction({
			title: `Delete all ${kindLabelMap[kind]} items`,
			message: kind === 'link'
				? `This removes ${count} link entries from your local message history across the app.`
				: `This removes ${count} ${kindLabelMap[kind]} items from local storage across the app.`,
			confirmLabel: 'Delete all',
			countdownSeconds: 5,
			onConfirm: async () => {
				const deletedCount = await deleteLibraryItemsByKind(kind, userId);
				await refreshLibrary();
				setFeedback({ message: `${deletedCount} ${kindLabelMap[kind]} item${deletedCount === 1 ? '' : 's'} removed.`, type: 'success' });
			}
		});
	};

	const queueDeleteSelectedItems = () => {
		if (selectedItems.length === 0)
			return;

		const containsLinks = selectedItems.some((item) => item.source === 'message-link');
		setActionError(null);
		setDeleteCountdown(5);
		setPendingAction({
			title: `Delete ${selectedItems.length} selected item${selectedItems.length === 1 ? '' : 's'}`,
			message: containsLinks
				? 'This removes the selected items from local storage and also removes selected link entries from your local message history where needed.'
				: 'This removes the selected items from local storage and updates the Library immediately.',
			confirmLabel: 'Delete selected',
			countdownSeconds: 5,
			onConfirm: async () => {
				const deletedCount = await deleteLibraryItems(selectedItems);
				await refreshLibrary();
				setSelectedItemIds(new Set());
				setSelectionMode(false);
				setFeedback({ message: `${deletedCount} item${deletedCount === 1 ? '' : 's'} removed from Library.`, type: 'success' });
			}
		});
	};

	const handleOpenItem = async (item: LibraryItem) => {
		setActiveItemId(item.id);
		setActionError(null);
		setActionStatus(`${getPrimaryActionLabel(item)} in progress...`);

		try {
			if (item.kind === 'link' && item.linkUrl) {
				const openedWindow = window.open(item.linkUrl, '_blank', 'noopener,noreferrer');
				if (!openedWindow)
					throw new Error('Your browser blocked opening this link.');

				setFeedback({ message: 'Link opened in a new tab.', type: 'info' });
				return;
			}

			if (item.kind === 'file' && item.attachmentId) {
				const exported = await exportLocalAttachment(item.attachmentId, item.label);
				if (!exported)
					throw new Error('File not available in local storage.');

				setFeedback({ message: `Download started for ${item.label}.`, type: 'info' });
				return;
			}

			if (item.source === 'local-attachment' && item.attachmentId) {
				const record = await getLocalAttachment(item.attachmentId);
				if (!record)
					throw new Error('Media not available in local storage.');

				replacePreviewState({
					title: item.label,
					kind: item.kind as PreviewState['kind'],
					url: URL.createObjectURL(record.blob),
					mimeType: record.mimeType,
					details: buildPreviewDetails(item, record.mimeType)
				});
				return;
			}

			if (item.source === 'remote-media' && item.remoteMediaUrl) {
				const record = await getRemoteMedia(item.remoteMediaUrl);
				if (!record)
					throw new Error('Cached media is no longer available.');

				replacePreviewState({
					title: item.label,
					kind: item.kind as PreviewState['kind'],
					url: URL.createObjectURL(record.blob),
					mimeType: record.mimeType,
					details: buildPreviewDetails(item, record.mimeType)
				});
				return;
			}

			throw new Error('This item cannot be opened from the Library.');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to open the selected Library item.';
			setActionError(message);
			setFeedback({ message, type: 'error' });
		} finally {
			setActionStatus(null);
			setActiveItemId(null);
		}
	};

	const getPrimaryActionLabel = (item: LibraryItem): string => {
		if (item.kind === 'link')
			return 'Open link';

		if (item.kind === 'file')
			return 'Download';

		return 'Preview';
	};

	const getPendingActionButtonLabel = (): string => {
		if (isDeleting)
			return 'Deleting...';

		if (deleteCountdown > 0)
			return `${getPendingConfirmLabel(pendingAction)} (${deleteCountdown})`;

		return getPendingConfirmLabel(pendingAction);
	};

	const handleLoadMore = (kind: LibraryKind) => {
		setVisibleCounts((current) => ({
			...current,
			[kind]: current[kind] + SECTION_PAGE_SIZE
		}));
	};

	const getPrimaryActionStatusLabel = (item: LibraryItem): string => {
		if (activeItemId !== item.id)
			return getPrimaryActionLabel(item);

		if (item.kind === 'file')
			return 'Downloading...';

		if (item.kind === 'link')
			return 'Opening...';

		return 'Preparing...';
	};

	const resetExplorerControls = () => {
		setSearchQuery('');
		setActivePeerFilter('all');
		setSortOrder('recent');
		setActiveFilter('all');
	};

	useEffect(() => {
		void loadPeers();
	}, [loadPeers]);

	useEffect(() => {
		let active = true;
		const requestId = refreshRequestIdRef.current + 1;
		refreshRequestIdRef.current = requestId;

		const loadInitialLibrary = async () => {
			try {
				const nextItems = await getLibraryItems(userId);
				if (!active || refreshRequestIdRef.current !== requestId)
					return;

				applyLibraryItems(nextItems);
			} catch (_error) {
				if (!active || refreshRequestIdRef.current !== requestId)
					return;

				setLoadError('Could not load your local Library. Check storage availability and try again.');
			} finally {
				if (active && refreshRequestIdRef.current === requestId)
					setIsLoading(false);
			}
		};

		void loadInitialLibrary();

		return () => {
			active = false;
		};
	}, [applyLibraryItems, userId]);

	useEffect(() => {
		if (!pendingAction || deleteCountdown <= 0)
			return;

		const interval = window.setInterval(() => {
			setDeleteCountdown((current) => {
				if (current <= 1) {
					window.clearInterval(interval);
					return 0;
				}

				return current - 1;
			});
		}, 1000);

		return () => window.clearInterval(interval);
	}, [deleteCountdown, pendingAction]);

	useEffect(() => {
		return () => {
			if (previewUrlRef.current)
				URL.revokeObjectURL(previewUrlRef.current);
		};
	}, []);

	return (
		<div className="app-shell h-full overflow-y-auto px-3 py-4 sm:p-6">
			<Notification message={feedback?.message ?? ''} type={feedback?.type ?? 'undefined'} />
			<MediaPreviewOverlay
				active={previewState !== null}
				title={previewState?.title ?? ''}
				kind={previewState?.kind ?? 'image'}
				url={previewState?.url ?? ''}
				details={previewState?.details}
				onClose={closePreview}
			/>
			<Modal
				active={pendingAction !== null}
				setActive={closePendingAction}
				title={pendingAction?.title ?? ''}
				message={pendingAction?.message ?? ''}
				AcceptButton={
					<RedButton onClick={() => void runPendingAction()} disabled={isDeleting || deleteCountdown > 0}>
						{getPendingActionButtonLabel()}
					</RedButton>
				}
			/>
			<LibraryHero
				itemCount={filteredItemCount}
				storageLabel={formatFileSize(filteredSizeBytes)}
				viewLabel={activeFilterTitle}
				showExplorerHint={items.length > 0}
			/>
			<RenderIf
				condition={items.length > 0}
				then={<LibraryExplorerBar
					searchQuery={searchQuery}
					onSearchQueryChange={setSearchQuery}
					activePeerFilter={activePeerFilter}
					activePeerFilterLabel={activePeerFilterLabel}
					onPeerFilterChange={setActivePeerFilter}
					peerFilterOptions={peerFilterOptions}
					sortOrder={sortOrder}
					activeSortLabel={activeSortLabel}
					onSortOrderChange={(value: string) => setSortOrder(value as LibrarySortOrder)}
					sortOptions={LIBRARY_SORT_OPTIONS}
					categoryOptions={explorerCategoryOptions}
					activeCategoryTitle={activeFilterTitle}
					hasActiveExplorerFilters={hasActiveExplorerFilters}
					onClearAll={resetExplorerControls}
					matchingItemCount={explorerItems.length}
					contactScopeCount={peerFilterOptions.length - 1}
					showScopedDeleteHint={hasScopedDeleteFilters}
				/>}
				otherwise={null}
			/>
			<RenderIf
				condition={items.length > 0}
				then={<LibrarySelectionBar
					selectionMode={selectionMode}
					selectedCount={selectedItems.length}
					visibleCount={visibleItemIds.length}
					allVisibleSelected={allVisibleSelected}
					onEnterSelectionMode={() => setSelectionMode(true)}
					onExitSelectionMode={exitSelectionMode}
					onToggleSelectVisible={toggleVisibleSelection}
					onDeleteSelected={queueDeleteSelectedItems}
					actionsDisabled={isDeleting || activeItemId !== null}
				/>}
				otherwise={null}
			/>
			{actionStatus !== null && actionStatus.length > 0 ? <div className="mb-4"><StatusMessage message={actionStatus} /></div> : null}
			{actionError !== null && actionError.length > 0 ? <div className="mb-4"><ErrorMessage message={actionError} /></div> : null}

			<RenderIf
				condition={isLoading}
				then={<div className="app-panel p-5 text-sm text-white/65">Loading local content...</div>}
				otherwise={
					<RenderIf
						condition={loadError !== null}
						then={
							<div className="app-panel space-y-4 border-red-500/20 bg-red-500/6 p-4">
								{loadError !== null && loadError.length > 0 ? <ErrorMessage message={loadError} /> : null}
								<SmallGenericButton onClick={() => void refreshLibrary()} className="w-full sm:w-auto">
									Retry
								</SmallGenericButton>
							</div>
						}
						otherwise={
							<RenderIf
								condition={items.length === 0}
								then={
									<div className="app-panel p-6 text-center">
										<p className="text-base font-semibold text-white">Nothing stored yet</p>
										<p className="mt-2 text-sm text-white/60">Local media, files and cached links will appear here after you use them in chats.</p>
									</div>
								}
								otherwise={
									<RenderIf
										condition={explorerItems.length === 0}
										then={
											<div className="app-panel space-y-4 p-6 text-center">
												<div>
													<p className="text-base font-semibold text-white">No items match the current explorer view</p>
													<p className="mt-2 text-sm text-white/60">Try a different contact, clear the search query, or reset the sort and category filters.</p>
												</div>
												<div className="flex justify-center">
													<SmallGenericButton onClick={resetExplorerControls} className="w-full sm:w-auto">
														Clear all filters
													</SmallGenericButton>
												</div>
											</div>
										}
										otherwise={
											<div className="space-y-4 sm:space-y-5">
												{filteredSections.map((section) => {
													const sectionItems = getGroupedItems(groupedItems, section.kind);
													const totalBytes = sectionItems.reduce((sum, item) => sum + item.sizeBytes, 0);
													const visibleSectionItems = sectionItems.slice(0, getSectionVisibleCount(section.kind)).map((item) => {
														const absoluteTimeLabel = dateFormatter.format(new Date(item.timestamp));
														const sizeLabel = item.kind === 'link' ? undefined : formatFileSize(item.sizeBytes);

														return {
															id: item.id,
															label: item.label,
															metadata: absoluteTimeLabel,
															kindLabel: kindLabelMap[item.kind],
															source: item.source,
															attachmentId: item.attachmentId,
															remoteMediaUrl: item.remoteMediaUrl,
															peerLabel: getPeerLabel(item.peerId),
															sourceLabel: getItemSourceLabel(item),
															relativeTimeLabel: formatRelativeTimestamp(item.timestamp),
															absoluteTimeLabel,
															sizeLabel,
															primaryActionLabel: getPrimaryActionStatusLabel(item),
															onPrimaryAction: () => void handleOpenItem(item),
															onDelete: () => queueDeleteItem(item),
															selectionMode,
															isSelected: selectedItemIds.has(item.id),
															onToggleSelection: () => toggleItemSelection(item.id),
															selectionDisabled: isDeleting || activeItemId !== null,
															selectionAriaLabel: `${selectedItemIds.has(item.id) ? 'Deselect' : 'Select'} ${item.label}`,
															primaryActionDisabled: isDeleting || (activeItemId !== null && activeItemId !== item.id),
															deleteDisabled: isDeleting || activeItemId !== null,
															deleteAriaLabel: `Delete ${item.label}`
														};
													});

													return (
														<LibrarySectionCard
															key={section.kind}
															badgeLabel={kindLabelMap[section.kind]}
															title={section.title}
															itemCount={sectionItems.length}
															totalSizeLabel={formatFileSize(totalBytes)}
															items={visibleSectionItems}
															layout={section.kind === 'gif' || section.kind === 'image' ? 'grid' : 'list'}
															emptyMessage={`No stored ${section.title.toLowerCase()} yet.`}
															showDeleteAll={sectionItems.length > 0 && !hasScopedDeleteFilters && !selectionMode}
															onDeleteAll={() => queueDeleteKind(section.kind, sectionItems.length)}
															deleteAllDisabled={isDeleting || activeItemId !== null}
															showLoadMore={sectionItems.length > getSectionVisibleCount(section.kind)}
															onLoadMore={() => handleLoadMore(section.kind)}
															loadMoreDisabled={isDeleting || activeItemId !== null}
														/>
													);
												})}
											</div>
										}
									/>
								}
							/>
						}
					/>
				}
			/>
		</div>
	);
};

export default LibraryView;
