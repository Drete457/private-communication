type SignalType = 'offer' | 'answer' | 'candidate' | 'hangup';
type DeliveryReceiptStatus = 'queued' | 'delivered' | 'read';
type CallType = 'audio' | 'video';

type EncryptedMessagePayload = {
  id: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  payload: unknown;
  signature: string;
  senderKeys?: {
    encryptionPublicKey: string;
    signingPublicKey: string;
    fingerprint?: string | undefined;
  } | undefined;
};

type ServerWebSocketEventMap = {
  auth_challenge: { nonce: string; timestamp: number };
  auth_success: { userId: string };
  auth_failed: { reason: string };
  error: { reason: string };
  key_registered: { success: boolean };
  incoming_message: EncryptedMessagePayload;
  delivery_receipt: { messageId: string; status: DeliveryReceiptStatus };
  signal: {
    type: SignalType;
    senderId: string;
    payload?: unknown;
    callType?: CallType | undefined;
    renegotiate?: boolean | undefined;
    iceRestart?: boolean | undefined;
    forceRelay?: boolean | undefined;
    reason?: string | undefined;
  };
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
  queued_messages: { messages: EncryptedMessagePayload[] };
};

type ServerWebSocketEvent = keyof ServerWebSocketEventMap;

export type {
  DeliveryReceiptStatus,
  EncryptedMessagePayload,
  ServerWebSocketEvent,
  ServerWebSocketEventMap,
  SignalType
};