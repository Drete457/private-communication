/**
 * WebSocket Connection Handler
 * 
 * Manages the lifecycle of WebSocket connections:
 * - Authentication via challenge-response
 * - Message routing
 * - Connection cleanup
 */

import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { z } from 'zod';

import { 
  sessionManager, 
  registerUserKeys,
  refreshUserPresence,
  getPublicKey,
  getSigningPublicKey,
  setUserOnline,
  setUserOffline,
  isUserOnline,
  queueMessage,
  getQueuedMessages,
  removeQueuedMessage,
  getOnlineUsers,
  queueReceipt,
  getQueuedReceipts,
  removeQueuedReceipt,
  registerRedisExpiredKeyHandler,
  setPendingIncomingCall,
  clearPendingIncomingCall,
  setActiveCallSession,
  clearActiveCallSession
} from '../services';
import { recordDashboardAuthFailure, recordDashboardRateLimitRejection } from '../services/application';
import { sendPushToUser } from '../services/push';
import { logger, generateNonce, verifySignature, spkiToPem } from '../utils';

import type { ServerWebSocketEvent, ServerWebSocketEventMap } from '../types';

interface AuthState {
  nonce: string;
  timestamp: number;
  authenticated: boolean;
  userId: string | null;
}

const AUTH_TIMEOUT = 30000; // 30 seconds to complete auth
const WS_RATE_LIMIT_WINDOW_MS = Number(process.env['WS_RATE_LIMIT_WINDOW_MS'] ?? 10000);
const WS_RATE_LIMIT_MAX = Number(process.env['WS_RATE_LIMIT_MAX'] ?? 60);
const WS_AUTH_MAX = Number(process.env['WS_AUTH_MAX'] ?? 5);
const WS_MESSAGE_MAX_BYTES = Number(process.env['WS_MESSAGE_MAX_BYTES'] ?? 262144);
const WS_EVENT_MAX_DEFAULT = Number(process.env['WS_EVENT_MAX_DEFAULT'] ?? 30);
const WS_EVENT_MAX_SEND_MESSAGE = Number(process.env['WS_EVENT_MAX_SEND_MESSAGE'] ?? 20);
const WS_EVENT_MAX_SIGNAL = Number(process.env['WS_EVENT_MAX_SIGNAL'] ?? 40);
const WS_EVENT_MAX_AUTH_RESPONSE = Number(process.env['WS_EVENT_MAX_AUTH_RESPONSE'] ?? 5);
const WS_HEARTBEAT_INTERVAL_MS = Number(process.env['WS_HEARTBEAT_INTERVAL_MS'] ?? 15000);
const WS_HEARTBEAT_TIMEOUT_MS = Number(process.env['WS_HEARTBEAT_TIMEOUT_MS'] ?? 45000);
const CALL_DISCONNECT_GRACE_MS = Number(process.env['CALL_DISCONNECT_GRACE_MS'] ?? 30000);
const INCOMING_CALL_TTL_MS = Number(process.env['INCOMING_CALL_TTL_SECONDS'] ?? 90) * 1000;

const activeCallPeers = new Map<string, string>();
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();
const PENDING_CALL_KEY_PATTERN = /^user:(.+):pendingCall:(.+)$/;

const setCallPair = (userA: string, userB: string): void => {
  activeCallPeers.set(userA, userB);
  activeCallPeers.set(userB, userA);
};

const clearCallForUser = (userId: string): void => {
  const peerId = activeCallPeers.get(userId);
  activeCallPeers.delete(userId);

  if (peerId && activeCallPeers.get(peerId) === userId) {
    activeCallPeers.delete(peerId);
  }
};

const clearDisconnectGraceTimer = (userId: string): void => {
  const timer = disconnectGraceTimers.get(userId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  disconnectGraceTimers.delete(userId);
};

const persistCallPairState = async (
  userA: string,
  userB: string,
  callType: 'audio' | 'video'
): Promise<void> => {
  clearDisconnectGraceTimer(userA);
  clearDisconnectGraceTimer(userB);
  await Promise.all([
    setActiveCallSession(userA, userB, callType),
    setActiveCallSession(userB, userA, callType)
  ]);
};

const persistCallerCallState = async (
  userId: string,
  peerId: string,
  callType: 'audio' | 'video'
): Promise<void> => {
  clearDisconnectGraceTimer(userId);
  await setActiveCallSession(userId, peerId, callType);
};

const clearCallPairState = async (userA: string, userB: string): Promise<void> => {
  clearDisconnectGraceTimer(userA);
  clearDisconnectGraceTimer(userB);
  clearCallForUser(userA);
  await Promise.all([
    clearActiveCallSession(userA),
    clearActiveCallSession(userB),
    clearPendingIncomingCall(userA, userB),
    clearPendingIncomingCall(userB, userA)
  ]);
};

const getPendingCallParticipants = (redisKey: string): { calleeId: string; callerId: string } | null => {
  const match = PENDING_CALL_KEY_PATTERN.exec(redisKey);
  if (!match) 
    return null;

  const [, calleeId, callerId] = match;
  if (!calleeId || !callerId) 
    return null;
  
  return { calleeId, callerId };
};

registerRedisExpiredKeyHandler(async (redisKey) => {
  const participants = getPendingCallParticipants(redisKey);
  if (!participants) 
    return;

  const { calleeId, callerId } = participants;
  await clearCallPairState(callerId, calleeId);

  sessionManager.sendToUser(callerId, 'signal_failed', {
    targetId: calleeId,
    signalType: 'offer',
    retryable: false,
    reason: 'Call was not answered in time'
  });

  sessionManager.sendToUser(calleeId, 'signal', {
    type: 'hangup',
    senderId: callerId,
    reason: 'missed_call_timeout'
  });

  logger.info('Pending incoming call expired', {
    callerId: callerId.slice(0, 8),
    calleeId: calleeId.slice(0, 8)
  });
});

const scheduleCallDisconnectGrace = (userId: string): boolean => {
  const peerId = activeCallPeers.get(userId);
  if (!peerId)
    return false;

  clearDisconnectGraceTimer(userId);

  const timeout = setTimeout(() => {
    disconnectGraceTimers.delete(userId);

    if (sessionManager.isConnected(userId))
      return;

    const activePeerId = activeCallPeers.get(userId);
    if (!activePeerId)
      return;

    void (async () => {
      await clearCallPairState(userId, activePeerId);
      sessionManager.sendToUser(activePeerId, 'signal', {
        type: 'hangup',
        senderId: userId,
        reason: 'disconnect_timeout'
      });
      logger.info('Call ended after disconnect grace timeout', {
        userId: userId.slice(0, 8),
        peerId: activePeerId.slice(0, 8)
      });
    })();
  }, CALL_DISCONNECT_GRACE_MS);

  disconnectGraceTimers.set(userId, timeout);
  return true;
};

type RateState = {
  windowStart: number;
  count: number;
  authCount: number;
};

type EventRateState = {
  windowStart: number;
  count: number;
};

type WebSocketMessageRecordKey =
  | 'data'
  | 'encryptionPublicKey'
  | 'event'
  | 'fingerprint'
  | 'id'
  | 'payload'
  | 'recipientId'
  | 'senderId'
  | 'senderKeys'
  | 'signature'
  | 'signingPublicKey'
  | 'timestamp';

type WebSocketMessageRecord = Record<string, unknown> & Partial<Record<WebSocketMessageRecordKey, unknown>>;

const isObject = (value: unknown): value is WebSocketMessageRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string =>
  typeof value === 'string';

type WebSocketData = string | Buffer | ArrayBuffer | Buffer[];

const getMessageSize = (data: WebSocketData): number => {
  if (typeof data === 'string') return data.length;
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, item) => sum + item.length, 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
};

const rawToString = (data: WebSocketData): string => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return '';
};

const isQueuedEncryptedMessage = (value: unknown): value is ServerWebSocketEventMap['incoming_message'] => {
  if (!isObject(value))
    return false;

  if (value.senderKeys !== undefined) {
    if (!isObject(value.senderKeys))
      return false;
    if (!isString(value.senderKeys.encryptionPublicKey) || !isString(value.senderKeys.signingPublicKey))
      return false;
    if (value.senderKeys.fingerprint !== undefined && !isString(value.senderKeys.fingerprint))
      return false;
  }

  return isString(value.id)
    && isString(value.senderId)
    && isString(value.recipientId)
    && typeof value.timestamp === 'number'
    && value.payload !== undefined
    && isString(value.signature);
};

const parseQueuedMessages = (messages: string[]): Array<ServerWebSocketEventMap['incoming_message']> => {
  const parsedMessages: Array<ServerWebSocketEventMap['incoming_message']> = [];

  for (const message of messages) {
    try {
      const parsedMessage: unknown = JSON.parse(message);
      if (isQueuedEncryptedMessage(parsedMessage))
        parsedMessages.push(parsedMessage);
    } catch {
      continue;
    }
  }

  return parsedMessages;
};

const createRateState = (): RateState => ({
  windowStart: Date.now(),
  count: 0,
  authCount: 0
});

const createEventRateState = (): EventRateState => ({
  windowStart: Date.now(),
  count: 0
});

const getEventLimit = (event: string): number => {
  switch (event) {
    case 'send_message':
      return WS_EVENT_MAX_SEND_MESSAGE;
    case 'signal':
      return WS_EVENT_MAX_SIGNAL;
    case 'auth_response':
      return WS_EVENT_MAX_AUTH_RESPONSE;
    default:
      return WS_EVENT_MAX_DEFAULT;
  }
};

const base64String = z.string().min(1);
const authResponseSchema = z.object({
  userId: z.string().min(1),
  signature: base64String,
  encryptionPublicKey: base64String,
  signingPublicKey: base64String
});

const registerKeySchema = z.object({
  encryptionPublicKey: base64String.optional(),
  signingPublicKey: base64String.optional()
});

const sendMessageSchema = z.object({
  recipientId: z.string().min(1),
  payload: z.unknown(),
  signature: base64String,
  timestamp: z.number().optional(),
  id: z.string().optional(),
  senderKeys: z
    .object({
      encryptionPublicKey: base64String,
      signingPublicKey: base64String,
      fingerprint: z.string().optional()
    })
    .optional()
});

const signalSchema = z.object({
  type: z.enum(['offer', 'answer', 'candidate', 'hangup']),
  targetId: z.string().min(1),
  payload: z.unknown().optional(),
  callType: z.enum(['audio', 'video']).optional(),
  renegotiate: z.boolean().optional(),
  iceRestart: z.boolean().optional(),
  forceRelay: z.boolean().optional(),
  reason: z.string().min(1).optional()
});

const messageAckSchema = z.object({
  messageId: z.string().min(1),
  senderId: z.string().min(1).optional()
});

const messageReadSchema = z.object({
  messageId: z.string().min(1),
  senderId: z.string().min(1)
});

const receiptAckSchema = z.object({
  messageId: z.string().min(1),
  status: z.enum(['delivered', 'read']).optional()
});

type RegisterKeyData = z.infer<typeof registerKeySchema>;
type SendMessageData = z.infer<typeof sendMessageSchema>;
type SignalEventData = z.infer<typeof signalSchema>;
type MessageAckData = z.infer<typeof messageAckSchema>;
type ReceiptAckData = z.infer<typeof receiptAckSchema>;

export const handleConnection = (socket: WebSocket): void => {
  // Initialize auth state
  const authState: AuthState = {
    nonce: generateNonce(),
    timestamp: Date.now(),
    authenticated: false,
    userId: null
  };

  const rateState = createRateState();
  const eventRates = new Map<string, EventRateState>();
  let lastPongAt = Date.now();

  const heartbeatInterval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN)
      return;

    if (Date.now() - lastPongAt > WS_HEARTBEAT_TIMEOUT_MS) {
      logger.info('WebSocket heartbeat timeout', {
        userId: authState.userId?.slice(0, 8),
        timeoutMs: WS_HEARTBEAT_TIMEOUT_MS
      });
      socket.terminate();
      return;
    }

    try {
      socket.ping();
    } catch (error) {
      logger.warn('Failed to send WebSocket heartbeat ping', {
        userId: authState.userId?.slice(0, 8),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      socket.terminate();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);

  socket.on('pong', () => {
    lastPongAt = Date.now();
    if (authState.authenticated && authState.userId) {
      void refreshUserPresence(authState.userId).catch((error: unknown) => {
        logger.warn('Failed to refresh Redis presence', {
          userId: authState.userId?.slice(0, 8),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }
  });

  // Send authentication challenge
  sendEvent(socket, 'auth_challenge', {
    nonce: authState.nonce,
    timestamp: authState.timestamp
  });

  // Set auth timeout
  const authTimeout = setTimeout(() => {
    if (!authState.authenticated) {
      recordDashboardAuthFailure();
      logger.warn('Authentication timeout');
      socket.close(4001, 'Authentication timeout');
    }
  }, AUTH_TIMEOUT);

  // Handle messages
  socket.on('message', (data) => {
    void (async () => {
    try {
      const size = getMessageSize(data);
      if (size > WS_MESSAGE_MAX_BYTES) {
        logger.warn('WebSocket message too large', { size });
        socket.close(1009, 'Message too large');
        return;
      }

      const now = Date.now();
      if (now - rateState.windowStart > WS_RATE_LIMIT_WINDOW_MS) {
        rateState.windowStart = now;
        rateState.count = 0;
        rateState.authCount = 0;
      }
      rateState.count += 1;
      if (rateState.count > WS_RATE_LIMIT_MAX) {
        recordDashboardRateLimitRejection();
        logger.warn('WebSocket rate limit exceeded');
        socket.close(1013, 'Rate limit exceeded');
        return;
      }

      const message: unknown = JSON.parse(rawToString(data));
      if (!isObject(message) || !isString(message.event)) {
        logger.warn('Invalid WebSocket message shape');
        return;
      }

      const event = message.event;
      const eventData = message.data;

      const rate = eventRates.get(event) ?? createEventRateState();
      if (now - rate.windowStart > WS_RATE_LIMIT_WINDOW_MS) {
        rate.windowStart = now;
        rate.count = 0;
      }
      rate.count += 1;
      const eventLimit = getEventLimit(event);
      if (rate.count > eventLimit) {
        recordDashboardRateLimitRejection();
        logger.warn('WebSocket event rate limit exceeded', { event });
        socket.close(1013, 'Event rate limit exceeded');
        return;
      }
      eventRates.set(event, rate);

      // Route events
      switch (event) {
        case 'auth_response': {
          rateState.authCount += 1;
          if (rateState.authCount > WS_AUTH_MAX) {
            recordDashboardRateLimitRejection();
            logger.warn('WebSocket auth rate limit exceeded');
            socket.close(1013, 'Auth rate limit exceeded');
            return;
          }
          if (!isObject(eventData)) {
            sendEvent(socket, 'error', { reason: 'Invalid payload' });
            return;
          }
          const authParse = authResponseSchema.safeParse(eventData);
          if (!authParse.success) {
            recordDashboardAuthFailure();
            sendEvent(socket, 'error', { reason: 'Invalid auth payload' });
            return;
          }
          await handleAuthResponse(socket, authState, authParse.data, authTimeout);
          break;
        }

        case 'register_key': {
          if (!isObject(eventData)) {
            sendEvent(socket, 'error', { reason: 'Invalid payload' });
            return;
          }
          const registerParse = registerKeySchema.safeParse(eventData);
          if (!registerParse.success) {
            sendEvent(socket, 'error', { reason: 'Invalid register payload' });
            return;
          }
          await handleRegisterKey(socket, authState, registerParse.data);
          break;
        }

        case 'send_message': {
          if (!isObject(eventData)) {
            sendEvent(socket, 'error', { reason: 'Invalid payload' });
            return;
          }
          const sendParse = sendMessageSchema.safeParse(eventData);
          if (!sendParse.success) {
            sendEvent(socket, 'error', { reason: 'Invalid message payload' });
            return;
          }
          await handleSendMessage(socket, authState, sendParse.data);
          break;
        }

        case 'signal': {
          if (!isObject(eventData)) {
            sendEvent(socket, 'error', { reason: 'Invalid payload' });
            return;
          }
          const signalParse = signalSchema.safeParse(eventData);
          if (!signalParse.success) {
            sendEvent(socket, 'error', { reason: 'Invalid signal payload' });
            return;
          }
          await handleSignal(socket, authState, signalParse.data);
          break;
        }

        case 'get_peers':
          await handleGetPeers(socket, authState);
          break;

        case 'message_ack': {
          if (!isObject(eventData)) {
            return;
          }
          const ackParse = messageAckSchema.safeParse(eventData);
          if (!ackParse.success) {
            return;
          }
          await handleMessageAck(socket, authState, ackParse.data);
          break;
        }

        case 'message_read': {
          if (!isObject(eventData)) {
            return;
          }
          const readParse = messageReadSchema.safeParse(eventData);
          if (!readParse.success) {
            return;
          }
          await handleMessageRead(socket, authState, readParse.data);
          break;
        }

        case 'get_receipts':
          await handleGetReceipts(socket, authState);
          break;

        case 'receipt_ack': {
          if (!isObject(eventData)) {
            return;
          }
          const receiptParse = receiptAckSchema.safeParse(eventData);
          if (!receiptParse.success) {
            return;
          }
          await handleReceiptAck(socket, authState, receiptParse.data);
          break;
        }

        default:
          logger.warn('Unknown event type', { event });
      }
    } catch (error) {
      logger.error('Message handling error', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    })();
  });

  // Handle disconnection
  socket.on('close', () => {
    void (async () => {
    clearInterval(heartbeatInterval);
    clearTimeout(authTimeout);
    
    const userId = sessionManager.removeSession(socket);
    if (userId) {
      const hasActiveCall = scheduleCallDisconnectGrace(userId);
      if (!hasActiveCall)
        await clearActiveCallSession(userId);

      await setUserOffline(userId);
      
      // Notify other users
      sessionManager.broadcast('peer_offline', { userId }, userId);
    }
    })();
  });

  // Handle errors
  socket.on('error', (error) => {
    logger.error('WebSocket error', { error: error.message });
  });
}

/**
 * Handle authentication response
 */
const handleAuthResponse = async (
  socket: WebSocket,
  authState: AuthState,
  data: { userId: string; signature: string; encryptionPublicKey: string; signingPublicKey: string },
  authTimeout: NodeJS.Timeout
): Promise<void> => {
  const { userId, signature, encryptionPublicKey, signingPublicKey } = data;

  if (!userId || !signature || !encryptionPublicKey || !signingPublicKey) {
    recordDashboardAuthFailure();
    sendEvent(socket, 'auth_failed', { reason: 'Missing authentication data' });
    socket.close(4004, 'Invalid authentication payload');
    return;
  }

  // Verify the nonce hasn't expired
  if (Date.now() - authState.timestamp > AUTH_TIMEOUT) {
    recordDashboardAuthFailure();
    sendEvent(socket, 'auth_failed', { reason: 'Challenge expired' });
    socket.close(4002, 'Challenge expired');
    return;
  }

  // Get stored public key or use provided one for first-time users
  let storedEncryptionKey = await getPublicKey(userId);
  let storedSigningKey = await getSigningPublicKey(userId);
  if (!storedEncryptionKey || !storedSigningKey) {
    // First-time user or missing keys, store provided keys
    await registerUserKeys(userId, encryptionPublicKey, signingPublicKey);
    storedEncryptionKey = encryptionPublicKey;
    storedSigningKey = signingPublicKey;
  }

  // Verify signature
  const pemKey = spkiToPem(storedSigningKey);
  const isValid = verifySignature(authState.nonce, signature, pemKey);

  if (!isValid) {
    recordDashboardAuthFailure();
    logger.warn('Authentication failed - invalid signature', { userId: userId.slice(0, 8) });
    sendEvent(socket, 'auth_failed', { reason: 'Invalid signature' });
    socket.close(4003, 'Authentication failed');
    return;
  }

  // Authentication successful
  clearTimeout(authTimeout);
  authState.authenticated = true;
  authState.userId = userId;
  clearDisconnectGraceTimer(userId);

  // Register session
  sessionManager.addSession(userId, socket, storedEncryptionKey);
  await setUserOnline(userId);

  // Send success
  sendEvent(socket, 'auth_success', { userId });

  // Notify other users
  sessionManager.broadcast('peer_online', { userId }, userId);

  // Deliver any queued messages
  const queuedMessages = await getQueuedMessages(userId);
  if (queuedMessages.length > 0) {
    sendEvent(socket, 'queued_messages', { 
      messages: parseQueuedMessages(queuedMessages) 
    });
  }

  // Deliver any queued receipts (do not clear; client will ack)
  await sendQueuedReceipts(socket, userId);

  logger.info('User authenticated', { userId: userId.slice(0, 8) });
}

/**
 * Handle public key registration
 */
const handleRegisterKey = async (
  socket: WebSocket,
  authState: AuthState,
  data: RegisterKeyData
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    sendEvent(socket, 'error', { reason: 'Not authenticated' });
    return;
  }

  if (data.encryptionPublicKey && data.signingPublicKey) {
    await registerUserKeys(authState.userId, data.encryptionPublicKey, data.signingPublicKey);
  } else {
    sendEvent(socket, 'error', { reason: 'Missing public key data' });
    return;
  }
  sendEvent(socket, 'key_registered', { success: true });
}

/**
 * Handle message sending
 */
const handleSendMessage = async (
  socket: WebSocket,
  authState: AuthState,
  data: SendMessageData
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    sendEvent(socket, 'error', { reason: 'Not authenticated' });
    return;
  }

  const { recipientId, payload, signature, timestamp, id, senderKeys } = data;
  if (payload === undefined) {
    sendEvent(socket, 'error', { reason: 'Missing payload' });
    return;
  }
  const messageId = id ?? uuidv4();
  const messageTimestamp = typeof timestamp === 'number' ? timestamp : Date.now();

  const message = {
    id: messageId,
    senderId: authState.userId,
    recipientId,
    timestamp: messageTimestamp,
    payload,
    signature,
    senderKeys
  };

  // Check if recipient is online
  const recipientOnline = await isUserOnline(recipientId);
  
  if (recipientOnline) {
    // Send directly
    const sent = sessionManager.sendToUser(recipientId, 'incoming_message', message);
    if (sent) {
      return;
    }

    // Socket exists but send failed, queue message
    await queueMessage(recipientId, JSON.stringify(message));
    await sendPushToUser(recipientId, { type: 'new_message', senderId: authState.userId });
    sendEvent(socket, 'delivery_receipt', { 
      messageId, 
      status: 'queued' 
    });
    
  } else {
    // Queue for later delivery
    await queueMessage(recipientId, JSON.stringify(message));
    await sendPushToUser(recipientId, { type: 'new_message', senderId: authState.userId });
    sendEvent(socket, 'delivery_receipt', { 
      messageId, 
      status: 'queued' 
    });
  }
}

/**
 * Handle WebRTC signaling
 */
const handleSignal = async (
  socket: WebSocket,
  authState: AuthState,
  data: SignalEventData
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    sendEvent(socket, 'error', { reason: 'Not authenticated' });
    return;
  }

  const { type, targetId, payload, callType, renegotiate, iceRestart, forceRelay, reason } = data;
  const callerId = authState.userId;

  if (type === 'offer') {
    const callerPeer = activeCallPeers.get(callerId);
    if (callerPeer && callerPeer !== targetId) {
      sendEvent(socket, 'call_busy', {
        targetId,
        reason: 'caller_already_in_call'
      });
      return;
    }

    const targetPeer = activeCallPeers.get(targetId);
    if (targetPeer && targetPeer !== callerId) {
      sendEvent(socket, 'call_busy', {
        targetId,
        reason: 'target_in_call'
      });
      return;
    }

    setCallPair(callerId, targetId);
    await persistCallerCallState(callerId, targetId, callType === 'video' ? 'video' : 'audio');

    const isInitialOffer = !renegotiate && !iceRestart;
    if (isInitialOffer) {
      const offerPayload = payload as { type?: string; sdp?: string } | undefined;
      if (offerPayload?.type === 'offer') {
        const pendingOffer = {
          type: offerPayload.type,
          ...(typeof offerPayload.sdp === 'string' ? { sdp: offerPayload.sdp } : {})
        };
        await setPendingIncomingCall(targetId, callerId, pendingOffer, callType === 'video' ? 'video' : 'audio');
      }

      const targetOnline = await isUserOnline(targetId);
      if (!targetOnline) {
        await sendPushToUser(targetId, {
          type: 'incoming_call',
          senderId: callerId,
          callType,
          title: null,
          body: null,
          url: `/call/${callerId}`
        });
      }
    }
  }

  if (type !== 'hangup' && payload === undefined) {
    sendEvent(socket, 'error', { reason: 'Missing payload' });
    return;
  }

  if (type === 'hangup') {
    await clearCallPairState(callerId, targetId);
  }

  // Forward signal to target
  const sent = sessionManager.sendToUser(targetId, 'signal', {
    type,
    senderId: authState.userId,
    payload,
    callType,
    renegotiate,
    iceRestart,
    forceRelay,
    reason
  });

  if (!sent) {
    const isInitialOffer = type === 'offer' && !renegotiate && !iceRestart;
    const retryable = isInitialOffer;
    
    sendEvent(socket, 'signal_failed', { 
      targetId,
      signalType: type,
      retryable,
      reason: retryable ? 'Awaiting peer to come online' : 'User not online',
      expiresAt: retryable ? Date.now() + INCOMING_CALL_TTL_MS : undefined
    });
    return;
  }

  if (type === 'answer') {
    await clearPendingIncomingCall(callerId, targetId);
    setCallPair(callerId, targetId);
    await persistCallPairState(callerId, targetId, callType === 'video' ? 'video' : 'audio');
  }
}

/**
 * Handle get peers request
 */
const handleGetPeers = async (
  socket: WebSocket,
  authState: AuthState
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    sendEvent(socket, 'error', { reason: 'Not authenticated' });
    return;
  }

  const onlinePeers = await getOnlineUsers();
  // Exclude self from list
  const peers = onlinePeers.filter(id => id !== authState.userId);
  
  sendEvent(socket, 'peers_list', { onlinePeers: peers });
}

/**
 * Handle message acknowledgment
 */
const handleMessageAck = async (
  _socket: WebSocket,
  authState: AuthState,
  data: MessageAckData
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    return;
  }

  let senderId = data.senderId;

  if (data.messageId) {
    const removed = await removeQueuedMessage(authState.userId, data.messageId);
    if (!senderId && removed?.senderId) {
      senderId = removed.senderId;
    }
  }

  if (data.messageId && senderId) {
    await queueReceipt(senderId, data.messageId, 'delivered');

    sessionManager.sendToUser(senderId, 'delivery_receipt', {
      messageId: data.messageId,
      status: 'delivered'
    });
  }

  logger.debug('Message acknowledged', { messageId: data.messageId, senderId: data.senderId });
}

/**
 * Handle message read notification
 */
const handleMessageRead = async (
  _socket: WebSocket,
  authState: AuthState,
  data: { messageId: string; senderId: string }
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    return;
  }

  const { messageId, senderId } = data;
  if (!messageId || !senderId) {
    return;
  }

  // Notify sender that message was read (if online)
  const sent = sessionManager.sendToUser(senderId, 'delivery_receipt', {
    messageId,
    status: 'read'
  });

  await queueReceipt(senderId, messageId, 'read');

  if (!sent) {
    return;
  }
}

/**
 * Handle get receipts request
 */
const handleGetReceipts = async (
  socket: WebSocket,
  authState: AuthState
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    return;
  }

  await sendQueuedReceipts(socket, authState.userId);
}

/**
 * Handle receipt acknowledgments
 */
const handleReceiptAck = async (
  _socket: WebSocket,
  authState: AuthState,
  data: ReceiptAckData
): Promise<void> => {
  if (!authState.authenticated || !authState.userId) {
    return;
  }

  const { messageId, status } = data;
  if (!messageId || (status !== 'delivered' && status !== 'read')) {
    return;
  }

  await removeQueuedReceipt(authState.userId, messageId, status);
}

/**
 * Send queued receipts to a user
 */
const sendQueuedReceipts = async (socket: WebSocket, userId: string): Promise<void> => {
  const queuedReceipts = await getQueuedReceipts(userId);
  if (queuedReceipts.length === 0) {
    return;
  }

  for (const receipt of queuedReceipts) {
    sendEvent(socket, 'delivery_receipt', {
      messageId: receipt.messageId,
      status: receipt.status
    });
  }
}

/**
 * Helper to send WebSocket events
 */
const sendEvent = <Event extends ServerWebSocketEvent>(socket: WebSocket, event: Event, data: ServerWebSocketEventMap[Event]): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      event,
      data,
      timestamp: Date.now()
    }));
  }
}
