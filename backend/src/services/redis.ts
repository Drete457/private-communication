/**
 * Redis service for message queue and user registration
 * 
 * Handles:
 * - Public key registration (persistent)
 * - Offline message queue (temporary with TTL)
 * - Online user tracking
 */

import Redis from 'ioredis';
import { z } from 'zod';

import { logger } from '../utils/logger';

const REDIS_HOST = process.env['REDIS_HOST'] ?? 'localhost';
const REDIS_PORT = parseInt(process.env['REDIS_PORT'] ?? '6379');
const REDIS_DB = parseInt(process.env['REDIS_DB'] ?? '0');
const MESSAGE_TTL = parseInt(process.env['MESSAGE_QUEUE_TTL'] ?? '604800'); // 7 days
const RECEIPT_QUEUE_LIMIT = parseInt(process.env['RECEIPT_QUEUE_LIMIT'] ?? '1000');
const INCOMING_CALL_TTL_SECONDS = parseInt(process.env['INCOMING_CALL_TTL_SECONDS'] ?? '90');
const ACTIVE_CALL_SESSION_TTL_SECONDS = parseInt(process.env['ACTIVE_CALL_SESSION_TTL_SECONDS'] ?? '180');
const ONLINE_USER_TTL_SECONDS = Math.max(30, parseInt(process.env['ONLINE_USER_TTL_SECONDS'] ?? '90'));
const REDIS_ENABLE_KEYSPACE_NOTIFICATIONS = process.env['REDIS_ENABLE_KEYSPACE_NOTIFICATIONS'] !== 'false';
const REDIS_KEYSPACE_EVENTS = process.env['REDIS_KEYSPACE_EVENTS'] ?? 'Ex';
const REDIS_SCAN_COUNT = Math.max(50, Number(process.env['REDIS_SCAN_COUNT'] ?? 200));

let redis: Redis;
let redisSubscriber: Redis | null = null;

type RedisExpiredKeyHandler = (key: string) => void | Promise<void>;

const redisExpiredKeyHandlers = new Set<RedisExpiredKeyHandler>();

const redisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  db: REDIS_DB,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

const mergeKeyspaceNotificationFlags = (current: string, required: string): string => {
  const merged = new Set(`${current}${required}`.split(''));
  return [...merged].join('');
};

const ensureKeyspaceNotifications = async (): Promise<void> => {
  if (!REDIS_ENABLE_KEYSPACE_NOTIFICATIONS) {
    return;
  }

  try {
    const response = await redis.config('GET', 'notify-keyspace-events');
    const current = Array.isArray(response) && typeof response[1] === 'string' ? response[1] : '';
    const next = mergeKeyspaceNotificationFlags(current, REDIS_KEYSPACE_EVENTS);

    if (next !== current) {
      await redis.config('SET', 'notify-keyspace-events', next);
      logger.info('Redis keyspace notifications configured', { current, next });
    }
  } catch (error) {
    logger.warn('Unable to configure Redis keyspace notifications', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

const startRedisExpiredKeySubscriber = async (): Promise<void> => {
  if (!REDIS_ENABLE_KEYSPACE_NOTIFICATIONS || redisSubscriber) {
    return;
  }

  redisSubscriber = new Redis(redisOptions);

  redisSubscriber.on('error', (error: Error) => {
    logger.error('Redis subscriber error', { error: error.message });
  });

  redisSubscriber.on('connect', () => {
    logger.info('Connected to Redis expired-key subscriber');
  });

  redisSubscriber.on('pmessage', (_pattern: string, _channel: string, key: string) => {
    for (const handler of redisExpiredKeyHandlers) {
      void Promise.resolve(handler(key)).catch((error: unknown) => {
        logger.error('Redis expired-key handler failed', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
    }
  });

  await redisSubscriber.psubscribe(`__keyevent@${REDIS_DB}__:expired`);
};

export const initializeRedis = async (): Promise<void> => {
  redis = new Redis(redisOptions);

  redis.on('error', (error: Error) => {
    logger.error('Redis error', { error: error.message });
  });

  redis.on('connect', () => {
    logger.info('Connected to Redis');
  });

  // Test connection
  await redis.ping();

  await ensureKeyspaceNotifications();
  await startRedisExpiredKeySubscriber();
}

export const getRedis = (): Redis => {
  // redis is initialized at runtime by initializeRedis before service calls.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!redis) 
    throw new Error('Redis not initialized');
  
  return redis;
}

export const registerRedisExpiredKeyHandler = (handler: RedisExpiredKeyHandler): void => {
  redisExpiredKeyHandlers.add(handler);
};

// Keys
const KEYS = {
  userEncryptionPublicKey: (userId: string) => `user:${userId}:encryptionPublicKey`,
  userSigningPublicKey: (userId: string) => `user:${userId}:signingPublicKey`,
  userOnline: (userId: string) => `user:${userId}:online`,
  messageQueue: (userId: string) => `user:${userId}:messages`,
  receiptQueue: (userId: string) => `user:${userId}:receipts`,
  receiptQueueIndex: (userId: string) => `user:${userId}:receipts:index`,
  pushSubscriptions: (userId: string) => `user:${userId}:pushSubscriptions`,
  pendingIncomingCall: (userId: string, senderId: string) => `user:${userId}:pendingCall:${senderId}`,
  activeCallSession: (userId: string) => `user:${userId}:activeCallSession`,
  onlineUsers: 'online:users'
};

const USER_ONLINE_KEY_PATTERN = /^user:(.+):online$/;

type PendingIncomingCall = {
  senderId: string;
  offer: { type: string; sdp?: string };
  callType: 'audio' | 'video';
  createdAt: number;
  expiresAt: number;
};

type ActiveCallSession = {
  userId: string;
  peerId: string;
  callType: 'audio' | 'video';
  createdAt: number;
  expiresAt: number;
};

const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const queuedMessageSchema = z.object({
  id: z.string().min(1),
  senderId: z.string().optional()
}).loose();

const pendingIncomingCallSchema = z.object({
  senderId: z.string().min(1),
  offer: z.object({
    type: z.string().min(1),
    sdp: z.string().optional()
  }),
  callType: z.enum(['audio', 'video']),
  createdAt: z.number(),
  expiresAt: z.number()
});

const activeCallSessionSchema = z.object({
  userId: z.string().min(1),
  peerId: z.string().min(1),
  callType: z.enum(['audio', 'video']),
  createdAt: z.number(),
  expiresAt: z.number()
});

const PENDING_CALL_KEY_PATTERN = /^user:(.+):pendingCall:(.+)$/;

const scanKeys = async (pattern: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', REDIS_SCAN_COUNT);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
};

const sumCommandResults = async (command: 'llen' | 'zcard', keys: string[]): Promise<number> => {
  if (keys.length === 0) {
    return 0;
  }

  const pipeline = redis.pipeline();
  for (const key of keys) {
    if (command === 'llen') {
      pipeline.llen(key);
    } else {
      pipeline.zcard(key);
    }
  }

  const results = await pipeline.exec();
  if (!results) 
    return 0;

  return results.reduce((total, [error, value]) => {
    if (error || typeof value !== 'number' || !Number.isFinite(value) || value < 0) 
      return total;

    return total + value;
  }, 0);
};

const createCallPairKey = (leftUserId: string, rightUserId: string): string => {
  return [leftUserId, rightUserId].sort((left, right) => left.localeCompare(right)).join('::');
};

const parsePendingCallPairKey = (redisKey: string): string | null => {
  const match = PENDING_CALL_KEY_PATTERN.exec(redisKey);
  if (!match) 
    return null;

  const [, calleeId, callerId] = match;
  if (!calleeId || !callerId) 
    return null;

  return createCallPairKey(calleeId, callerId);
};

const parseOnlineUserId = (redisKey: string): string | null => {
  const match = USER_ONLINE_KEY_PATTERN.exec(redisKey);
  if (!match) 
    return null;

  return match[1] ?? null;
};

const syncUserOnlinePresence = async (userId: string): Promise<void> => {
  await redis.multi()
    .sadd(KEYS.onlineUsers, userId)
    .set(KEYS.userOnline(userId), '1', 'EX', ONLINE_USER_TTL_SECONDS)
    .exec();
};

const removeUserOnlinePresence = async (userId: string): Promise<void> => {
  await redis.multi()
    .srem(KEYS.onlineUsers, userId)
    .del(KEYS.userOnline(userId))
    .exec();
};

const cleanupStaleOnlineUsers = async (userIds: string[]): Promise<string[]> => {
  if (userIds.length === 0) 
    return [];

  const pipeline = redis.pipeline();
  for (const userId of userIds) 
    pipeline.exists(KEYS.userOnline(userId));

  const results = await pipeline.exec();
  if (!results) 
    return [];

  const activeUserIds: string[] = [];
  const staleUserIds: string[] = [];

  const resultsIterator = results[Symbol.iterator]();
  for (const userId of userIds) {
    const result = resultsIterator.next().value;
    const value = result?.[1];
    if (!result?.[0] && value === 1) {
      activeUserIds.push(userId);
    } else {
      staleUserIds.push(userId);
    }
  }

  if (staleUserIds.length > 0) 
    await redis.srem(KEYS.onlineUsers, ...staleUserIds);

  return activeUserIds;
};

registerRedisExpiredKeyHandler(async (key) => {
  const userId = parseOnlineUserId(key);
  if (!userId) 
    return;

  await redis.srem(KEYS.onlineUsers, userId);
});

/**
 * Register a user's encryption and signing public keys
 */
export const registerUserKeys = async (
  userId: string,
  encryptionPublicKey: string,
  signingPublicKey: string
): Promise<void> => {
  await redis.set(KEYS.userEncryptionPublicKey(userId), encryptionPublicKey);
  await redis.set(KEYS.userSigningPublicKey(userId), signingPublicKey);
  logger.info('User keys registered', { userId: userId.slice(0, 8) });
}

/**
 * Register a user's signing public key
 */
export const registerSigningPublicKey = async (userId: string, signingPublicKey: string): Promise<void> => {
  await redis.set(KEYS.userSigningPublicKey(userId), signingPublicKey);
  logger.info('Signing key registered', { userId: userId.slice(0, 8) });
}

/**
 * Get a user's public key
 */
export const getPublicKey = async (userId: string): Promise<string | null> => {
  return redis.get(KEYS.userEncryptionPublicKey(userId));
}

/**
 * Get a user's signing public key
 */
export const getSigningPublicKey = async (userId: string): Promise<string | null> => {
  return redis.get(KEYS.userSigningPublicKey(userId));
}

/**
 * Check if a user exists (has registered public key)
 */
export const userExists = async (userId: string): Promise<boolean> => {
  const exists = await redis.exists(KEYS.userEncryptionPublicKey(userId));
  return exists === 1;
}

/**
 * Mark a user as online
 */
export const setUserOnline = async (userId: string): Promise<void> => {
  await syncUserOnlinePresence(userId);
  logger.debug('User online', { userId: userId.slice(0, 8) });
}

export const refreshUserPresence = async (userId: string): Promise<void> => {
  await syncUserOnlinePresence(userId);
}

/**
 * Mark a user as offline
 */
export const setUserOffline = async (userId: string): Promise<void> => {
  await removeUserOnlinePresence(userId);
  logger.debug('User offline', { userId: userId.slice(0, 8) });
}

/**
 * Check if a user is online
 */
export const isUserOnline = async (userId: string): Promise<boolean> => {
  const isPresent = await redis.exists(KEYS.userOnline(userId));
  if (isPresent === 1) {
    return true;
  }

  await redis.srem(KEYS.onlineUsers, userId);
  return false;
}

/**
 * Get all online users
 */
export const getOnlineUsers = async (): Promise<string[]> => {
  const userIds = await redis.smembers(KEYS.onlineUsers);
  return cleanupStaleOnlineUsers(userIds);
}

export const getOnlineUserCount = async (): Promise<number> => {
  const userIds = await getOnlineUsers();
  return userIds.length;
}

export const getRedisMemoryStats = async (): Promise<{
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryPressurePercent: number | null;
}> => {
  const info = await redis.info('memory');
  const values = new Map<string, string>();

  for (const line of info.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) 
      continue;

    const separatorIndex = trimmedLine.indexOf(':');
    if (separatorIndex === -1) 
      continue;

    values.set(trimmedLine.slice(0, separatorIndex), trimmedLine.slice(separatorIndex + 1));
  }

  const usedMemoryBytes = Number(values.get('used_memory'));
  const maxMemoryBytes = Number(values.get('maxmemory'));
  const normalizedUsedMemoryBytes = Number.isFinite(usedMemoryBytes) && usedMemoryBytes >= 0 ? usedMemoryBytes : null;
  const normalizedMaxMemoryBytes = Number.isFinite(maxMemoryBytes) && maxMemoryBytes > 0 ? maxMemoryBytes : null;

  return {
    usedMemoryBytes: normalizedUsedMemoryBytes,
    maxMemoryBytes: normalizedMaxMemoryBytes,
    memoryPressurePercent: normalizedUsedMemoryBytes !== null && normalizedMaxMemoryBytes !== null
      ? (normalizedUsedMemoryBytes / normalizedMaxMemoryBytes) * 100
      : null
  };
}

export const getQueuedMessageCount = async (): Promise<number> => {
  const keys = await scanKeys('user:*:messages');
  return sumCommandResults('llen', keys);
}

export const getQueuedReceiptCount = async (): Promise<number> => {
  const keys = await scanKeys('user:*:receipts:index');
  return sumCommandResults('zcard', keys);
}

export const getPendingIncomingCallCount = async (): Promise<number> => {
  const keys = await scanKeys('user:*:pendingCall:*');
  return keys.length;
}

export const getActiveCallCount = async (): Promise<number> => {
  const [pendingKeys, activeKeys] = await Promise.all([
    scanKeys('user:*:pendingCall:*'),
    scanKeys('user:*:activeCallSession')
  ]);

  if (activeKeys.length === 0) 
    return 0;

  const pendingPairs = new Set(
    pendingKeys
      .map((key) => parsePendingCallPairKey(key))
      .filter((pairKey): pairKey is string => typeof pairKey === 'string')
  );

  const pipeline = redis.pipeline();
  for (const key of activeKeys) 
    pipeline.get(key);

  const results = await pipeline.exec();
  if (!results) 
    return 0;

  const activePairs = new Set<string>();
  for (const [, value] of results) {
    if (typeof value !== 'string') 
      continue;

    try {
      const parsed = activeCallSessionSchema.safeParse(JSON.parse(value) as unknown);
      if (!parsed.success || parsed.data.expiresAt <= Date.now()) 
        continue;

      const pairKey = createCallPairKey(parsed.data.userId, parsed.data.peerId);
      if (!pendingPairs.has(pairKey)) 
        activePairs.add(pairKey);
    } catch {
      continue;
    }
  }

  return activePairs.size;
}

/**
 * Queue a message for an offline user
 * Messages are stored with TTL and deleted upon delivery confirmation
 */
export const queueMessage = async (recipientId: string, message: string): Promise<void> => {
  const key = KEYS.messageQueue(recipientId);
  await redis.rpush(key, message);
  await redis.expire(key, MESSAGE_TTL);
  logger.debug('Message queued', { recipientId: recipientId.slice(0, 8) });
}

/**
 * Get all queued messages for a user
 */
export const getQueuedMessages = async (userId: string): Promise<string[]> => {
  const key = KEYS.messageQueue(userId);
  return redis.lrange(key, 0, -1);
}

/**
 * Clear all queued messages for a user (after successful delivery)
 */
export const clearMessageQueue = async (userId: string): Promise<void> => {
  await redis.del(KEYS.messageQueue(userId));
  logger.debug('Message queue cleared', { userId: userId.slice(0, 8) });
}

/**
 * Queue a read receipt for an offline user
 */
export const queueReceipt = async (
  userId: string,
  messageId: string,
  status: 'delivered' | 'read'
): Promise<void> => {
  const key = KEYS.receiptQueue(userId);
  const indexKey = KEYS.receiptQueueIndex(userId);

  const existing = await redis.hget(key, messageId);
  if (existing === 'read') {
    return;
  }

  if (existing === 'delivered' && status === 'delivered') {
    return;
  }

  await redis.hset(key, messageId, status);
  await redis.zadd(indexKey, Date.now(), messageId);
  await redis.expire(key, MESSAGE_TTL);
  await redis.expire(indexKey, MESSAGE_TTL);

  const size = await redis.zcard(indexKey);
  if (size > RECEIPT_QUEUE_LIMIT) {
    const overflow = size - RECEIPT_QUEUE_LIMIT;
    const oldest = await redis.zrange(indexKey, 0, overflow - 1);
    if (oldest.length > 0) {
      await redis.zrem(indexKey, ...oldest);
      await redis.hdel(key, ...oldest);
    }
  }

  logger.debug('Receipt queued', { userId: userId.slice(0, 8), messageId, status });
}

/**
 * Get all queued read receipts for a user
 */
export const getQueuedReceipts = async  (
  userId: string
): Promise<Array<{ messageId: string; status: 'delivered' | 'read' }>> => {
  const key = KEYS.receiptQueue(userId);
  const indexKey = KEYS.receiptQueueIndex(userId);

  const ids = await redis.zrange(indexKey, 0, -1);
  if (ids.length === 0) {
    return [];
  }

  const statuses = await redis.hmget(key, ...ids);
  const receipts: Array<{ messageId: string; status: 'delivered' | 'read' }> = [];

  const statusIterator = statuses[Symbol.iterator]();
  for (const messageId of ids) {
    const statusResult = statusIterator.next();
    if (statusResult.done) {
      break;
    }

    const status = statusResult.value;
    if (status === 'delivered' || status === 'read') {
      receipts.push({ messageId, status });
    }
  }

  return receipts;
}

/**
 * Clear queued read receipts for a user
 */
/**
 * Remove a specific receipt
 */
export const removeQueuedReceipt = async (
  userId: string,
  messageId: string,
  status: 'delivered' | 'read'
): Promise<void> => {
  const key = KEYS.receiptQueue(userId);
  const indexKey = KEYS.receiptQueueIndex(userId);
  const existing = await redis.hget(key, messageId);

  if (!existing) {
    return;
  }

  if (existing === 'read' && status === 'delivered') {
    return;
  }

  await redis.hdel(key, messageId);
  await redis.zrem(indexKey, messageId);
}

export const addPushSubscription = async (
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> => {
  const key = KEYS.pushSubscriptions(userId);
  await redis.del(key);
  await redis.hset(key, subscription.endpoint, JSON.stringify(subscription));
  await redis.expire(key, MESSAGE_TTL);
}

export const removePushSubscription = async (userId: string, endpoint: string): Promise<void> => {
  const key = KEYS.pushSubscriptions(userId);
  await redis.hdel(key, endpoint);
}

export const getPushSubscriptions = async (userId: string): Promise<Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>> => {
  const key = KEYS.pushSubscriptions(userId);
  const values = await redis.hvals(key);
  return values
    .map(value => {
      try {
        return pushSubscriptionSchema.safeParse(JSON.parse(value) as unknown).data ?? null;
      } catch {
        return null;
      }
    })
    .filter((value): value is { endpoint: string; keys: { p256dh: string; auth: string } } => Boolean(value));
}

/**
 * Remove a specific message from the queue (by index)
 */
export const removeQueuedMessage = async (userId: string, messageId: string): Promise<{ senderId?: string } | null> => {
  const key = KEYS.messageQueue(userId);
  const messages = await redis.lrange(key, 0, -1);
  
  for (const [index, message] of messages.entries()) {
    try {
      const parsed = queuedMessageSchema.safeParse(JSON.parse(message) as unknown);
      if (parsed.success && parsed.data.id === messageId) {
        await redis.lset(key, index, '__DELETED__');
        await redis.lrem(key, 1, '__DELETED__');
        logger.debug('Message removed from queue', { messageId });
        return parsed.data.senderId === undefined ? {} : { senderId: parsed.data.senderId };
      }
    } catch (error) {
      logger.debug('Malformed queued message skipped during removal', {
        userId: userId.slice(0, 8),
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return null;
}

export const setPendingIncomingCall = async (
  userId: string,
  senderId: string,
  offer: { type: string; sdp?: string },
  callType: 'audio' | 'video'
): Promise<void> => {
  const key = KEYS.pendingIncomingCall(userId, senderId);
  const now = Date.now();
  const pending: PendingIncomingCall = {
    senderId,
    offer,
    callType,
    createdAt: now,
    expiresAt: now + INCOMING_CALL_TTL_SECONDS * 1000
  };

  await redis.set(key, JSON.stringify(pending), 'EX', INCOMING_CALL_TTL_SECONDS);
};

export const getPendingIncomingCall = async (
  userId: string,
  senderId: string
): Promise<PendingIncomingCall | null> => {
  const key = KEYS.pendingIncomingCall(userId, senderId);
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }

  try {
    const parsed = pendingIncomingCallSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      return null;
    }

    if (parsed.data.expiresAt <= Date.now()) {
      await redis.del(key);
      return null;
    }

    return {
      senderId: parsed.data.senderId,
      offer: {
        type: parsed.data.offer.type,
        ...(parsed.data.offer.sdp !== undefined ? { sdp: parsed.data.offer.sdp } : {})
      },
      callType: parsed.data.callType,
      createdAt: parsed.data.createdAt,
      expiresAt: parsed.data.expiresAt
    };
  } catch {
    return null;
  }
};

export const clearPendingIncomingCall = async (userId: string, senderId: string): Promise<void> => {
  const key = KEYS.pendingIncomingCall(userId, senderId);
  await redis.del(key);
};

export const setActiveCallSession = async (
  userId: string,
  peerId: string,
  callType: 'audio' | 'video'
): Promise<void> => {
  const key = KEYS.activeCallSession(userId);
  const now = Date.now();
  const session: ActiveCallSession = {
    userId,
    peerId,
    callType,
    createdAt: now,
    expiresAt: now + ACTIVE_CALL_SESSION_TTL_SECONDS * 1000
  };

  await redis.set(key, JSON.stringify(session), 'EX', ACTIVE_CALL_SESSION_TTL_SECONDS);
};

export const getActiveCallSession = async (userId: string): Promise<ActiveCallSession | null> => {
  const key = KEYS.activeCallSession(userId);
  const raw = await redis.get(key);
  if (!raw)
    return null;

  try {
    const parsed = activeCallSessionSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.userId !== userId)
      return null;

    if (parsed.data.expiresAt <= Date.now()) {
      await redis.del(key);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
};

export const clearActiveCallSession = async (userId: string): Promise<void> => {
  await redis.del(KEYS.activeCallSession(userId));
};
