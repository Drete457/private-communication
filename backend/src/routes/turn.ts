import { Router } from 'express';
import { z } from 'zod';

import { buildTurnCredentials } from '../services';
import { sendValidatedJson } from '../utils/response-validation';

import type { Response } from 'express';

const turnRouter = Router();

const turnErrorResponseSchema = z.object({
	error: z.string().min(1)
}).strict();

const turnIceResponseSchema = z.object({
	iceServers: z.array(z.object({
		urls: z.array(z.string().min(1)).min(1),
		username: z.string().min(1),
		credential: z.string().min(1)
	}).strict()).min(1),
	expiresAt: z.number().int().positive(),
	ttl: z.number().int().positive()
}).strict();

const sendTurnError = (res: Response, status: number, error: string) => (
	sendValidatedJson(
		res,
		turnErrorResponseSchema,
		{ error },
		{
			label: 'TURN error response',
			status,
			errorStatus: status,
			errorBody: { error }
		}
	)
);

turnRouter.get('/', (req, res) => {
	const userId = req.headers['x-auth-user-id'];
	if (typeof userId !== 'string' || userId.length === 0) {
		return sendTurnError(res, 401, 'Missing user identity');
	}

	try {
		const credentials = buildTurnCredentials(userId);
		return sendValidatedJson(res, turnIceResponseSchema, credentials, { label: 'TURN credentials response' });
	} catch (error) {
		return sendTurnError(res, 500, error instanceof Error ? error.message : 'TURN credentials unavailable');
	}
});

export { turnRouter };
