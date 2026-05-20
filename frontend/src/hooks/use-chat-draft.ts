import { useCallback, useEffect, useRef, useState } from 'react';

import { clearChatDraft, loadChatDraft, saveChatDraft } from '@/services/chat-draft-store';

type UseChatDraftInput = {
	userId: string | null;
	peerId: string;
};

type UseChatDraftResult = {
	message: string;
	setMessage: (nextMessage: string) => void;
	clearMessage: () => void;
};

type ChatDraftState = {
	scopeKey: string;
	message: string;
	ready: boolean;
};

const CHAT_DRAFT_SAVE_DEBOUNCE_MS = 150;

const getChatDraftScopeKey = (userId: string | null, peerId: string): string => `${userId ?? 'anonymous'}:${peerId}`;

const createPendingDraftState = (scopeKey: string): ChatDraftState => ({
	scopeKey,
	message: '',
	ready: false
});

const createReadyDraftState = (scopeKey: string, message: string): ChatDraftState => ({
	scopeKey,
	message,
	ready: true
});

const resolveActiveDraftState = (draftState: ChatDraftState, scopeKey: string): ChatDraftState => {
	if (draftState.scopeKey === scopeKey)
		return draftState;

	return createPendingDraftState(scopeKey);
}

const useChatDraft = ({ userId, peerId }: UseChatDraftInput): UseChatDraftResult => {
	const hasUserEditedRef = useRef<boolean>(false);
	const scopeKey = getChatDraftScopeKey(userId, peerId);
	const [draftState, setDraftState] = useState<ChatDraftState>(() => createPendingDraftState(scopeKey));
	const activeDraftState = resolveActiveDraftState(draftState, scopeKey);
	const message = activeDraftState.message;
	const isDraftReady = activeDraftState.ready;

	useEffect(() => {
		hasUserEditedRef.current = false;

		if (!userId)
			return;

		let canceled = false;

		void loadChatDraft({ userId, peerId }).then((draft) => {
			if (canceled)
				return;

			setDraftState((current) => {
				if (hasUserEditedRef.current && current.scopeKey === scopeKey)
					return { ...current, ready: true };

				return createReadyDraftState(scopeKey, draft);
			});
		});

		return () => {
			canceled = true;
		};
	}, [peerId, scopeKey, userId]);

	useEffect(() => {
		if (!userId || !isDraftReady)
			return;

		const timeoutId = window.setTimeout(() => {
			if (message.length === 0) {
				clearChatDraft({ userId, peerId });
				return;
			}

			void saveChatDraft({
				userId,
				peerId,
				draft: message
			});
		}, CHAT_DRAFT_SAVE_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [isDraftReady, message, peerId, userId]);

	const setMessage = useCallback((nextMessage: string) => {
		hasUserEditedRef.current = true;
		setDraftState(createReadyDraftState(scopeKey, nextMessage));
	}, [scopeKey]);

	const clearMessage = useCallback(() => {
		hasUserEditedRef.current = false;
		setDraftState(createReadyDraftState(scopeKey, ''));

		if (userId)
			clearChatDraft({ userId, peerId });
	}, [peerId, scopeKey, userId]);

	return {
		message,
		setMessage,
		clearMessage
	};
};

export { useChatDraft };
export type { UseChatDraftInput, UseChatDraftResult };