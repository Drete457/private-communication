// MessagesStore - Manages message state and history
import { create } from 'zustand';

import { clientLogger } from '@/services/logger';
import {
	sendMessage,
	retryFailedMessage,
	processIncomingMessage,
	getMessageHistory,
	getMessageById,
	saveLocalMessage,
	updateMessageStatus,
	flushOutbox
} from '@/services/message-service';
import { webSocketService } from '@/services/web-socket-service';
import { useAuthStore } from '@/store/auth-store';
import type { MessageAttachment, DecryptedMessage, MessageType, ReplyReference } from '@/types';

interface MessagesState {
	messages: Map<string, DecryptedMessage[]>; // keyed by peerId
	loadedPeerHistories: Set<string>;
	isLoading: boolean;

	// Actions
	initializeListeners: () => void;
	loadMessages: (peerId: string) => Promise<void>;
	loadMore: (peerId: string) => Promise<number>;
	send: (peerId: string, content: string, replyTo?: ReplyReference, attachments?: MessageAttachment[]) => Promise<void>;
	markAsDelivered: (messageId: string) => Promise<void>;
	markAsRead: (messageId: string, senderId?: string, sendReceipt?: boolean) => Promise<void>;
	markAsSent: (messageId: string) => Promise<void>;
	markAsFailed: (messageId: string) => Promise<void>;
	retrySend: (messageId: string) => Promise<void>;
	appendCallEvent: (peerId: string, content: string, type: MessageType) => Promise<void>;
}

let listenersInitialized = false;

const upsertAndSortMessages = (
	peerMessages: DecryptedMessage[],
	message: DecryptedMessage
): DecryptedMessage[] => {
	const filtered = peerMessages.filter(m => m.id !== message.id);
	return [...filtered, message].sort((a, b) => a.timestamp - b.timestamp);
};

const mergeAndSortMessages = (
	existing: DecryptedMessage[],
	incoming: DecryptedMessage[]
): DecryptedMessage[] => {
	const merged = new Map<string, DecryptedMessage>();

	for (const message of existing) {
		merged.set(message.id, message);
	}

	for (const message of incoming) {
		merged.set(message.id, message);
	}

	return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
};

const getStoredPeerMessages = (messages: Map<string, DecryptedMessage[]>, peerId: string): DecryptedMessage[] => (
	messages.get(peerId) ?? []
);

const hasAttachments = (attachments: MessageAttachment[] | undefined): boolean => (
	attachments !== undefined && attachments.length > 0
);

const useMessagesStore = create<MessagesState>((set, get) => ({
	messages: new Map(),
	loadedPeerHistories: new Set(),
	isLoading: false,

	// Set up WebSocket listeners for incoming messages
	initializeListeners: () => {
		if (listenersInitialized) {
			return;
		}
		listenersInitialized = true;

		webSocketService.on('incoming_message', (encryptedMessage) => {
			void (async () => {
				try {
					const decryptedMessage = await processIncomingMessage(encryptedMessage);

					set(state => {
						const messages = new Map(state.messages);
						const peerMessages = getStoredPeerMessages(messages, decryptedMessage.senderId);
						messages.set(
							decryptedMessage.senderId,
							upsertAndSortMessages(peerMessages, decryptedMessage)
						);
						return { messages };
					});
				} catch (error) {
					clientLogger.error('Failed to process incoming message:', error);
				}
			})();
		});

		webSocketService.on('send_failed', (sendErrorData) => {
			void (async () => {
				if (sendErrorData.event !== 'send_message') {
					return;
				}

				await get().markAsFailed(sendErrorData.data.id);
			})();
		});

		webSocketService.on('delivery_receipt', ({ messageId, status }) => {
			void (async () => {
				if (status === 'delivered') {
					await get().markAsDelivered(messageId);
				} else if (status === 'read') {
					await get().markAsRead(messageId, undefined, false);
				} else {
					await updateMessageStatus(messageId, 'pending');

					set(state => {
						const messages = new Map(state.messages);
						for (const [peerId, peerMessages] of messages) {
							const updatedMessages = peerMessages.map(m =>
								m.id === messageId ? { ...m, status: 'pending' as const } : m
							);
							messages.set(peerId, updatedMessages);
						}
						return { messages };
					});
				}

				if (messageId && (status === 'delivered' || status === 'read')) {
					webSocketService.send('receipt_ack', { messageId, status });
				}

				if (messageId && (status === 'delivered' || status === 'read')) {
					const updated = await getMessageById(messageId);
					const userId = useAuthStore.getState().userId;

					if (updated && userId) {
						const peerId = updated.senderId === userId ? updated.recipientId : updated.senderId;
						set(state => {
							const messagesMap = new Map(state.messages);
							const peerMessages = getStoredPeerMessages(messagesMap, peerId);
							const merged = upsertAndSortMessages(peerMessages, {
								...updated,
								status: status === 'read' ? 'read' : 'delivered'
							});
							messagesMap.set(peerId, merged);
							return { messages: messagesMap };
						});
					}
				}
			})();
		});

		// Handle queued messages (delivered when coming online)
		webSocketService.on('queued_messages', ({ messages }) => {
			void (async () => {
				for (const encryptedMessage of messages) {
					try {
						const decryptedMessage = await processIncomingMessage(encryptedMessage);

						set(state => {
							const messagesMap = new Map(state.messages);
							const peerMessages = getStoredPeerMessages(messagesMap, decryptedMessage.senderId);
							messagesMap.set(
								decryptedMessage.senderId,
								upsertAndSortMessages(peerMessages, decryptedMessage)
							);
							return { messages: messagesMap };
						});
					} catch (error) {
						clientLogger.error('Failed to process queued message:', error);
					}
				}
			})();
		});

		webSocketService.on('auth_success', () => {
			void (async () => {
				const { sentIds, failedIds } = await flushOutbox();
				for (const id of sentIds) {
					await get().markAsSent(id);
				}
				for (const id of failedIds) {
					await get().markAsFailed(id);
				}
			})();
		});
	},

	// Load message history for a peer
	loadMessages: async (peerId: string) => {
		set({ isLoading: true });

		try {
			const history = await getMessageHistory(peerId);

			set(state => {
				const messages = new Map(state.messages);
				const existingMessages = getStoredPeerMessages(messages, peerId);
				messages.set(peerId, mergeAndSortMessages(existingMessages, history));
				const loadedPeerHistories = new Set(state.loadedPeerHistories);
				loadedPeerHistories.add(peerId);
				return { messages, loadedPeerHistories, isLoading: false };
			});
		} catch (error) {
			clientLogger.error('Failed to load messages:', error);
			set({ isLoading: false });
		}
	},

	// Load older messages for a peer
	loadMore: async (peerId: string) => {
		const existing = getStoredPeerMessages(get().messages, peerId);
		const oldest = existing[0]?.timestamp;
		const history = await getMessageHistory(peerId, 50, oldest);
		if (history.length === 0) {
			return 0;
		}

		set(state => {
			const messages = new Map(state.messages);
			const peerMessages = getStoredPeerMessages(messages, peerId);
			messages.set(peerId, mergeAndSortMessages(peerMessages, history));
			return { messages };
		});

		return history.length;
	},

	// Send a message to a peer
	send: async (peerId: string, content: string, replyTo?: ReplyReference, attachments?: MessageAttachment[]) => {
		const message = await sendMessage(peerId, content, hasAttachments(attachments) ? 'file' : 'text', replyTo, attachments);

		set(state => {
			const messages = new Map(state.messages);
			const peerMessages = getStoredPeerMessages(messages, peerId);
			messages.set(peerId, upsertAndSortMessages(peerMessages, message));
			return { messages };
		});
	},

	// Mark a message as delivered
	markAsDelivered: async (messageId: string) => {
		await updateMessageStatus(messageId, 'delivered');

		set(state => {
			const messages = new Map(state.messages);
			for (const [peerId, peerMessages] of messages) {
				const updatedMessages = peerMessages.map(m =>
					m.id === messageId ? { ...m, status: 'delivered' as const } : m
				);
				messages.set(peerId, updatedMessages);
			}
			return { messages };
		});
	},

	// Mark a message as read and notify sender
	markAsRead: async (messageId: string, senderId?: string, sendReceipt = true) => {
		await updateMessageStatus(messageId, 'read');

		if (sendReceipt && senderId) {
			webSocketService.send('message_read', { messageId, senderId });
		}

		set(state => {
			const messages = new Map(state.messages);
			for (const [peerId, peerMessages] of messages) {
				const updatedMessages = peerMessages.map(m =>
					m.id === messageId ? { ...m, status: 'read' as const } : m
				);
				messages.set(peerId, updatedMessages);
			}
			return { messages };
		});
	},

	// Mark a message as sent (used for outbox flush)
	markAsSent: async (messageId: string) => {
		await updateMessageStatus(messageId, 'sent');

		set(state => {
			const messages = new Map(state.messages);
			for (const [peerId, peerMessages] of messages) {
				const updatedMessages = peerMessages.map(m =>
					m.id === messageId ? { ...m, status: 'sent' as const } : m
				);
				messages.set(peerId, updatedMessages);
			}
			return { messages };
		});
	},

	// Mark a message as failed (outbox retry limit reached)
	markAsFailed: async (messageId: string) => {
		await updateMessageStatus(messageId, 'failed');

		set(state => {
			const messages = new Map(state.messages);
			for (const [peerId, peerMessages] of messages) {
				const updatedMessages = peerMessages.map(m =>
					m.id === messageId ? { ...m, status: 'failed' as const } : m
				);
				messages.set(peerId, updatedMessages);
			}
			return { messages };
		});
	},

	// Retry a failed message
	retrySend: async (messageId: string) => {
		const status = await retryFailedMessage(messageId);
		set(state => {
			const messages = new Map(state.messages);
			for (const [peerId, peerMessages] of messages) {
				const updatedMessages = peerMessages.map(m =>
					m.id === messageId ? { ...m, status } : m
				);
				messages.set(peerId, updatedMessages);
			}
			return { messages };
		});
	},

	appendCallEvent: async (peerId: string, content: string, type: MessageType) => {
		const { userId } = useAuthStore.getState();
		if (!userId) {
			return;
		}

		const callEvent: DecryptedMessage = {
			id: crypto.randomUUID(),
			senderId: userId,
			recipientId: peerId,
			timestamp: Date.now(),
			content,
			type,
			status: 'read'
		};

		await saveLocalMessage(callEvent);

		set(state => {
			const messages = new Map(state.messages);
			const peerMessages = getStoredPeerMessages(messages, peerId);
			messages.set(peerId, upsertAndSortMessages(peerMessages, callEvent));
			return { messages };
		});
	}
}));

export { useMessagesStore };
