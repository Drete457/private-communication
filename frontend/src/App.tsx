import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';


import {
	countActiveAttachmentDownloads,
	countActiveAttachmentUploadTransfers
} from '@/helpers/attachments';
import { clearAttachmentReminderNotifications, showAttachmentContinuationReminder } from '@/services/attachment-notification-service';
import { loadAttachmentPolicy } from '@/services/attachment-policy';
import { markAttachmentTransfersOffline, resumeQueuedAttachmentTransfers } from '@/services/attachment-upload-service';
import { clientLogger } from '@/services/logger';
import { ensurePushSubscription } from '@/services/push-service';
import { webSocketService } from '@/services/web-socket-service';
import { useAttachmentDownloadStore } from '@/store/attachment-download-store';
import { useAttachmentTransferStore } from '@/store/attachment-transfer-store';
import { useAuthStore } from '@/store/auth-store';

import { FirstLoader } from '@components/common/loaders';
import { Layout } from '@components/layout';

import { navigation } from './helpers/navigation';
import { RenderIf } from './helpers/render-conditional';

import type { FC} from 'react';

const CallView = lazy(() => import('@/views/call').then((module) => ({ default: module.CallView })));
const ChatView = lazy(() => import('@/views/chat').then((module) => ({ default: module.ChatView })));
const LibraryView = lazy(() => import('@/views/library').then((module) => ({ default: module.LibraryView })));
const SettingsView = lazy(() => import('@/views/settings').then((module) => ({ default: module.SettingsView })));
const SetupView = lazy(() => import('@/views/setup').then((module) => ({ default: module.SetupView })));

const App: FC = () => {
	const { fullLoaded, isInitialized, initialize, userId, connect } = useAuthStore();
	const clearAllDownloads = useAttachmentDownloadStore((state) => state.clearAllDownloads);

	const showAttachmentContinuationReminders = () => {
		const uploadCount = countActiveAttachmentUploadTransfers(useAttachmentTransferStore.getState().transfers);
		const downloadCount = countActiveAttachmentDownloads(useAttachmentDownloadStore.getState().downloads);

		if (uploadCount > 0)
			void showAttachmentContinuationReminder('upload', uploadCount);

		if (downloadCount > 0)
			void showAttachmentContinuationReminder('download', downloadCount);
	};

	const clearVisibleNotifications = () => {
		if (!('serviceWorker' in navigator)) return;
		if (document.visibilityState !== 'visible') return;
		if (!document.hasFocus()) return;

		navigator.serviceWorker.ready
			.then((registration) => {
				registration.active?.postMessage({
					type: 'clear_notifications',
					notificationType: 'message'
				});
				void clearAttachmentReminderNotifications();
			})
			.catch((error: unknown) => {
				clientLogger.debug('Failed to clear message notifications through service worker:', error);
			});
	};

	useEffect(() => {
		void initialize();
	}, [initialize]);

	useEffect(() => {
		if (!userId) return;
		void ensurePushSubscription(userId);
		void loadAttachmentPolicy();
		void resumeQueuedAttachmentTransfers();
	}, [userId]);

	useEffect(() => {
		const ensureSocketAndSync = async () => {
			if (!userId) return;
			if (!webSocketService.isConnected()) 
				await webSocketService.resume();
			
			webSocketService.send('get_receipts', {});
		};

		const handleVisibility = () => {
			if (document.visibilityState === 'visible') {
				void ensureSocketAndSync();
				return;
			}

			showAttachmentContinuationReminders();
			webSocketService.suspend();
		};

		const handleOnline = () => 
			void (async () => {
				await ensureSocketAndSync();
				await resumeQueuedAttachmentTransfers();
			})();

		const handleOffline = () => {
			void markAttachmentTransfersOffline();
			webSocketService.suspend();
		};

		const handlePageHide = () => {
			showAttachmentContinuationReminders();
			webSocketService.suspend();
		};

		const handleFocus = () => 
			clearVisibleNotifications();

		document.addEventListener('visibilitychange', handleVisibility);
		window.addEventListener('pagehide', handlePageHide);
		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);
		window.addEventListener('focus', handleFocus);

		if (document.visibilityState === 'visible' && document.hasFocus()) 
			clearVisibleNotifications();

		return () => {
			clearAllDownloads();
			document.removeEventListener('visibilitychange', handleVisibility);
			window.removeEventListener('pagehide', handlePageHide);
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('focus', handleFocus);
		};
	}, [clearAllDownloads, connect, userId]);

	return (
		<RenderIf condition={fullLoaded}
			then={
				<RenderIf condition={isInitialized}
					then={
						<BrowserRouter>
							<Layout>
								<Routes>
									<Route path="/" element={<Navigate to={navigation.Chat} replace />} />
									<Route path={`${navigation.Chat}/:peerId?`} element={<ChatView />} />
									<Route path={`${navigation.Call}/:peerId`} element={<CallView />} />
									<Route path={navigation.Library} element={<LibraryView />} />
									<Route path={navigation.Settings} element={<SettingsView />} />
									<Route path="*" element={<Navigate to={navigation.Chat} replace />} />
								</Routes>
							</Layout>
						</BrowserRouter>}
					otherwise={
						<Suspense fallback={<FirstLoader />}>
							<SetupView />
						</Suspense>
					}
				/>
			}
			otherwise={<FirstLoader />}
		/>

	);
}

export default App;
