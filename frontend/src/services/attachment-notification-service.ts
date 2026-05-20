import { getAttachmentContinuationReminderMessage, getAttachmentContinuationReminderTitle } from '@/helpers/attachments';
import { navigation } from '@/helpers/navigation';

type AttachmentReminderKind = 'upload' | 'download';

const ATTACHMENT_REMINDER_THROTTLE_MS = 10_000;

const lastReminderAt: Record<AttachmentReminderKind, number> = {
	upload: 0,
	download: 0
};

const canUseLocalNotifications = (): boolean =>
	typeof window !== 'undefined'
	&& 'Notification' in window
	&& 'serviceWorker' in navigator
	&& Notification.permission === 'granted';

const showAttachmentContinuationReminder = async (kind: AttachmentReminderKind, count: number): Promise<void> => {
	if (!canUseLocalNotifications() || count <= 0)
		return;

	const now = Date.now();
	if (now - lastReminderAt[kind] < ATTACHMENT_REMINDER_THROTTLE_MS)
		return;

	lastReminderAt[kind] = now;
	const registration = await navigator.serviceWorker.ready;
	registration.active?.postMessage({
		type: 'show_attachment_reminder',
		reminderType: kind,
		title: getAttachmentContinuationReminderTitle(kind),
		body: getAttachmentContinuationReminderMessage(kind, count),
		url: navigation.Chat,
		tag: `attachment-reminder-${kind}`
	});
};

const clearAttachmentReminderNotifications = async (): Promise<void> => {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator))
		return;

	const registration = await navigator.serviceWorker.ready;
	registration.active?.postMessage({
		type: 'clear_notifications',
		notificationType: 'local_attachment'
	});
};

export { clearAttachmentReminderNotifications, showAttachmentContinuationReminder };
export type { AttachmentReminderKind };
