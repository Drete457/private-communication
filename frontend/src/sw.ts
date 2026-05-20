/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

import type { PrecacheEntry } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: PrecacheEntry[];
};

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

type PushPayload = {
	type?: string | undefined;
	title?: string | undefined;
	body?: string | undefined;
	url?: string | undefined;
	senderId?: string | undefined;
	callType?: 'audio' | 'video' | undefined;
};

type NotificationData = {
	url: string;
	type?: string | undefined;
	senderId?: string | undefined;
	callType?: 'audio' | 'video' | undefined;
	messageCount?: number | undefined;
	reminderType?: 'upload' | 'download' | undefined;
};

type ClearNotificationsMessage = {
	type: 'clear_notifications';
	notificationType?: 'message' | 'incoming_call' | 'local_attachment' | 'all';
};

type ShowAttachmentReminderMessage = {
	type: 'show_attachment_reminder';
	reminderType: 'upload' | 'download';
	title: string;
	body: string;
	url?: string;
	tag?: string;
};

type SkipWaitingMessage = {
	type: 'SKIP_WAITING';
};

type ServiceWorkerMessage = ClearNotificationsMessage | ShowAttachmentReminderMessage | SkipWaitingMessage;
type NotificationFilterType = ClearNotificationsMessage['notificationType'];

type NotificationOptionsWithRenotify = NotificationOptions & {
	renotify?: boolean;
};

const getNonEmptyStringOrFallback = (value: string | null | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const parsePushPayload = (event: PushEvent): PushPayload => {
	if (!event.data) {
		return {};
	}

	try {
		return event.data.json() as PushPayload;
	} catch {
		const text = event.data.text();
		return { body: text };
	}
};

const openKeyDatabase = (): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('PrivateCommunicationKeys');
		request.onerror = () => reject(request.error ?? new Error('Failed to open key database'));
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			// No-op: database will be created without stores if missing
		};
	});
};

const getPeerDisplayName = async (peerId?: string): Promise<string | null> => {
	if (!peerId || !('indexedDB' in self)) {
		return null;
	}

	try {
		const db = await openKeyDatabase();
		if (!db.objectStoreNames.contains('peerKeys')) {
			db.close();
			return null;
		}

		return await new Promise((resolve) => {
			const tx = db.transaction('peerKeys', 'readonly');
			const store = tx.objectStore('peerKeys');
			const request = store.get(peerId);
			request.onsuccess = () => {
				const result = request.result as { displayName?: string } | undefined;
				resolve(result?.displayName ?? null);
			};
			request.onerror = () => resolve(null);
			tx.oncomplete = () => db.close();
			tx.onerror = () => db.close();
		});
	} catch {
		return null;
	}
};

const whatNameToShow = (displayName: string | null, incomingCall?: boolean, type?: string, title?: string, body?: string): [string, string] => {
	const defaultName = getNonEmptyStringOrFallback(displayName, getNonEmptyStringOrFallback(title, 'Private User'));
	let bodyText = getNonEmptyStringOrFallback(body, 'You have a new message.');
	
	if (incomingCall) {
		const callTypeName = type === 'audio' ? 'Audio' : 'Video';
		bodyText = `Incoming ${callTypeName} call`;
	}

	return [defaultName, bodyText];
};

const buildGroupedMessageBody = (latestBody: string, messageCount: number): string => {
	if (messageCount <= 1) 
		return latestBody;

	return `${messageCount} new messages`;
};

const matchesNotificationType = (data: NotificationData | undefined, notificationType: NotificationFilterType): boolean => {
	if (!notificationType || notificationType === 'all') 
		return true;

	if (notificationType === 'incoming_call') 
		return data?.type === 'incoming_call';

	if (notificationType === 'local_attachment')
		return data?.type === 'local_attachment';

	return data?.type !== 'incoming_call' && data?.type !== 'local_attachment';
};

const closeNotifications = async (notificationType: NotificationFilterType = 'all'): Promise<void> => {
	const notifications = await self.registration.getNotifications();
	for (const notification of notifications) {
		const data = notification.data as NotificationData | undefined;
		if (matchesNotificationType(data, notificationType)) 
			notification.close();
	}
};

const isSameOriginWindowClient = (client: WindowClient): boolean => {
	try {
		return new URL(client.url).origin === self.location.origin;
	} catch {
		return false;
	}
};

const focusAndNavigateClient = async (client: WindowClient, targetUrl: string): Promise<void> => {
	await client.focus();

	if (client.url === targetUrl || !('navigate' in client)) 
		return;

	await client.navigate(targetUrl);
};

const tryReuseClient = async (client: WindowClient, targetUrl: string): Promise<boolean> => {
	try {
		await focusAndNavigateClient(client, targetUrl);
		return true;
	} catch {
		return false;
	}
};

const openWindowClient = async (url: string): Promise<WindowClient | null> => (
	self.clients.openWindow(url)
);

self.addEventListener('push', (event: PushEvent) => {
	const promise = (async () => {
		const data = parsePushPayload(event);
		const displayName = await getPeerDisplayName(data.senderId);
		const isIncomingCall = data.type === 'incoming_call';
		const [defaultName, callNotificationText] = whatNameToShow(displayName, isIncomingCall, data.callType, data.title, data.body);
		const title = defaultName;
		const url = getNonEmptyStringOrFallback(data.url, '/');
		const tag = isIncomingCall
			? `incoming-call-${getNonEmptyStringOrFallback(data.senderId, 'unknown')}`
			: `messages-${getNonEmptyStringOrFallback(data.senderId, 'unknown')}`;
		const existingNotifications = await self.registration.getNotifications({ tag });
		const existingData = existingNotifications[0]?.data as NotificationData | undefined;
		const messageCount = isIncomingCall ? 1 : (existingData?.messageCount ?? 0) + 1;
		const body = isIncomingCall
			? callNotificationText
			: buildGroupedMessageBody(callNotificationText, messageCount);
		const notificationOptions: NotificationOptionsWithRenotify = {
			body,
			icon: '/web-app-manifest-192x192.png',
			badge: '/notification-badge.png',
			requireInteraction: true,
			silent: false,
			tag,
			data: {
				url,
				type: data.type,
				senderId: data.senderId,
				callType: data.callType,
				messageCount
			} satisfies NotificationData
		};

		if (existingNotifications.length > 0) 
			notificationOptions.renotify = true;

		await self.registration.showNotification(title, notificationOptions);
	})();

	event.waitUntil(promise);
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
	const data = event.data as ServiceWorkerMessage | undefined;
	if (!data)
		return;

	if (data.type === 'SKIP_WAITING') {
		event.waitUntil(self.skipWaiting());
		return;
	}

	if (data.type === 'clear_notifications') {
		event.waitUntil(closeNotifications(data.notificationType));
		return;
	}

	event.waitUntil((async () => {
		const tag = getNonEmptyStringOrFallback(data.tag, `attachment-reminder-${data.reminderType}`);
		const existingNotifications = await self.registration.getNotifications({ tag });
		const notificationOptions: NotificationOptionsWithRenotify = {
			body: data.body,
			icon: '/web-app-manifest-192x192.png',
			badge: '/notification-badge.png',
			requireInteraction: true,
			silent: false,
			tag,
			data: {
				url: getNonEmptyStringOrFallback(data.url, '/'),
				type: 'local_attachment',
				reminderType: data.reminderType
			} satisfies NotificationData
		};

		if (existingNotifications.length > 0)
			notificationOptions.renotify = true;

		await self.registration.showNotification(data.title, notificationOptions);
	})());
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
	event.notification.close();
	const targetPath = getNonEmptyStringOrFallback((event.notification.data as { url?: string } | undefined)?.url, '/');
	const targetUrl = new URL(targetPath, self.location.origin).toString();
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
			const sameOriginClients = clientList.filter((client): client is WindowClient =>
				'focus' in client && isSameOriginWindowClient(client)
			);
			const reusableClient = sameOriginClients.find((client) => client.url === targetUrl)
				?? sameOriginClients.at(0);

			if (reusableClient && await tryReuseClient(reusableClient, targetUrl)) 
				return;

			const openedClient = await openWindowClient(targetUrl);
			if (openedClient) {
				await openedClient.focus();
				return;
			}

			if (targetPath !== '/') {
				const fallbackClient = await openWindowClient('/');
				if (fallbackClient) 
					await fallbackClient.focus();
			}
		})
	);
});
