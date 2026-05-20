import { useEffect, useMemo, useRef, useState } from 'react';

import { ArrowUp, Eye } from '@/assets';
import RemoteInlineMedia from '@/components/chat/remote-inline-media';
import { MediaPreviewOverlay } from '@/components/common/media';
import { getAttachmentContinuationHint } from '@/helpers/attachments';
import { formatFileSize } from '@/helpers/media';
import { getAttachmentActionLabel, getReplyPreviewText, replyAuthor, useMessageAutoScroll } from '@/helpers/messages';
import { signedFetch } from '@/helpers/messages/http-auth';
import { RenderIf, RenderSwitch } from '@/helpers/render-conditional';
import { isRecord, isString, parseJsonResponse } from '@/helpers/validation';
import { getLocalAttachments } from '@/services/attachment-local-store';
import { downloadAttachment } from '@/services/attachment-upload-service';
import { getLinkPreview, saveLinkPreview } from '@/services/message-service';
import { extractDirectRemoteMediaUrls, isDirectRemoteMediaUrl } from '@/services/remote-media-cache';
import { useAttachmentDownloadStore } from '@/store/attachment-download-store';
import { useAuthStore } from '@/store/auth-store';
import { useMessagesStore } from '@/store/messages-store';
import type { LocalAttachmentRecord, MessageAttachment, DecryptedMessage, LinkPreviewRecord, AttachmentDownloadState } from '@/types';

import { SmallGenericButton } from '@components/common/buttons/generic';

import type { FC, TouchEvent } from 'react';

const areLocalAttachmentMapsEquivalent = (
	current: Partial<Record<string, LocalAttachmentRecord>>,
	next: Partial<Record<string, LocalAttachmentRecord>>
): boolean => {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);

	if (currentKeys.length !== nextKeys.length) 
		return false;

	for (const key of nextKeys) {
		const currentRecord = current[key];
		const nextRecord = next[key];

		if (!currentRecord || !nextRecord) 
			return false;
		
		if (
			currentRecord.attachmentId !== nextRecord.attachmentId ||
			currentRecord.updatedAt !== nextRecord.updatedAt ||
			currentRecord.fileName !== nextRecord.fileName ||
			currentRecord.mimeType !== nextRecord.mimeType ||
			currentRecord.size !== nextRecord.size
		) 
			return false;
		
	}

	return true;
};

const getRecordValue = <T,>(record: Record<string, T>, key: string): T | undefined => (
	(record as Partial<Record<string, T>>)[key]
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const getOptionalNonEmptyString = (value: string | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

type LinkPreviewResponse = Omit<LinkPreviewRecord, 'fetchedAt'>;

type LinkPreviewResponseRecord = {
	url?: unknown;
	title?: unknown;
	description?: unknown;
	image?: unknown;
	siteName?: unknown;
};

const isLinkPreviewResponseRecord = (value: unknown): value is LinkPreviewResponseRecord => isRecord(value);

const parseLinkPreviewResponse = (value: unknown): LinkPreviewResponse | null => {
	if (!isLinkPreviewResponseRecord(value)
		|| !isString(value.url)
		|| (value.title !== undefined && !isString(value.title))
		|| (value.description !== undefined && !isString(value.description))
		|| (value.image !== undefined && !isString(value.image))
		|| (value.siteName !== undefined && !isString(value.siteName))) {
		return null;
	}

	return {
		url: value.url,
		...(isString(value.title) ? { title: value.title } : {}),
		...(isString(value.description) ? { description: value.description } : {}),
		...(isString(value.image) ? { image: value.image } : {}),
		...(isString(value.siteName) ? { siteName: value.siteName } : {})
	};
};

const getMessageAttachments = (message: DecryptedMessage): ReadonlyArray<MessageAttachment> => (
	message.attachments ?? []
);

const resolveLocalAttachmentId = (attachment: MessageAttachment): string => (
	getNonEmptyStringOrFallback(attachment.localReferenceId, attachment.id)
);

const hasLocalAttachment = (localAttachment: LocalAttachmentRecord | undefined): boolean => (
	localAttachment !== undefined
);

const getSharedImageAlt = (content: string, imageCount: number, index: number): string => {
	if (imageCount !== 1)
		return `Shared image ${index + 1}`;

	return getNonEmptyStringOrFallback(content.trim(), 'Shared image');
};

const REPLY_HIGHLIGHT_DURATION_MS = 2800;

const stripRenderedUrlsFromContent = (content: string, urls: ReadonlyArray<string>): string => {
	if (urls.length === 0)
		return content.trim();

	const uniqueUrls = Array.from(new Set(urls)).sort((left, right) => right.length - left.length);
	const stripped = uniqueUrls.reduce((current, url) => current.split(url).join(''), content);

	return stripped
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
};

const getMessageRowClassName = (isOwn: boolean): string => `flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`;

const getMessageBubbleClassName = (isOwn: boolean, isReplyHighlighted: boolean): string => {
	const baseClassName = 'w-fit max-w-[min(88%,32rem)] rounded-[1.45rem] px-3 py-3 text-white shadow-[0_18px_42px_rgba(0,0,0,0.18)] transition-all duration-300 sm:max-w-[min(78%,34rem)] sm:px-4';

	if (isOwn) {
		return `${baseClassName} ${isReplyHighlighted
			? 'rounded-br-md bg-linear-to-b from-primary-400 to-primary-600 ring-2 ring-primary-200 shadow-[0_20px_48px_rgba(6,182,212,0.28)] animate-pulse'
			: 'rounded-br-md bg-linear-to-b from-primary-500 to-primary-600'
		}`;
	}

	return `${baseClassName} border border-white/6 ${isReplyHighlighted
		? 'rounded-bl-md bg-linear-to-b from-primary-900/96 to-dark-300 ring-2 ring-primary-300 shadow-[0_20px_48px_rgba(6,182,212,0.2)] animate-pulse'
		: 'rounded-bl-md bg-linear-to-b from-dark-300/96 to-dark-200/98'
	}`;
};

const getReplyPreviewClassName = (isOwn: boolean): string => `mb-3 cursor-pointer rounded-xl border-l-2 px-3 py-2 text-xs ${isOwn ? 'border-white/35 bg-white/8 text-white/80' : 'border-primary-300/30 bg-white/5 text-white/72'}`;

const getMessageMetaClassName = (isOwn: boolean): string => `mt-2 flex items-center gap-1 text-[0.72rem] ${isOwn ? 'justify-end text-primary-100/90' : 'text-gray-400'}`;

const getReplyActionLabel = (message: DecryptedMessage, userId: string | null | undefined, peerDisplayName?: string): string => (
	`Reply to message from ${replyAuthor(message.senderId, userId, peerDisplayName)}`
);

interface MessageListProps {
	messages: ReadonlyArray<DecryptedMessage>;
	activePeerId?: string | null;
	numberOfContacts?: number;
	onForward?: (message: DecryptedMessage) => void;
	onReply?: (message: DecryptedMessage) => void;
	onLoadMore?: () => Promise<number>;
	peerDisplayName?: string;
}

type ImagePreviewState = {
	title: string;
	url: string;
	details?: string | undefined;
};

const MessageList: FC<MessageListProps> = ({ messages, activePeerId, onForward, onReply, numberOfContacts = 0, onLoadMore, peerDisplayName }) => {
	const { userId } = useAuthStore();
	const upsertDownload = useAttachmentDownloadStore((state) => state.upsertDownload);
	const clearDownload = useAttachmentDownloadStore((state) => state.clearDownload);
	const { markAsRead, retrySend } = useMessagesStore();
	const containerRef = useRef<HTMLDivElement>(null);
	const swipeStartX = useRef<number | null>(null);
	const swipeStartY = useRef<number | null>(null);
	const swipeLocked = useRef<boolean>(false);
	const [swipeMessageId, setSwipeMessageId] = useState<string | null>(null);
	const [swipeOffset, setSwipeOffset] = useState<number>(0);
	const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
	const [hasMore, setHasMore] = useState<boolean>(true);
	const [previews, setPreviews] = useState<Record<string, LinkPreviewRecord>>({});
	const [previewFailures, setPreviewFailures] = useState<Set<string>>(new Set());
	const [previewImages, setPreviewImages] = useState<Record<string, string>>({});
	const [attachmentDownloads, setAttachmentDownloads] = useState<Record<string, AttachmentDownloadState>>({});
	const [localAttachments, setLocalAttachments] = useState<Record<string, LocalAttachmentRecord>>({});
	const [localAttachmentUrls, setLocalAttachmentUrls] = useState<Record<string, string>>({});
	const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
	const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
	const pendingPreviews = useRef<Set<string>>(new Set());
	const pendingImages = useRef<Set<string>>(new Set());
	const imageCache = useRef<Map<string, string>>(new Map());
	const localAttachmentUrlCache = useRef<Map<string, string>>(new Map());
	const readReceiptSent = useRef<Set<string>>(new Set());
	const quoteClickTimer = useRef<number | null>(null);
	const quoteHighlightTimer = useRef<number | null>(null);
	const { requestAutoScroll, syncAutoScrollState, jumpToLatestMessages, unseenMessageCount } = useMessageAutoScroll({
		containerRef,
		conversationKey: activePeerId,
		messages,
		previewImages,
		attachmentPreviewUrls: localAttachmentUrls,
		userId
	});

	const attachmentIds = useMemo(() => {
		const ids = new Set<string>();
		messages.forEach((message) => {
			getMessageAttachments(message).forEach((attachment) => ids.add(resolveLocalAttachmentId(attachment)));
		});
		return Array.from(ids);
	}, [messages]);

	const formatTime = (timestamp: number) => {
		return new Date(timestamp).toLocaleString('pt-PT', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).replace(',', ' -');
	};

	const refreshLocalAttachments = async (ids: string[]) => {
		if (ids.length === 0) {
			setLocalAttachments({});
			return;
		}

		const records = await getLocalAttachments(ids);
		const nextAttachments = Object.fromEntries(records.map((record) => [record.attachmentId, record]));
		setLocalAttachments((current) => areLocalAttachmentMapsEquivalent(current, nextAttachments) ? current : nextAttachments);
	};

	const handleAttachmentDownload = async (attachment: MessageAttachment, message: DecryptedMessage) => {
		const peerId = message.senderId === userId ? message.recipientId : message.senderId;

		setAttachmentDownloads((current) => ({
			...current,
			[attachment.id]: {
				status: 'downloading',
				progress: 0
			}
		}));
		upsertDownload({
			attachmentId: attachment.id,
			fileName: attachment.name,
			progress: 0
		});

		try {
			await downloadAttachment(attachment, (progress) => {
				setAttachmentDownloads((current) => ({
					...current,
					[attachment.id]: {
						status: 'downloading',
						progress: progress.progress
					}
				}));
				upsertDownload({
					attachmentId: attachment.id,
					fileName: attachment.name,
					progress: progress.progress
				});
			}, {
				peerId,
				messageId: message.id
			});

			await refreshLocalAttachments(attachmentIds);
			setAttachmentDownloads((current) => ({
				...current,
				[attachment.id]: {
					status: 'idle',
					progress: 1
				}
			}));
			clearDownload(attachment.id);
		} catch (error) {
			setAttachmentDownloads((current) => ({
				...current,
				[attachment.id]: {
					status: 'failed',
					progress: 0,
					error: error instanceof Error ? error.message : 'Download failed'
				}
			}));
			clearDownload(attachment.id);
		}
	};

	const urlsInMessages = useMemo(() => {
		const urls = new Set<string>();
		const urlRegex = /https?:\/\/[^\s]+/gi;

		messages.forEach(message => {
			const matches = message.content.match(urlRegex) ?? [];
			matches
				.filter((match) => !isDirectRemoteMediaUrl(match))
				.forEach((match) => urls.add(match));
		});

		return Array.from(urls);
	}, [messages]);

	const resetSwipe = () => {
		swipeStartX.current = null;
		swipeStartY.current = null;
		swipeLocked.current = false;
		setSwipeMessageId(null);
		setSwipeOffset(0);
	};

	const handleTouchStart = (messageId: string, event: TouchEvent<HTMLDivElement>) => {
		const touch = event.touches[0];
		if (!touch)
			return;

		swipeStartX.current = touch.clientX;
		swipeStartY.current = touch.clientY;
		swipeLocked.current = false;
		setSwipeMessageId(messageId);
		setSwipeOffset(0);
	};

	const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
		if (swipeStartX.current === null || swipeStartY.current === null) return;
		const touch = event.touches[0];
		if (!touch)
			return;

		const deltaX = touch.clientX - swipeStartX.current;
		const deltaY = touch.clientY - swipeStartY.current;

		if (!swipeLocked.current) {
			if (Math.abs(deltaY) > Math.abs(deltaX)) 
				return;
			
			swipeLocked.current = true;
		}

		if (deltaX <= 0) {
			setSwipeOffset(0);
			return;
		}

		setSwipeOffset(Math.min(deltaX, 80));
	};

	const handleTouchEnd = (message: DecryptedMessage) => {
		if (swipeOffset >= 60) {
			onReply?.(message);
		}
		resetSwipe();
	};

	const cancelQuoteScroll = () => {
		if (quoteClickTimer.current) {
			window.clearTimeout(quoteClickTimer.current);
			quoteClickTimer.current = null;
		}
	};

	const cancelQuoteHighlight = () => {
		if (quoteHighlightTimer.current) {
			window.clearTimeout(quoteHighlightTimer.current);
			quoteHighlightTimer.current = null;
		}
	};

	const highlightQuotedMessage = (messageId: string) => {
		cancelQuoteHighlight();
		setHighlightedMessageId(messageId);
		quoteHighlightTimer.current = window.setTimeout(() => {
			setHighlightedMessageId((current) => current === messageId ? null : current);
			quoteHighlightTimer.current = null;
		}, REPLY_HIGHLIGHT_DURATION_MS);
	};

	const scheduleQuoteScroll = (messageId?: string) => {
		if (!messageId) return;
		cancelQuoteScroll();
		quoteClickTimer.current = window.setTimeout(() => {
			const target = document.getElementById(`message-${messageId}`);
			if (target) {
				target.scrollIntoView({ behavior: 'smooth', block: 'center' });
				highlightQuotedMessage(messageId);
			}
			quoteClickTimer.current = null;
		}, 300);
	};

	const handleMediaLayoutReady = () => 	requestAutoScroll();

	const openImagePreview = (title: string, url: string, details?: string) => setImagePreview({ title, url, details });

	const closeImagePreview = () => setImagePreview(null);

	useEffect(() => {
		const imageUrls = imageCache.current;
		const localAttachmentUrls = localAttachmentUrlCache.current;

		return () => {
			imageUrls.forEach((value) => URL.revokeObjectURL(value));
			localAttachmentUrls.forEach((value) => URL.revokeObjectURL(value));
		};
	}, []);

	useEffect(() => {
		void refreshLocalAttachments(attachmentIds);
	}, [attachmentIds]);

	useEffect(() => {
		setIsLoadingMore(false);
		setAttachmentDownloads({});
		setHighlightedMessageId(null);
	}, [activePeerId]);

	useEffect(() => {
		const currentAttachmentIds = new Set(Object.keys(localAttachments));

		localAttachmentUrlCache.current.forEach((value, attachmentId) => {
			if (!currentAttachmentIds.has(attachmentId)) {
				URL.revokeObjectURL(value);
				localAttachmentUrlCache.current.delete(attachmentId);
			}
		});

		Object.values(localAttachments).forEach((record) => {
			if (!localAttachmentUrlCache.current.has(record.attachmentId)) 
				localAttachmentUrlCache.current.set(record.attachmentId, URL.createObjectURL(record.blob));
		});

		setLocalAttachmentUrls(Object.fromEntries(localAttachmentUrlCache.current));
	}, [localAttachments]);

	useEffect(() => () => {
		cancelQuoteScroll();
		cancelQuoteHighlight();
	}, []);

	useEffect(() => {
		if (!userId || messages.length === 0) 
			return;

		const unreadIncoming = messages.filter(
			message => message.senderId !== userId && message.status !== 'read'
		);

		unreadIncoming.forEach(message => {
			if (readReceiptSent.current.has(message.id)) 
				return;
			
			readReceiptSent.current.add(message.id);
			void markAsRead(message.id, message.senderId);
		});
	}, [messages, userId, markAsRead]);

	useEffect(() => {
		let cancelled = false;

		const fetchPreview = async (url: string) => {
			let preview: LinkPreviewRecord | null = null;
			try {
				const cached = await getLinkPreview(url);
				if (!cancelled && cached) {
					setPreviews(prev => ({ ...prev, [url]: cached }));
					setPreviewFailures(prev => {
						if (!prev.has(url)) return prev;
						const next = new Set(prev);
						next.delete(url);
						return next;
					});
					return;
				}

				const response = await signedFetch(`/api/preview?url=${encodeURIComponent(url)}`);
				if (!response.ok) {
					if (!cancelled) 
						setPreviewFailures(prev => new Set(prev).add(url));
					
					return;
				}

				const data = await parseJsonResponse(response, parseLinkPreviewResponse, 'link preview');
				const nextPreview: LinkPreviewRecord = {
					...data,
					fetchedAt: Date.now()
				};
				preview = nextPreview;
				if (!cancelled) {
					setPreviews(prev => ({ ...prev, [url]: nextPreview }));
					setPreviewFailures(prev => {
						if (!prev.has(url)) return prev;
						const next = new Set(prev);
						next.delete(url);
						return next;
					});
				}
				await saveLinkPreview(nextPreview);
			} catch {
				if (!cancelled && preview === null) {
					setPreviewFailures(prev => new Set(prev).add(url));
				}
			} finally {
				pendingPreviews.current.delete(url);
			}
		};

		urlsInMessages.forEach(url => {
			if (getRecordValue(previews, url) !== undefined || pendingPreviews.current.has(url) || previewFailures.has(url)) return;
			pendingPreviews.current.add(url);
			void fetchPreview(url);
		});

		return () => {
			cancelled = true;
		};
	}, [urlsInMessages, previews, previewFailures]);

	useEffect(() => {
		const images = Object.values(previews)
			.map(preview => preview.image)
			.filter((image): image is string => Boolean(image));

		images.forEach((imageUrl) => {
			if (imageCache.current.has(imageUrl) || pendingImages.current.has(imageUrl)) return;
			pendingImages.current.add(imageUrl);
			void (async () => {
				try {
					const response = await signedFetch(`/api/preview/image?url=${encodeURIComponent(imageUrl)}`);
					if (!response.ok) return;
					const blob = await response.blob();
					const objectUrl = URL.createObjectURL(blob);
					const previous = imageCache.current.get(imageUrl);

					if (previous !== undefined && previous !== objectUrl)
						URL.revokeObjectURL(previous);

					imageCache.current.set(imageUrl, objectUrl);
					setPreviewImages(Object.fromEntries(imageCache.current));
				} finally {
					pendingImages.current.delete(imageUrl);
				}
			})();
		});
	}, [previews]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleScroll = () => {
			void (async () => {
				syncAutoScrollState();

				if (!onLoadMore) return;

				if (!hasMore || isLoadingMore) return;
				if (container.scrollTop > 80) return;

				const previousHeight = container.scrollHeight;
				const previousTop = container.scrollTop;
				setIsLoadingMore(true);

				const loaded = await onLoadMore();
				setIsLoadingMore(false);

				if (loaded === 0) {
					setHasMore(false);
					return;
				}

				requestAnimationFrame(() => {
					const newHeight = container.scrollHeight;
					container.scrollTop = newHeight - previousHeight + previousTop;
				});
			})();
		};

		container.addEventListener('scroll', handleScroll);
		return () => container.removeEventListener('scroll', handleScroll);
	}, [onLoadMore, hasMore, isLoadingMore, syncAutoScrollState]);

	return (
		<RenderIf
			condition={messages.length > 0}
			then={
				<div className="relative flex-1 min-h-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.06),transparent_24%),linear-gradient(180deg,rgba(6,17,29,0.14),rgba(6,17,29,0))]">
					<MediaPreviewOverlay
						active={imagePreview !== null}
						title={imagePreview?.title ?? ''}
						kind="image"
						url={imagePreview?.url ?? ''}
						details={imagePreview?.details}
						onClose={closeImagePreview}
					/>
					<div ref={containerRef} className="h-full space-y-4 overflow-y-auto px-3 pb-6 pt-4 sm:px-4 sm:pt-5">
						<RenderIf condition={isLoadingMore}
							then={<div className="app-text-muted text-center text-xs">Loading older messages…</div>}
							otherwise={null}
						/>
						{messages.map(message => {
							const isOwn = message.senderId === userId;
							const messageUrls = message.content.match(/https?:\/\/[^\s]+/gi) ?? [];
							const messageAttachments = getMessageAttachments(message);
							const directRemoteMediaUrls = messageAttachments.length > 0 ? [] : extractDirectRemoteMediaUrls(message.content);
							const messagePeerId = isOwn ? message.recipientId : message.senderId;
							const previewUrls = messageUrls.filter((match) => !isDirectRemoteMediaUrl(match));
							const renderedPreviewUrls = previewUrls.filter((previewUrl) => getRecordValue(previews, previewUrl) !== undefined || previewFailures.has(previewUrl));
							const visibleMessageContent = stripRenderedUrlsFromContent(message.content, [
								...directRemoteMediaUrls,
								...renderedPreviewUrls
							]);
							const hasTextContent = visibleMessageContent.length > 0;
							const showSwipeHint = swipeMessageId === message.id && swipeOffset > 6;
							const swipeHintOpacity = Math.min(swipeOffset / 60, 1);
							const isReplyHighlighted = highlightedMessageId === message.id;

							return (
								<div
									key={message.id}
									id={`message-${message.id}`}
									className={getMessageRowClassName(isOwn)}
									onTouchStart={(event) => handleTouchStart(message.id, event)}
									onTouchMove={handleTouchMove}
									onTouchEnd={() => handleTouchEnd(message)}
									onTouchCancel={resetSwipe}
								>
									<RenderIf
										condition={numberOfContacts > 1 && isOwn}
										then={
											<SmallGenericButton
												title="Forward message"
												className="self-end text-gray-400 hover:text-white transition-colors"
												onClick={() => onForward?.(message)}
											>
												↪
											</SmallGenericButton>
										}
										otherwise={null}
									/>
									<RenderIf
										condition={showSwipeHint}
										then={
											<div
												className="h-8 w-8 rounded-full bg-primary-600/20 text-primary-200 flex items-center justify-center text-sm"
												style={{ opacity: swipeHintOpacity }}
											>
												↩
											</div>
										}
										otherwise={null}
									/>
									{/* Double-click reply is a pointer shortcut only; keyboard access stays on the dedicated reply button below. */}
									{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
									<div
										className={getMessageBubbleClassName(isOwn, isReplyHighlighted)}
										style={swipeMessageId === message.id ? { transform: `translateX(${swipeOffset}px)`, transition: swipeOffset === 0 ? 'transform 120ms ease-out' : 'none' } : undefined}
										onDoubleClick={() => onReply?.(message)}
									>
										<RenderIf condition={message.replyTo !== undefined}
											then={
												<button
													type="button"
													className={getReplyPreviewClassName(isOwn)}
													onClick={(event) => {
														event.stopPropagation();
														scheduleQuoteScroll(message.replyTo?.id);
													}}
													onDoubleClick={(event) => {
														event.stopPropagation();
														cancelQuoteScroll();
														onReply?.(message);
													}}
												>
													<p className="font-semibold">{replyAuthor(message.replyTo?.senderId, userId, peerDisplayName)}</p>
													<p className="line-clamp-2 wrap-break-words">{getReplyPreviewText(message.replyTo)}</p>
												</button>
											}
											otherwise={null}
										/>
										<RenderIf condition={messageAttachments.length > 0}
											then={
												<div className="space-y-2">
													{messageAttachments.map((attachment) => {
														const downloadState = attachmentDownloads[attachment.id] ?? { status: 'idle', progress: 0 };
														const localAttachmentId = resolveLocalAttachmentId(attachment);
														const localAttachment = getRecordValue(localAttachments, localAttachmentId);
														const localAttachmentUrl = getRecordValue(localAttachmentUrls, localAttachmentId);
														const hasStoredLocalAttachment = hasLocalAttachment(localAttachment);
														const progressLabel = getAttachmentActionLabel(downloadState, hasStoredLocalAttachment);

														return (
															<div key={attachment.id} className="app-panel-muted rounded-[1.15rem] px-3 py-3">
																{attachment.kind === 'image' && localAttachmentUrl !== undefined ? (
																	<button
																		type="button"
																		className="mb-3 block w-full cursor-zoom-in rounded-xl"
																		onClick={() => openImagePreview(
																			attachment.name,
																			localAttachmentUrl,
																			`${attachment.kind ?? 'image'} • ${formatFileSize(attachment.size)}`
																		)}
																	>
																		<img
																			src={localAttachmentUrl}
																			alt={attachment.name}
																			className="max-h-56 w-full rounded-xl object-cover"
																			onLoad={handleMediaLayoutReady}
																		/>
																	</button>
																) : null}
																{attachment.kind === 'audio' && localAttachmentUrl !== undefined ? <audio controls preload="metadata" className="mb-3 w-full" src={localAttachmentUrl} onLoadedMetadata={handleMediaLayoutReady} /> : null}
																{attachment.kind === 'video' && localAttachmentUrl !== undefined ? <video controls preload="metadata" className="mb-3 max-h-72 w-full rounded-xl bg-black" src={localAttachmentUrl} onLoadedMetadata={handleMediaLayoutReady} /> : null}
																<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
																	<div className="min-w-0">
																		<p className="truncate text-sm font-semibold text-white">{attachment.name}</p>
																		<p className="app-text-muted text-xs">
																			{attachment.kind ?? 'file'} • {formatFileSize(attachment.size)}
																		</p>
																		<RenderIf condition={hasStoredLocalAttachment}
																			then={<p className="mt-1 text-[0.8rem] text-green-300">Stored locally in this browser</p>}
																			otherwise={null}
																		/>
																	</div>
																	<SmallGenericButton
																		title={`${hasStoredLocalAttachment ? 'Save on device' : 'Download'} ${attachment.name}`}
																		onClick={() => {
																			void handleAttachmentDownload(attachment, message);
																		}}
																		disabled={downloadState.status === 'downloading'}
																		className="w-full sm:w-auto"
																	>
																		{progressLabel}
																	</SmallGenericButton>
																</div>
																<RenderIf condition={downloadState.status === 'downloading'}
																	then={
																		<>
																			<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
																				<div className="h-full rounded-full bg-primary-300 transition-all" style={{ width: `${Math.round(downloadState.progress * 100)}%` }} />
																			</div>
																			<p className="mt-2 text-xs text-primary-100/80">{getAttachmentContinuationHint('download')}</p>
																		</>
																	}
																	otherwise={null}
																/>
																<RenderIf condition={downloadState.status === 'failed' && downloadState.error !== undefined}
																	then={<p className="mt-2 text-xs text-red-300">{downloadState.error}</p>}
																	otherwise={null}
																/>
															</div>
														);
													})}
												</div>
											}
											otherwise={null}
										/>
										<RenderIf
											condition={directRemoteMediaUrls.length > 0}
											then={
												<div>
													{directRemoteMediaUrls.map((mediaUrl, index) => (
														<RemoteInlineMedia
															key={`${message.id}-remote-media-${index}-${mediaUrl}`}
															url={mediaUrl}
															alt={getSharedImageAlt(message.content, directRemoteMediaUrls.length, index)}
															peerId={messagePeerId}
															messageId={message.id}
															onLoad={handleMediaLayoutReady}
															imgProps={{
																onClick: () => openImagePreview(
																	getSharedImageAlt(message.content, directRemoteMediaUrls.length, index),
																	mediaUrl,
																	'Shared in this conversation'
																)
															}}
															imageClassName="cursor-zoom-in"
														/>
													))}
												</div>
											}
											otherwise={null}
										/>
										<RenderIf condition={hasTextContent}
											then={<p className="wrap-break-words whitespace-pre-line">{visibleMessageContent}</p>}
											otherwise={null}
										/>
										{previewUrls.map((previewUrl, index) => {
											const preview = getRecordValue(previews, previewUrl);
											const previewFailed = previewFailures.has(previewUrl);
											const previewImage = getOptionalNonEmptyString(preview?.image);
											const previewImageSrc = previewImage ? getRecordValue(previewImages, previewImage) : undefined;

											if (preview !== undefined) {
												return (
													<a
														key={`${message.id}-preview-${index}-${previewUrl}`}
														href={preview.url}
														target="_blank"
														rel="noopener noreferrer"
														className="app-panel-muted mt-3 block w-full max-w-full overflow-hidden transition-[transform,background-color] hover:-translate-y-px hover:bg-dark-200 sm:max-w-md"
													>
														<RenderIf condition={previewImageSrc !== undefined}
															then={
																<img
																	src={previewImageSrc}
																	alt={getNonEmptyStringOrFallback(preview.title, 'Preview')}
																	className="w-full h-24 object-cover"
																/>
															}
															otherwise={null}
														/>
														<div className="p-3">
															<RenderIf condition={preview.siteName !== undefined}
																then={<p className="app-text-muted mb-1 text-xs">{preview.siteName}</p>}
																otherwise={null}
															/>
															<p className="text-sm font-semibold text-white line-clamp-2">
																{getNonEmptyStringOrFallback(preview.title, preview.url)}
															</p>
															<RenderIf condition={preview.description !== undefined}
																then={<p className="app-text-muted mt-1 line-clamp-2 text-xs">{preview.description}</p>}
																otherwise={null}
															/>
														</div>
													</a>
												);
											}

											if (previewFailed) {
												return (
													<a
														key={`${message.id}-preview-fallback-${index}-${previewUrl}`}
														href={previewUrl}
														target="_blank"
														rel="noopener noreferrer"
														className="mt-3 block text-xs text-primary-200 underline break-all"
													>
														{previewUrl}
													</a>
												);
											}

											return null;
										})}
										<RenderIf
											condition={onReply !== undefined}
											then={
												<button
													type="button"
													className="app-sr-only-focusable"
													onClick={() => onReply?.(message)}
													aria-label={getReplyActionLabel(message, userId, peerDisplayName)}
													title={getReplyActionLabel(message, userId, peerDisplayName)}
												>
													Reply to this message
												</button>
											}
											otherwise={null}
										/>
										<div className={getMessageMetaClassName(isOwn)}>
											<span>{formatTime(message.timestamp)}
												<RenderIf
													condition={isOwn}
													then={<span> &nbsp;•&nbsp; </span>}
													otherwise={null}
												/>
											</span>
											<RenderIf
												condition={isOwn}
												then={
													<RenderSwitch
														value={message.status}
														cases={{
															'failed': (
																<button
																	type="button"
																	onClick={() => void retrySend(message.id)}
																	className="inline-flex items-center gap-1 text-red-300 hover:text-red-200 transition-colors cursor-pointer"
																	title="Retry sending"
																>
																	<span>❌</span>
																	<span className="text-[0.75rem]">Retry</span>
																</button>
															),
															'pending': <span>🕒</span>,
															'sent': <span className="text-white/70 text-sm">✓</span>,
															'delivered': <span className="text-white/70 text-sm">✓✓</span>,
															'read': (
																<span className="inline-flex items-center gap-1 text-white/70 text-sm">
																	<span>✓✓</span>
																	<Eye />
																</span>
															),
														}}
														defaultCase={null}
													/>
												}
												otherwise={null}
											/>
										</div>
									</div>
									<RenderIf
										condition={numberOfContacts > 1 && !isOwn}
										then={
											<SmallGenericButton
												title="Forward message"
												className="self-end text-gray-400 hover:text-white transition-colors"
												onClick={() => onForward?.(message)}
											>
												↪
											</SmallGenericButton>
										}
										otherwise={null}
									/>
								</div>
							);
						})}
						<div data-scroll-anchor="bottom" className="h-px w-full" aria-hidden="true" />
					</div>
					<RenderIf
						condition={unseenMessageCount > 0}
						then={
							<div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
								<button
									type="button"
									onClick={jumpToLatestMessages}
									className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-primary-400/30 bg-dark-200/92 px-4 py-2 text-sm text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] backdrop-blur transition-colors hover:bg-dark-100"
								>
									<span>{unseenMessageCount === 1 ? '1 new message' : `${unseenMessageCount} new messages`}</span>
									<ArrowUp direction="down" className="h-4 w-4 text-primary-200" />
								</button>
							</div>
						}
						otherwise={null}
					/>
				</div>
			}
			otherwise={
				<div className="flex flex-1 items-center justify-center px-4 py-6 text-gray-500">
					<div className="app-panel-muted max-w-sm px-5 py-6 text-center">
						<p className="app-display-title text-base text-white">No messages yet</p>
						<p className="app-text-muted mt-2 text-sm">Send a message, share a GIF, or attach a file to start this conversation.</p>
					</div>
				</div>
			}
		/>
	);
};

export default MessageList;