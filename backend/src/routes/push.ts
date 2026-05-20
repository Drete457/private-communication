import { Router } from 'express';
import { z } from 'zod';

import { addPushSubscription, removePushSubscription } from '../services/redis';
import { logger } from '../utils/logger';
import { sendValidatedJson } from '../utils/response-validation';

import type { Response } from 'express';

const pushRouter = Router();

const pushSubscriptionSchema = z.object({
	userId: z.string().min(1),
	subscription: z.object({
		endpoint: z.string().min(1),
		keys: z.object({
			p256dh: z.string().min(1),
			auth: z.string().min(1)
		})
	})
});

const pushUnsubscribeSchema = z.object({
	userId: z.string().min(1),
	endpoint: z.string().min(1)
});

const pushErrorResponseSchema = z.object({
	error: z.string().min(1)
}).strict();

const pushPublicKeyResponseSchema = z.object({
	publicKey: z.string().min(1)
}).strict();

const pushSuccessResponseSchema = z.object({
	success: z.literal(true)
}).strict();

const sendPushError = (res: Response, status: number, error: string) => (
	sendValidatedJson(
		res,
		pushErrorResponseSchema,
		{ error },
		{
			label: 'push error response',
			status,
			errorStatus: status,
			errorBody: { error }
		}
	)
);

pushRouter.get('/public-key', (_req, res) => {
	const publicKey = process.env['VAPID_PUBLIC_KEY'] ?? '';
	if (!publicKey) {
		return sendPushError(res, 500, 'VAPID public key not configured');
	}
	logger.debug('Push public key requested');
	return sendValidatedJson(res, pushPublicKeyResponseSchema, { publicKey }, { label: 'push public key response' });
});

pushRouter.post('/subscribe', async (req, res) => {
	const parsed = pushSubscriptionSchema.safeParse(req.body);
	if (!parsed.success) {
		return sendPushError(res, 400, 'Invalid subscription payload');
	}
	const { userId, subscription } = parsed.data;

	if (subscription.endpoint.includes('permanently-removed.invalid')) {
		logger.warn('Rejected invalid push subscription', { userId: userId.slice(0, 8) });
		return sendPushError(res, 400, 'Invalid subscription endpoint');
	}

	await addPushSubscription(userId, subscription);
	logger.info('Push subscription saved', { userId: userId.slice(0, 8) });
	return sendValidatedJson(res, pushSuccessResponseSchema, { success: true }, { label: 'push subscribe response' });
});

pushRouter.post('/unsubscribe', async (req, res) => {
	const parsed = pushUnsubscribeSchema.safeParse(req.body);
	if (!parsed.success) {
		return sendPushError(res, 400, 'Invalid unsubscribe payload');
	}
	const { userId, endpoint } = parsed.data;

	await removePushSubscription(userId, endpoint);
	logger.info('Push subscription removed', { userId: userId.slice(0, 8) });
	return sendValidatedJson(res, pushSuccessResponseSchema, { success: true }, { label: 'push unsubscribe response' });
});

export { pushRouter };
