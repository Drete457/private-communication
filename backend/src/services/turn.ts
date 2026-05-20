import { createHmac } from 'crypto';

const TURN_SECRET = process.env['TURN_SECRET'] ?? '';
const TURN_TTL_SECONDS = Number(process.env['TURN_TTL_SECONDS'] ?? 3600);
const TURN_URLS = (process.env['TURN_URLS'] ?? '')
	.split(',')
	.map((entry) => entry.trim())
	.filter(Boolean);

export type TurnCredentials = {
	iceServers: Array<{ urls: string[]; username: string; credential: string }>;
	expiresAt: number;
	ttl: number;
};

const assertTurnConfig = (): void => {
	if (!TURN_SECRET) {
		throw new Error('TURN_SECRET not configured');
	}
	if (TURN_URLS.length === 0) {
		throw new Error('TURN_URLS not configured');
	}
};

const buildTurnCredentials = (userId: string): TurnCredentials => {
	assertTurnConfig();

	const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
	const username = `${expiresAt}:${userId}`;
	const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64');

	return {
		iceServers: [
			{
				urls: TURN_URLS,
				username,
				credential
			}
		],
		expiresAt,
		ttl: TURN_TTL_SECONDS
	};
};

export { buildTurnCredentials };