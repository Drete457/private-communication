import webPush from 'web-push';

import { logger } from '../utils/logger';

import { getPushSubscriptions, removePushSubscription } from './redis';

import type { PushSubscription } from 'web-push';

const VAPID_PUBLIC_KEY = process.env['VAPID_PUBLIC_KEY'] ?? '';
const VAPID_PRIVATE_KEY = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:admin@example.com';

let pushNotificationsEnabled = false;

const getWebPushErrorDetails = (error: unknown): { body?: string; message?: string; statusCode?: number } => {
	if (typeof error !== 'object' || error === null)
		return { message: String(error) };

	const errorRecord = error as Record<'body' | 'message' | 'statusCode', unknown> & Record<string, unknown>;
	const details: { body?: string; message?: string; statusCode?: number } = {};
	if (typeof errorRecord.body === 'string')
		details.body = errorRecord.body;
	if (typeof errorRecord.message === 'string')
		details.message = errorRecord.message;
	if (typeof errorRecord.statusCode === 'number')
		details.statusCode = errorRecord.statusCode;

	return details;
};

export const initializePush = (): void => {
	if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
		pushNotificationsEnabled = false;
		logger.warn('VAPID keys not configured; push notifications disabled');
		return;
	}

	try {
		webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
		pushNotificationsEnabled = true;
		logger.info('Push notifications initialized');
	} catch (error: unknown) {
		pushNotificationsEnabled = false;
		logger.warn('Invalid VAPID configuration; push notifications disabled', getWebPushErrorDetails(error));
	}
}

export const sendPushToUser = async (
	userId: string,
	payload: Record<string, unknown>
): Promise<void> => {
	if (!pushNotificationsEnabled) {
		logger.debug('Push skipped (push notifications disabled)', { userId: userId.slice(0, 8) });
		return;
	}

	const subscriptions = await getPushSubscriptions(userId);
	if (subscriptions.length === 0) {
		logger.debug('Push skipped (no subscriptions)', { userId: userId.slice(0, 8) });
		return;
	}

	logger.info('Push send attempt', {
		userId: userId.slice(0, 8),
		subscriptions: subscriptions.length
	});

	// Validate payload fields on backend before sending to push provider
	const { type, senderId, title, body: notificationBody, url, callType } = payload as {
		type?: string;
		senderId?: string;
		title?: string;
		body?: string;
		url?: string;
		callType?: string;
	};
	const safePayload = {
		type: typeof type === 'string' ? type : 'new_message',
		senderId: typeof senderId === 'string' ? senderId : undefined,
		title: typeof title === 'string' ? title : undefined,
		body: typeof notificationBody === 'string' ? notificationBody : undefined,
		url: typeof url === 'string' ? url : undefined,
		callType: callType === 'audio' || callType === 'video' ? callType : undefined
	};
	const body = JSON.stringify(safePayload);

	await Promise.all(
		subscriptions.map(async (subscription: PushSubscription) => {
			try {
				await webPush.sendNotification(subscription, body);
				logger.debug('Push sent', { userId: userId.slice(0, 8) });
			} catch (error: unknown) {
				const err = getWebPushErrorDetails(error);
				const statusCode = err.statusCode;
				const isPermanentlyRemoved = subscription.endpoint.includes('permanently-removed.invalid');
				const isDnsFailure = err.message?.includes('ENOTFOUND') ?? false;
				if (statusCode === 404 || statusCode === 410 || isPermanentlyRemoved || isDnsFailure)
					await removePushSubscription(userId, subscription.endpoint);

				logger.warn('Push notification failed', {
					userId: userId.slice(0, 8),
					statusCode,
					endpoint: subscription.endpoint,
					message: err.message,
					body: err.body
				});
			}
		})
	);
}
