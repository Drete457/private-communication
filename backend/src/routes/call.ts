import { Router } from 'express';
import { z } from 'zod';

import { getActiveCallSession, getPendingIncomingCall } from '../services/redis';
import { sendValidatedJson } from '../utils/response-validation';

import type { Response } from 'express';

const callRouter = Router();

const userIdSchema = z.string().min(1);
const callTypeSchema = z.enum(['audio', 'video']);
const callRecoveryErrorResponseSchema = z.object({
  error: z.string().min(1)
}).strict();
const rtcOfferSchema = z.object({
  type: z.literal('offer'),
  sdp: z.string().optional()
}).catchall(z.unknown());
const callRecoveryResponseSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('active'),
    peerId: z.string().min(1),
    callType: callTypeSchema,
    expiresAt: z.number()
  }).strict(),
  z.object({
    state: z.literal('pending'),
    senderId: z.string().min(1),
    offer: rtcOfferSchema,
    callType: callTypeSchema,
    expiresAt: z.number()
  }).strict(),
  z.object({
    state: z.literal('none')
  }).strict()
]);

const sendCallRecoveryError = (res: Response, status: number, error: string) => (
  sendValidatedJson(
    res,
    callRecoveryErrorResponseSchema,
    { error },
    {
      label: 'call recovery error response',
      status,
      errorStatus: status,
      errorBody: { error }
    }
  )
);

callRouter.get('/recover/:peerId', async (req, res) => {
  const peerId = userIdSchema.safeParse(req.params.peerId);
  const authUserId = userIdSchema.safeParse(req.header('x-auth-user-id'));

  if (!authUserId.success)
    return sendCallRecoveryError(res, 401, 'Missing auth user id');

  if (!peerId.success)
    return sendCallRecoveryError(res, 400, 'Missing peerId');

  const session = await getActiveCallSession(authUserId.data);
  if (session?.peerId === peerId.data) {
    return sendValidatedJson(res, callRecoveryResponseSchema, {
      state: 'active',
      peerId: session.peerId,
      callType: session.callType,
      expiresAt: session.expiresAt
    }, { label: 'active call recovery response' });
  }

  const pending = await getPendingIncomingCall(authUserId.data, peerId.data);
  if (pending) {
    return sendValidatedJson(res, callRecoveryResponseSchema, {
      state: 'pending',
      senderId: pending.senderId,
      offer: pending.offer,
      callType: pending.callType,
      expiresAt: pending.expiresAt
    }, { label: 'pending call recovery response' });
  }

  return sendValidatedJson(res, callRecoveryResponseSchema, { state: 'none' }, { label: 'empty call recovery response' });
});

export { callRouter };
