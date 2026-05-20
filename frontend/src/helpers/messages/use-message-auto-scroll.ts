import { useCallback, useEffect, useRef, useState } from 'react';

import type { DecryptedMessage } from '@/types';

import { resolveMessageAutoScrollDecision } from './auto-scroll';

import type { RefObject, SetStateAction} from 'react';

const AUTO_SCROLL_THRESHOLD_PX = 120;

const useMessageAutoScroll = ({
	containerRef,
	conversationKey,
	messages,
	previewImages,
	attachmentPreviewUrls,
	userId
}: {
	containerRef: RefObject<HTMLDivElement | null>;
	conversationKey?: string | null | undefined;
	messages: ReadonlyArray<DecryptedMessage>;
	previewImages: Record<string, string>;
	attachmentPreviewUrls?: Record<string, string>;
	userId?: string | null | undefined;
}) => {
	const pendingScrollFrames = useRef<number[]>([]);
	const pendingUnseenCountFrames = useRef<number[]>([]);
	const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
	const shouldAutoScrollRef = useRef<boolean>(true);
	const previousMessagesRef = useRef<ReadonlyArray<DecryptedMessage>>([]);
	const [unseenMessageCount, setUnseenMessageCount] = useState<number>(0);
	const latestMessage = messages.at(-1);
	const latestMessageHasAttachments = (latestMessage?.attachments?.length ?? 0) > 0;

	const cancelPendingScrollFrames = useCallback(() => {
		pendingScrollFrames.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
		pendingScrollFrames.current = [];
	}, []);

	const cancelPendingUnseenCountFrames = useCallback(() => {
		pendingUnseenCountFrames.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
		pendingUnseenCountFrames.current = [];
	}, []);

	const scheduleUnseenMessageCount = useCallback((nextValue: SetStateAction<number>) => {
		const frameId = window.requestAnimationFrame(() => {
			pendingUnseenCountFrames.current = pendingUnseenCountFrames.current.filter((id) => id !== frameId);
			setUnseenMessageCount(nextValue);
		});

		pendingUnseenCountFrames.current.push(frameId);
	}, []);

	const isNearBottom = useCallback((container: HTMLDivElement) => {
		return container.scrollHeight - container.scrollTop - container.clientHeight <= AUTO_SCROLL_THRESHOLD_PX;
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
		const container = containerRef.current;
		if (!container)
			return;

		container.scrollTo({
			top: container.scrollHeight,
			behavior
		});
	}, [containerRef]);

	const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
		cancelPendingScrollFrames();
		pendingScrollBehaviorRef.current = behavior;

		if (behavior === 'smooth') {
			pendingScrollFrames.current = [
				window.requestAnimationFrame(() => scrollToBottom(pendingScrollBehaviorRef.current))
			];
			return;
		}

		pendingScrollFrames.current = [
			window.requestAnimationFrame(() => scrollToBottom(pendingScrollBehaviorRef.current)),
			window.requestAnimationFrame(() => {
				pendingScrollFrames.current.push(
					window.requestAnimationFrame(() => {
						scrollToBottom(pendingScrollBehaviorRef.current);

						if (latestMessageHasAttachments) {
							pendingScrollFrames.current.push(
								window.requestAnimationFrame(() => scrollToBottom(pendingScrollBehaviorRef.current)),
								window.requestAnimationFrame(() => {
									pendingScrollFrames.current.push(
										window.requestAnimationFrame(() => scrollToBottom(pendingScrollBehaviorRef.current))
									);
								})
							);
						}
					})
				);
			})
		];
	}, [cancelPendingScrollFrames, latestMessageHasAttachments, scrollToBottom]);

	const syncAutoScrollState = useCallback(() => {
		const container = containerRef.current;
		if (!container)
			return;

		shouldAutoScrollRef.current = isNearBottom(container);
		if (shouldAutoScrollRef.current) {
			cancelPendingUnseenCountFrames();
			setUnseenMessageCount(0);
		}
	}, [containerRef, isNearBottom, cancelPendingUnseenCountFrames]);

	const jumpToLatestMessages = useCallback(() => {
		shouldAutoScrollRef.current = true;
		cancelPendingUnseenCountFrames();
		setUnseenMessageCount(0);
		scheduleScrollToBottom('smooth');
	}, [cancelPendingUnseenCountFrames, scheduleScrollToBottom]);

	const requestAutoScroll = useCallback(() => {
		if (!shouldAutoScrollRef.current)
			return;

		scheduleScrollToBottom('auto');
	}, [scheduleScrollToBottom]);

	useEffect(() => {
		cancelPendingScrollFrames();
		cancelPendingUnseenCountFrames();
		shouldAutoScrollRef.current = true;
		previousMessagesRef.current = [];
		scheduleUnseenMessageCount(0);

		if (messages.length > 0)
			scheduleScrollToBottom('auto');
	}, [conversationKey, messages.length, scheduleScrollToBottom, cancelPendingScrollFrames, cancelPendingUnseenCountFrames, scheduleUnseenMessageCount]);

	useEffect(() => {
		const previousMessages = previousMessagesRef.current;
		const { shouldAutoScroll, scrollBehavior, lockToBottom, unseenIncomingCount } = resolveMessageAutoScrollDecision({
			previousMessages,
			nextMessages: messages,
			userId,
			wasNearBottom: shouldAutoScrollRef.current
		});

		if (lockToBottom) {
			shouldAutoScrollRef.current = true;
			scheduleUnseenMessageCount(0);
		} else if (unseenIncomingCount > 0) {
			scheduleUnseenMessageCount((current) => current + unseenIncomingCount);
		}

		previousMessagesRef.current = messages;

		if (shouldAutoScroll)
			scheduleScrollToBottom(scrollBehavior);

		return () => {
			cancelPendingScrollFrames();
		};
	}, [messages, userId, scheduleScrollToBottom, cancelPendingScrollFrames, scheduleUnseenMessageCount]);

	useEffect(() => {
		if (shouldAutoScrollRef.current)
			scheduleScrollToBottom('auto');
	}, [previewImages, attachmentPreviewUrls, scheduleScrollToBottom]);

	useEffect(() => {
		return () => {
			cancelPendingScrollFrames();
			cancelPendingUnseenCountFrames();
		};
	}, [cancelPendingScrollFrames, cancelPendingUnseenCountFrames]);

	return {
		requestAutoScroll,
		syncAutoScrollState,
		jumpToLatestMessages,
		unseenMessageCount
	};
};

export { useMessageAutoScroll };