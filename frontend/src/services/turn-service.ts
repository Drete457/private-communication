import { signedFetch } from '@/helpers/messages/http-auth';
import { isFiniteNumber, isRecord, isString, isStringArray, parseJsonResponse } from '@/helpers/validation';

export type TurnIceResponse = {
	iceServers: RTCIceServer[];
	expiresAt: number;
	ttl: number;
};

let cached: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
let inFlight: Promise<RTCIceServer[]> | null = null;

type IceServerRecord = {
	urls?: unknown;
	username?: unknown;
	credential?: unknown;
};

type TurnIceResponseRecord = {
	iceServers?: unknown;
	expiresAt?: unknown;
	ttl?: unknown;
};

const isIceServerRecord = (value: unknown): value is IceServerRecord => isRecord(value);

const isTurnIceResponseRecord = (value: unknown): value is TurnIceResponseRecord => isRecord(value);

const parseIceServer = (value: unknown): RTCIceServer | null => {
	if (!isIceServerRecord(value))
		return null;

	const urls = isString(value.urls)
		? value.urls
		: (isStringArray(value.urls) && value.urls.length > 0 ? value.urls : null);
	if (urls === null)
		return null;

	return {
		urls,
		...(isString(value.username) ? { username: value.username } : {}),
		...(isString(value.credential) ? { credential: value.credential } : {})
	};
};

const parseTurnIceResponse = (value: unknown): TurnIceResponse | null => {
	if (!isTurnIceResponseRecord(value)
		|| !Array.isArray(value.iceServers)
		|| !isFiniteNumber(value.expiresAt)
		|| !isFiniteNumber(value.ttl)) {
		return null;
	}

	const iceServers: RTCIceServer[] = [];
	for (const iceServerValue of value.iceServers) {
		const iceServer = parseIceServer(iceServerValue);
		if (iceServer === null)
			return null;

		iceServers.push(iceServer);
	}

	return {
		iceServers,
		expiresAt: value.expiresAt,
		ttl: value.ttl
	};
};

const shouldRefresh = (): boolean => {
	if (!cached) return true;
	const now = Date.now();
	return cached.expiresAt * 1000 - now < 60_000;
};

const getTurnIceServers = async (): Promise<RTCIceServer[]> => {
	const cachedCredentials = cached;
	if (cachedCredentials && !shouldRefresh()) {
		return cachedCredentials.iceServers;
	}

	if (inFlight) {
		return inFlight;
	}

	inFlight = (async () => {
		const response = await signedFetch('/api/turn');
		if (!response.ok) {
			throw new Error('Failed to fetch TURN credentials');
		}
		const data = await parseJsonResponse(response, parseTurnIceResponse, 'TURN credentials');
		cached = { iceServers: data.iceServers, expiresAt: data.expiresAt };
		return cached.iceServers;
	})().finally(() => {
		inFlight = null;
	});

	try {
		return await inFlight;
	} catch {
		return [];
	}
};

export { getTurnIceServers };
