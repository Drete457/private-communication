import type { AuthChallenge, AuthResponse, CallType } from './communication';
import type { EncryptedMessage } from './messages';

type EmptyPayload = Record<string, never>;
type SignalType = 'offer' | 'answer' | 'candidate' | 'hangup';
type SignalPayload = RTCSessionDescriptionInit | RTCIceCandidateInit;
type DeliveryReceiptStatus = 'queued' | 'delivered' | 'read';

type ClientSignalEventData = {
  type: SignalType;
  targetId: string;
  payload?: SignalPayload | undefined;
  callType?: CallType | undefined;
  renegotiate?: boolean | undefined;
  iceRestart?: boolean | undefined;
  forceRelay?: boolean | undefined;
  reason?: string | undefined;
};

type SignalEventData = {
  type: SignalType;
  senderId: string;
  payload?: SignalPayload | undefined;
  callType?: CallType | undefined;
  renegotiate?: boolean | undefined;
  iceRestart?: boolean | undefined;
  forceRelay?: boolean | undefined;
  reason?: string | undefined;
};

type ClientWebSocketEventMap = {
  auth_response: AuthResponse;
  register_key: Pick<AuthResponse, 'encryptionPublicKey' | 'signingPublicKey'>;
  send_message: EncryptedMessage;
  signal: ClientSignalEventData;
  get_peers: EmptyPayload;
  message_ack: { messageId: string; senderId?: string | undefined };
  message_read: { messageId: string; senderId: string };
  get_receipts: EmptyPayload;
  receipt_ack: { messageId: string; status?: Extract<DeliveryReceiptStatus, 'delivered' | 'read'> | undefined };
};

type ServerWebSocketEventMap = {
  auth_challenge: AuthChallenge;
  auth_success: { userId: string };
  auth_failed: { reason: string };
  error: { reason: string };
  key_registered: { success: boolean };
  incoming_message: EncryptedMessage;
  delivery_receipt: { messageId: string; status: DeliveryReceiptStatus };
  signal: SignalEventData;
  signal_failed: {
    targetId: string;
    signalType: SignalType;
    retryable: boolean;
    expiresAt?: number | undefined;
    reason: string;
  };
  call_busy: { targetId: string; reason: string };
  peer_online: { userId: string };
  peer_offline: { userId: string };
  peers_list: { onlinePeers: string[] };
  queued_messages: { messages: EncryptedMessage[] };
};

type ClientWebSocketEvent = keyof ClientWebSocketEventMap;
type ServerWebSocketEvent = keyof ServerWebSocketEventMap;

type SendFailedWebSocketEvent = {
  [Event in ClientWebSocketEvent]: {
    event: Event;
    data: ClientWebSocketEventMap[Event];
    reason: 'not_connected' | 'send_exception';
  }
}[ClientWebSocketEvent];

type LocalWebSocketEventMap = {
  open: EmptyPayload;
  close: { code: number; reason: string };
  send_failed: SendFailedWebSocketEvent;
};

type WebSocketServiceEventMap = ServerWebSocketEventMap & LocalWebSocketEventMap;
type WebSocketServiceEvent = keyof WebSocketServiceEventMap;

type ServerSocketMessage = {
  [Event in ServerWebSocketEvent]: {
    event: Event;
    data: ServerWebSocketEventMap[Event];
    timestamp: number;
  }
}[ServerWebSocketEvent];

type SocketMessage<Event extends string = ClientWebSocketEvent | ServerWebSocketEvent, Data = unknown> = {
  event: Event;
  data: Data;
  timestamp: number;
};

type ClientEvent = ClientWebSocketEvent;
type ServerEvent = ServerWebSocketEvent;

export type {
	ClientEvent,
	ClientSignalEventData,
	ClientWebSocketEvent,
	ClientWebSocketEventMap,
	DeliveryReceiptStatus,
	SendFailedWebSocketEvent,
	ServerEvent,
	ServerSocketMessage,
	ServerWebSocketEvent,
	ServerWebSocketEventMap,
	SignalEventData,
	SignalType,
	SocketMessage,
	WebSocketServiceEvent,
	WebSocketServiceEventMap
};
