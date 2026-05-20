// WebSocketService - Persistent WebSocket connection for signaling

/* Handles:
 * - Connection management with automatic reconnection
 * - Challenge-response authentication
 * - Message routing for the signaling protocol
 */

import { signData, exportPublicKey } from '@/crypto/crypto-service';
import { getKeyPair } from '@/crypto/key-manager';
import { clientLogger } from '@/services/logger';
import type {
	AuthChallenge,
	CallType,
	ClientWebSocketEvent,
	ClientWebSocketEventMap,
	EncryptedMessage,
	SendFailedWebSocketEvent,
	ServerSocketMessage,
	SignalEventData,
	SignalType,
	WebSocketServiceEvent,
	WebSocketServiceEventMap
} from '@/types';

type EventCallback<Event extends WebSocketServiceEvent> = (data: WebSocketServiceEventMap[Event]) => void;

type WebSocketMessageRecordKey =
	| 'callType'
	| 'cipherText'
	| 'data'
	| 'encryptionPublicKey'
	| 'ephemeralPublicKey'
	| 'event'
	| 'expiresAt'
	| 'fingerprint'
	| 'forceRelay'
	| 'iceRestart'
	| 'id'
	| 'iv'
	| 'messageId'
	| 'messages'
	| 'nonce'
	| 'onlinePeers'
	| 'payload'
	| 'reason'
	| 'recipientId'
	| 'renegotiate'
	| 'retryable'
	| 'senderId'
	| 'senderKeys'
	| 'signalType'
	| 'signature'
	| 'signingPublicKey'
	| 'status'
	| 'success'
	| 'targetId'
	| 'timestamp'
	| 'type'
	| 'userId';

type WebSocketMessageRecord = Record<string, unknown> & Partial<Record<WebSocketMessageRecordKey, unknown>>;

const SIGNAL_TYPES = ['offer', 'answer', 'candidate', 'hangup'] as const;
const DELIVERY_RECEIPT_STATUSES = ['queued', 'delivered', 'read'] as const;

const isRecord = (value: unknown): value is WebSocketMessageRecord =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isSignalType = (value: unknown): value is SignalType =>
	typeof value === 'string' && SIGNAL_TYPES.includes(value as SignalType);

const isCallType = (value: unknown): value is CallType =>
	value === 'audio' || value === 'video';

const isOptionalBoolean = (value: unknown): value is boolean | undefined =>
	value === undefined || typeof value === 'boolean';

const isOptionalNumber = (value: unknown): value is number | undefined =>
	value === undefined || (typeof value === 'number' && Number.isFinite(value));

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

const isAuthChallenge = (data: unknown): data is AuthChallenge =>
	isRecord(data) && typeof data.nonce === 'string' && typeof data.timestamp === 'number';

const isReasonPayload = (data: unknown): data is { reason: string } =>
	isRecord(data) && typeof data.reason === 'string';

const isAuthSuccessPayload = (data: unknown): data is { userId: string } =>
	isRecord(data) && typeof data.userId === 'string';

const isKeyRegisteredPayload = (data: unknown): data is { success: boolean } =>
	isRecord(data) && typeof data.success === 'boolean';

const isEncryptedMessage = (data: unknown): data is EncryptedMessage => {
	if (!isRecord(data) || !isRecord(data.payload))
		return false;

	if (data.senderKeys !== undefined) {
		const senderKeys = data.senderKeys;
		if (!isRecord(senderKeys))
			return false;
		if (typeof senderKeys.encryptionPublicKey !== 'string' || typeof senderKeys.signingPublicKey !== 'string')
			return false;
		if (!isOptionalString(senderKeys.fingerprint))
			return false;
	}

	return typeof data.id === 'string'
		&& typeof data.senderId === 'string'
		&& typeof data.recipientId === 'string'
		&& typeof data.timestamp === 'number'
		&& typeof data.signature === 'string'
		&& typeof data.payload.iv === 'string'
		&& typeof data.payload.cipherText === 'string'
		&& isOptionalString(data.payload.ephemeralPublicKey);
};

const isDeliveryReceiptPayload = (data: unknown): data is WebSocketServiceEventMap['delivery_receipt'] =>
	isRecord(data)
	&& typeof data.messageId === 'string'
	&& typeof data.status === 'string'
	&& DELIVERY_RECEIPT_STATUSES.includes(data.status as WebSocketServiceEventMap['delivery_receipt']['status']);

const isSignalEventData = (data: unknown): data is SignalEventData =>
	isRecord(data)
	&& isSignalType(data.type)
	&& typeof data.senderId === 'string'
	&& (data.payload === undefined || isRecord(data.payload))
	&& (data.callType === undefined || isCallType(data.callType))
	&& isOptionalBoolean(data.renegotiate)
	&& isOptionalBoolean(data.iceRestart)
	&& isOptionalBoolean(data.forceRelay)
	&& isOptionalString(data.reason);

const isSignalFailedPayload = (data: unknown): data is WebSocketServiceEventMap['signal_failed'] =>
	isRecord(data)
	&& typeof data.targetId === 'string'
	&& isSignalType(data.signalType)
	&& typeof data.retryable === 'boolean'
	&& isOptionalNumber(data.expiresAt)
	&& typeof data.reason === 'string';

const isCallBusyPayload = (data: unknown): data is WebSocketServiceEventMap['call_busy'] =>
	isRecord(data) && typeof data.targetId === 'string' && typeof data.reason === 'string';

const isPeerPresencePayload = (data: unknown): data is WebSocketServiceEventMap['peer_online'] =>
	isRecord(data) && typeof data.userId === 'string';

const isPeersListPayload = (data: unknown): data is WebSocketServiceEventMap['peers_list'] =>
	isRecord(data) && isStringArray(data.onlinePeers);

const isQueuedMessagesPayload = (data: unknown): data is WebSocketServiceEventMap['queued_messages'] =>
	isRecord(data) && Array.isArray(data.messages) && data.messages.every(isEncryptedMessage);

const parseServerSocketMessage = (value: unknown): ServerSocketMessage | null => {
	if (!isRecord(value) || typeof value.event !== 'string' || typeof value.timestamp !== 'number')
		return null;

	const { event, data, timestamp } = value;
	switch (event) {
		case 'auth_challenge':
			return isAuthChallenge(data) ? { event, data, timestamp } : null;
		case 'auth_success':
			return isAuthSuccessPayload(data) ? { event, data, timestamp } : null;
		case 'auth_failed':
		case 'error':
			return isReasonPayload(data) ? { event, data, timestamp } : null;
		case 'key_registered':
			return isKeyRegisteredPayload(data) ? { event, data, timestamp } : null;
		case 'incoming_message':
			return isEncryptedMessage(data) ? { event, data, timestamp } : null;
		case 'delivery_receipt':
			return isDeliveryReceiptPayload(data) ? { event, data, timestamp } : null;
		case 'signal':
			return isSignalEventData(data) ? { event, data, timestamp } : null;
		case 'signal_failed':
			return isSignalFailedPayload(data) ? { event, data, timestamp } : null;
		case 'call_busy':
			return isCallBusyPayload(data) ? { event, data, timestamp } : null;
		case 'peer_online':
		case 'peer_offline':
			return isPeerPresencePayload(data) ? { event, data, timestamp } : null;
		case 'peers_list':
			return isPeersListPayload(data) ? { event, data, timestamp } : null;
		case 'queued_messages':
			return isQueuedMessagesPayload(data) ? { event, data, timestamp } : null;
		default:
			return null;
	}
};

const websocketDataToString = (data: unknown): string | null => {
	if (typeof data === 'string')
		return data;
	if (data instanceof ArrayBuffer)
		return new TextDecoder().decode(data);
	if (data instanceof Blob)
		return null;
	return null;
};

const toError = (error: unknown, fallbackMessage: string): Error =>
	error instanceof Error ? error : new Error(fallbackMessage);

class WebSocketService {
	private socket: WebSocket | null = null;
	private url: string;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 1000;
	private eventListeners = new Map<WebSocketServiceEvent, Set<EventCallback<WebSocketServiceEvent>>>();
	private userId: string | null = null;
	private connectPromise: Promise<void> | null = null;
	private authReady = false;
	private authReadyPromise: Promise<void> = Promise.resolve();
	private resolveAuthReady: (() => void) | null = null;
	private manualDisconnect = false;
	private suspended = false;

	constructor() {
		const rawUrl = import.meta.env.VITE_SIGNALING_SERVER_URL || '';
		const resolvedUrl = this.resolveWebSocketUrl(rawUrl);
		this.url = resolvedUrl.endsWith('/ws') ? resolvedUrl : `${resolvedUrl.replace(/\/$/, '')}/ws`;
		this.resetAuthReadyState();
	}

	private resetAuthReadyState(): void {
		this.authReady = false;
		this.authReadyPromise = new Promise<void>((resolve) => {
			this.resolveAuthReady = resolve;
		});
	}

	private resolveWebSocketUrl(rawUrl: string): string {
		if (rawUrl && !rawUrl.includes('localhost')) {
			return rawUrl;
		}

		if (typeof window !== 'undefined') {
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			return `${protocol}//${window.location.host}`;
		}

		return rawUrl || 'wss://localhost/ws';
	}

	// Connect to the signaling server
	async connect(): Promise<void> {
		if (this.suspended)
			return;

		if (this.socket?.readyState === WebSocket.OPEN) 
			return;

		if (this.connectPromise) 
			return this.connectPromise;

		this.manualDisconnect = false;
		this.resetAuthReadyState();

		this.connectPromise = new Promise((resolve, reject) => {
			try {
				const socket = new WebSocket(this.url);
				this.socket = socket;

				socket.onopen = () => {
					clientLogger.info('[WebSocket] Connected to signaling server');
					this.reconnectAttempts = 0;
					this.connectPromise = null;
					this.emit('open', {});
					resolve();
				};

				socket.onmessage = (event) => {
					const rawMessage = websocketDataToString(event.data);
					if (rawMessage === null)
						return;

					void this.handleMessage(rawMessage);
				};

				socket.onclose = (event) => {
					clientLogger.info('[WebSocket] Connection closed:', event.code, event.reason);
					if (this.socket === socket) 
						this.socket = null;
					
					this.connectPromise = null;
					this.resetAuthReadyState();
					this.emit('close', { code: event.code, reason: event.reason });
					if (!this.manualDisconnect)
						this.attemptReconnect();
				};

				socket.onerror = (error) => {
					clientLogger.error('[WebSocket] Error:', error);
					this.connectPromise = null;
					reject(toError(error, 'WebSocket connection error'));
				};
			} catch (error) {
				this.connectPromise = null;
				reject(toError(error, 'WebSocket setup failed'));
			}
		});

		return this.connectPromise;
	}

	// Disconnect from the server
	disconnect(): void {
		this.suspended = false;
		this.manualDisconnect = true;
		this.connectPromise = null;
		this.resetAuthReadyState();
		if (this.socket) {
			this.socket.close(1000, 'User disconnect');
			this.socket = null;
		}
	}

	suspend(): void {
		this.suspended = true;
		this.manualDisconnect = true;
		this.connectPromise = null;
		this.resetAuthReadyState();

		if (this.socket) {
			this.socket.close(1000, 'App hidden');
			this.socket = null;
		}
	}

	async resume(): Promise<void> {
		this.suspended = false;
		return this.connect();
	}

	async waitForReady(timeoutMs = 8000): Promise<boolean> {
		if (this.suspended)
			return false;

		if (!this.isConnected()) {
			try {
				await this.connect();
			} catch {
				return false;
			}
		}

		if (this.authReady)
			return true;

		const timeout = new Promise<boolean>((resolve) => {
			window.setTimeout(() => resolve(false), timeoutMs);
		});

		const ready = this.authReadyPromise.then(() => true);
		return Promise.race([ready, timeout]);
	}

	// Send an event to the server
	send<Event extends ClientWebSocketEvent>(event: Event, data: ClientWebSocketEventMap[Event]): boolean {
		if (this.socket?.readyState !== WebSocket.OPEN) {
			clientLogger.error('[WebSocket] Cannot send - not connected');
			this.emit('send_failed', { event, data, reason: 'not_connected' } as SendFailedWebSocketEvent);
			return false;
		}

		const message = JSON.stringify({
			event,
			data,
			timestamp: Date.now()
		});

		try {
			this.socket.send(message);
			return true;
		} catch (error) {
			clientLogger.error('[WebSocket] Send failed:', error);
			this.emit('send_failed', { event, data, reason: 'send_exception' } as SendFailedWebSocketEvent);
			return false;
		}
	}

	isConnected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	// Register an event listener
	on<Event extends WebSocketServiceEvent>(event: Event, callback: EventCallback<Event>): () => void {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, new Set());
		}
		const listeners = this.eventListeners.get(event);
		if (!listeners)
			return () => undefined;

		listeners.add(callback as EventCallback<WebSocketServiceEvent>);

		// Return unsubscribe function
		return () => {
			this.eventListeners.get(event)?.delete(callback as EventCallback<WebSocketServiceEvent>);
		};
	}

	private emit<Event extends WebSocketServiceEvent>(event: Event, data: WebSocketServiceEventMap[Event]): void {
		const listeners = this.eventListeners.get(event);
		if (listeners) 
			listeners.forEach(callback => callback(data));
	}

	// Handle incoming messages
	private async handleMessage(rawData: string): Promise<void> {
		try {
			const parsedMessage: unknown = JSON.parse(rawData);
			const message = parseServerSocketMessage(parsedMessage);
			if (!message)
				return;

			const { event, data } = message;

			// Handle authentication challenge
			if (event === 'auth_challenge') {
				if (isAuthChallenge(data))
					await this.handleAuthChallenge(data);
				return;
			}

			// Handle auth success
			if (event === 'auth_success') {
				this.authReady = true;
				this.resolveAuthReady?.();
				this.resolveAuthReady = null;
				this.send('get_peers', {});
			}

			if (event === 'auth_failed') {
				this.resetAuthReadyState();
			}

			this.emit(event, data);
		} catch (error) {
			clientLogger.error('[WebSocket] Failed to parse message:', error);
		}
	}

	// Respond to authentication challenge
	private async handleAuthChallenge(challenge: AuthChallenge): Promise<void> {
		try {
			if (!this.userId) {
				clientLogger.error('[WebSocket] Missing userId for authentication');
				return;
			}

			const signingKeyPair = await getKeyPair('signing');
			const encryptionKeyPair = await getKeyPair('encryption');
      
			if (!signingKeyPair || !encryptionKeyPair) {
				clientLogger.error('[WebSocket] No keys found for authentication');
				return;
			}

			// Sign the nonce with our private key
			const signature = await signData(challenge.nonce, signingKeyPair.privateKey);
			const encryptionPublicKey = await exportPublicKey(encryptionKeyPair.publicKey);
			const signingPublicKey = await exportPublicKey(signingKeyPair.publicKey);

			// Send auth response
			this.send('auth_response', {
				userId: this.userId,
				signature,
				encryptionPublicKey,
				signingPublicKey
			});
		} catch (error) {
			clientLogger.error('[WebSocket] Authentication failed:', error);
		}
	}

	// Attempt to reconnect with exponential backoff
	private attemptReconnect(): void {
		if (this.manualDisconnect || this.suspended)
			return;

		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			clientLogger.error('[WebSocket] Max reconnection attempts reached');
			return;
		}

		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
		this.reconnectAttempts++;

		clientLogger.info(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

		setTimeout(() => {
			this.connect().catch((error: unknown) => {
				clientLogger.error('[WebSocket] Reconnect failed:', error);
			});
		}, delay);
	}

	setUserId(userId: string | null): void {
		this.userId = userId;
	}
}

// Singleton instance
const webSocketService = new WebSocketService();

export { webSocketService };

