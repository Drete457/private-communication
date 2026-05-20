import { signData, getKeyPair } from '@/crypto';
import { getAuthSession } from '@/services/auth-session-service';

const AUTH_HEADER_USER = 'x-auth-user-id';
const AUTH_HEADER_TIMESTAMP = 'x-auth-timestamp';
const AUTH_HEADER_SIGNATURE = 'x-auth-signature';
const AUTH_HEADER_SIGNING_PUBLIC_KEY = 'x-auth-signing-public-key';
const AUTH_HEADER_ENCRYPTION_PUBLIC_KEY = 'x-auth-encryption-public-key';

const buildPathWithQuery = (url: string): string => {
	const parsed = new URL(url, window.location.origin);
	return `${parsed.pathname}${parsed.search}`;
};

const normalizeBody = (body?: BodyInit | null): string => {
	if (!body) return '';
	if (typeof body === 'string') return body;
	if (body instanceof URLSearchParams) return body.toString();
	if (body instanceof Blob) return '';
	if (body instanceof FormData) return '';
	return '';
};

const buildSignaturePayload = (method: string, pathWithQuery: string, timestamp: number, body: string): string => {
	return `${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${body}`;
};

const resolveRequestMethod = (method: string | undefined): string => (
	method && method.length > 0 ? method : 'GET'
);

const getAuthContext = async () => {
	const { userId, signingPublicKey, publicKey } = getAuthSession();
	if (!userId || !signingPublicKey || !publicKey) {
		return null;
	}

	const signingKeyPair = await getKeyPair('signing');
	if (!signingKeyPair) {
		return null;
	}

	return { userId, signingPublicKey, encryptionPublicKey: publicKey, privateKey: signingKeyPair.privateKey };
};

const createSignedHeaders = async (method: string, url: string, body?: BodyInit | null): Promise<Record<string, string>> => {
	const context = await getAuthContext();
	if (!context) return {};

	const timestamp = Date.now();
	const pathWithQuery = buildPathWithQuery(url);
	const bodyString = normalizeBody(body);
	const payload = buildSignaturePayload(method, pathWithQuery, timestamp, bodyString);
	const signature = await signData(payload, context.privateKey);

	return {
		[AUTH_HEADER_USER]: context.userId,
		[AUTH_HEADER_TIMESTAMP]: String(timestamp),
		[AUTH_HEADER_SIGNATURE]: signature,
		[AUTH_HEADER_SIGNING_PUBLIC_KEY]: context.signingPublicKey,
		[AUTH_HEADER_ENCRYPTION_PUBLIC_KEY]: context.encryptionPublicKey
	};
};

const signedFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
	const method = resolveRequestMethod(init.method);
	const headers = new Headers(init.headers ?? {});
	const body = init.body ?? null;
	const signedHeaders = await createSignedHeaders(method, input, body);

	Object.entries(signedHeaders).forEach(([key, value]) => headers.set(key, value));

	return fetch(input, {
		...init,
		method,
		headers
	});
};

const buildSignedUrl = async (url: string, method = 'GET'): Promise<string> => {
	const context = await getAuthContext();
	if (!context) return url;

	const parsed = new URL(url, window.location.origin);
	const pathWithQuery = `${parsed.pathname}${parsed.search}`;
	const timestamp = Date.now();
	const payload = buildSignaturePayload(method, pathWithQuery, timestamp, '');
	const signature = await signData(payload, context.privateKey);

	parsed.searchParams.set('auth_uid', context.userId);
	parsed.searchParams.set('auth_ts', String(timestamp));
	parsed.searchParams.set('auth_sig', signature);
	parsed.searchParams.set('auth_spk', context.signingPublicKey);
	parsed.searchParams.set('auth_epk', context.encryptionPublicKey);

	return parsed.toString();
};

export {
	createSignedHeaders,
	signedFetch,
	buildSignedUrl
};