import { signedFetch } from '@/helpers/messages/http-auth';
import { isRecord, isString, parseJsonResponse } from '@/helpers/validation';
import { clientLogger } from '@/services/logger';

interface PushSubscriptionResponse {
	publicKey: string;
}

type PushSubscriptionResponseRecord = {
	publicKey?: unknown;
};

const isPushSubscriptionResponseRecord = (value: unknown): value is PushSubscriptionResponseRecord => isRecord(value);

const parsePushSubscriptionResponse = (value: unknown): PushSubscriptionResponse | null => {
	if (!isPushSubscriptionResponseRecord(value) || !isString(value.publicKey))
		return null;

	return { publicKey: value.publicKey };
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
};

const ensurePushSubscription = async (userId: string | null): Promise<void> => {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return;
	}

	if (!userId) {
		return;
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		return;
	}

	const swRegistration = await navigator.serviceWorker.ready;
	let subscription = await swRegistration.pushManager.getSubscription();

	const response = await signedFetch('/api/push/public-key');
	if (!response.ok) {
		return;
	}

	let data: PushSubscriptionResponse;
	try {
		data = await parseJsonResponse(response, parsePushSubscriptionResponse, 'push public key');
	} catch (error) {
		clientLogger.warn('Push public key response invalid:', error);
		return;
	}

	const applicationServerKey = urlBase64ToUint8Array(data.publicKey).buffer as ArrayBuffer;

	const subscribeWithKey = async (): Promise<PushSubscription> => {
		return swRegistration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey
		});
	};

	const isInvalidEndpoint = (endpoint?: string): boolean =>
		endpoint?.includes('permanently-removed.invalid') ?? false;

	if (!subscription || isInvalidEndpoint(subscription.endpoint)) {
		if (subscription) {
			try {
				await subscription.unsubscribe();
			} catch (error) {
				clientLogger.debug('Failed to unsubscribe stale push subscription:', error);
			}
		}
		try {
			subscription = await subscribeWithKey();
		} catch (error) {
			clientLogger.warn('Failed to create push subscription:', error);
			return;
		}
	}

	if (isInvalidEndpoint(subscription.endpoint)) {
		try {
			await subscription.unsubscribe();
		} catch (error) {
			clientLogger.debug('Failed to unsubscribe invalid push subscription:', error);
		}
		try {
			subscription = await subscribeWithKey();
		} catch (error) {
			clientLogger.warn('Failed to recreate push subscription:', error);
			return;
		}
	}

	if (isInvalidEndpoint(subscription.endpoint)) 
		return;

	await signedFetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ userId, subscription })
	});
};

const removePushSubscription = async (userId: string | null): Promise<void> => {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) 
		return;

	if (!userId) 
		return;

	const swRegistration = await navigator.serviceWorker.ready;
	const subscription = await swRegistration.pushManager.getSubscription();
	if (!subscription) {
		return;
	}

	try {
		await signedFetch('/api/push/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, endpoint: subscription.endpoint })
		});
	} finally {
		try {
			await subscription.unsubscribe();
		} catch (error) {
			clientLogger.debug('Failed to unsubscribe local push subscription:', error);
		}
	}
};

export { ensurePushSubscription, removePushSubscription };