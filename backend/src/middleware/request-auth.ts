
import { recordDashboardAuthFailure } from '../services/application';
import { hashPublicKeySpki, spkiToPem, verifySignature } from '../utils/crypto';
import { logger } from '../utils/logger';

import type { NextFunction, Request, Response } from 'express';

const AUTH_WINDOW_MS = Number(process.env['HTTP_AUTH_WINDOW_MS'] ?? 300000); // 5 minutes
const AUTH_DISABLED = process.env['HTTP_AUTH_DISABLED'] === 'true' || (process.env['NODE_ENV'] !== 'production' && process.env['HTTP_AUTH_DISABLED'] !== 'false');

type AuthParams = {
	userId: string;
	timestamp: number;
	signature: string;
	signingPublicKey: string;
	encryptionPublicKey: string;
};

const getRawBody = (req: Request): string => {
	const raw = (req as Request & { rawBody?: string }).rawBody;
	return raw ?? '';
};

const extractAuthParams = (req: Request): AuthParams | null => {
	const headerUserId = req.headers['x-auth-user-id'];
	const headerTimestamp = req.headers['x-auth-timestamp'];
	const headerSignature = req.headers['x-auth-signature'];
	const headerSigningKey = req.headers['x-auth-signing-public-key'];
	const headerEncryptionKey = req.headers['x-auth-encryption-public-key'];

	if (typeof headerUserId === 'string' && typeof headerTimestamp === 'string' && typeof headerSignature === 'string' && typeof headerSigningKey === 'string' && typeof headerEncryptionKey === 'string') {
		return {
			userId: headerUserId,
			timestamp: Number(headerTimestamp),
			signature: headerSignature,
			signingPublicKey: headerSigningKey,
			encryptionPublicKey: headerEncryptionKey
		};
	}

	const queryUserId = req.query['auth_uid'];
	const queryTimestamp = req.query['auth_ts'];
	const querySignature = req.query['auth_sig'];
	const querySigningKey = req.query['auth_spk'];
	const queryEncryptionKey = req.query['auth_epk'];

	if (typeof queryUserId === 'string' && typeof queryTimestamp === 'string' && typeof querySignature === 'string' && typeof querySigningKey === 'string' && typeof queryEncryptionKey === 'string') {
		return {
			userId: queryUserId,
			timestamp: Number(queryTimestamp),
			signature: querySignature,
			signingPublicKey: querySigningKey,
			encryptionPublicKey: queryEncryptionKey
		};
	}

	return null;
};

const buildSignedPath = (req: Request): string => {
	const url = new URL(req.originalUrl, 'http://localhost');
	url.searchParams.delete('auth_uid');
	url.searchParams.delete('auth_ts');
	url.searchParams.delete('auth_sig');
	url.searchParams.delete('auth_spk');
	url.searchParams.delete('auth_epk');
	return `${url.pathname}${url.search}`;
};

const requireSignedRequest = () => (req: Request, res: Response, next: NextFunction): void => {
	if (AUTH_DISABLED) {
		next();
		return;
	}

	const params = extractAuthParams(req);
	if (!params?.userId || !params.signature || !params.signingPublicKey || !params.encryptionPublicKey) {
		recordDashboardAuthFailure();
		res.status(401).json({ error: 'Missing auth signature' });
		return;
	}

	if (!Number.isFinite(params.timestamp)) {
		recordDashboardAuthFailure();
		res.status(401).json({ error: 'Invalid auth timestamp' });
		return;
	}

	const now = Date.now();
	if (Math.abs(now - params.timestamp) > AUTH_WINDOW_MS) {
		recordDashboardAuthFailure();
		res.status(401).json({ error: 'Auth timestamp expired' });
		return;
	}

	const body = getRawBody(req);
	const signedPath = buildSignedPath(req);
	const payload = `${params.timestamp}.${req.method.toUpperCase()}.${signedPath}.${body}`;
	const pem = spkiToPem(params.signingPublicKey);
	const valid = verifySignature(payload, params.signature, pem);

	if (!valid) {
		recordDashboardAuthFailure();
		logger.warn('Invalid HTTP signature', { path: req.originalUrl });
		res.status(401).json({ error: 'Invalid signature' });
		return;
	}

	const derivedUserId = hashPublicKeySpki(params.encryptionPublicKey);
	if (!derivedUserId || derivedUserId !== params.userId) {
		recordDashboardAuthFailure();
		logger.warn('Invalid userId for encryption key', { path: req.originalUrl });
		res.status(401).json({ error: 'Invalid user identity' });
		return;
	}

	next();
};

const validateOrigin = (allowedOrigins: string[]) => (req: Request, res: Response, next: NextFunction): void => {
	if (AUTH_DISABLED) {
		next();
		return;
	}

	const origin = req.headers.origin;
	if (!origin || typeof origin !== 'string') {
		res.status(403).json({ error: 'Origin required' });
		return;
	}

	if (allowedOrigins.includes(origin)) {
		next();
		return;
	}
	
	res.status(403).json({ error: 'Origin not allowed' });
};

export { requireSignedRequest, validateOrigin }