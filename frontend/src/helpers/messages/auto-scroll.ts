import type { DecryptedMessage } from '@/types';

type AutoScrollDecision = {
	shouldAutoScroll: boolean;
	scrollBehavior: ScrollBehavior;
	lockToBottom: boolean;
	unseenIncomingCount: number;
};

const getAppendedMessages = (
	previousMessages: ReadonlyArray<DecryptedMessage>,
	nextMessages: ReadonlyArray<DecryptedMessage>
) => {
	if (nextMessages.length <= previousMessages.length || previousMessages.length === 0)
		return [];

	const previousIsPrefix = previousMessages.every(
		(message, index) => nextMessages[index]?.id === message.id
	);

	if (!previousIsPrefix)
		return [];

	return nextMessages.slice(previousMessages.length);
};

const isHistoryPrepend = (
	previousMessages: ReadonlyArray<DecryptedMessage>,
	nextMessages: ReadonlyArray<DecryptedMessage>
) => {
	if (nextMessages.length <= previousMessages.length || previousMessages.length === 0)
		return false;

	const offset = nextMessages.length - previousMessages.length;

	return previousMessages.every(
		(message, index) => nextMessages[index + offset]?.id === message.id
	);
};

const resolveMessageAutoScrollDecision = ({
	previousMessages,
	nextMessages,
	userId,
	wasNearBottom
}: {
	previousMessages: ReadonlyArray<DecryptedMessage>;
	nextMessages: ReadonlyArray<DecryptedMessage>;
	userId?: string | null | undefined;
	wasNearBottom: boolean;
}): AutoScrollDecision => {
	const isInitialLoad = previousMessages.length === 0 && nextMessages.length > 0;
	const appendedMessages = getAppendedMessages(previousMessages, nextMessages);
	const historyPrepended = isHistoryPrepend(previousMessages, nextMessages);

	if (isInitialLoad) {
		return {
			shouldAutoScroll: true,
			scrollBehavior: 'auto',
			lockToBottom: true,
			unseenIncomingCount: 0
		};
	}

	if (historyPrepended) {
		return {
			shouldAutoScroll: false,
			scrollBehavior: 'auto',
			lockToBottom: false,
			unseenIncomingCount: 0
		};
	}

	if (appendedMessages.length > 0) {
		const hasOwnAppendedMessage = appendedMessages.some((message) => message.senderId === userId);
		const incomingAppendedMessages = appendedMessages.filter((message) => message.senderId !== userId);
		const hasIncomingAppendedMessage = incomingAppendedMessages.length > 0;

		if (hasOwnAppendedMessage) {
			return {
				shouldAutoScroll: true,
				scrollBehavior: 'smooth',
				lockToBottom: true,
				unseenIncomingCount: 0
			};
		}

		if (hasIncomingAppendedMessage && wasNearBottom) {
			return {
				shouldAutoScroll: true,
				scrollBehavior: 'smooth',
				lockToBottom: false,
				unseenIncomingCount: 0
			};
		}

		if (hasIncomingAppendedMessage) {
			return {
				shouldAutoScroll: false,
				scrollBehavior: 'auto',
				lockToBottom: false,
				unseenIncomingCount: incomingAppendedMessages.length
			};
		}
	}

	return {
		shouldAutoScroll: false,
		scrollBehavior: 'auto',
		lockToBottom: false,
		unseenIncomingCount: 0
	};
};

export { resolveMessageAutoScrollDecision };