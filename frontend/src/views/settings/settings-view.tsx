import { useEffect, useRef, useState } from 'react';


import { BackupSettings } from '@/components/backup';
import { GenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { RedButton } from '@/components/common/buttons/red';
import { ErrorMessage } from '@/components/common/messages/error';
import { StatusMessage } from '@/components/common/messages/status';
import { Modal } from '@/components/common/modal';
import { TextArea } from '@/components/common/text/text-area';
import { firstLetterUppercase } from '@/helpers/messages';
import { RenderIf } from '@/helpers/render-conditional';
import { clientLogger } from '@/services/logger';
import { useAuthStore } from '@/store/auth-store';
import type { Notification as NotificationProps, PushDiagnostics, WPAState } from '@/types';

import { Notification } from '@components/common/notifications';

import type { FC } from 'react';

const isInstallAvailableEventDetail = (value: unknown): value is { available: boolean } => (
	typeof value === 'object'
	&& value !== null
	&& !Array.isArray(value)
	&& typeof (value as { available?: unknown }).available === 'boolean'
);

const buildContactPayload = (
	userId: string | null,
	publicKey: string | null,
	signingPublicKey: string | null,
	fingerprint: string | null
): string => {
	if (!userId || !publicKey || !signingPublicKey || !fingerprint)
		return '';

	return JSON.stringify({
		version: 1,
		userId,
		encryptionPublicKey: publicKey,
		signingPublicKey,
		fingerprint
	});
};

const SettingsView: FC = () => {
	const { userId, publicKey, signingPublicKey, fingerprint, deleteIdentity } = useAuthStore();
	const [isDeleting, setIsDeleting] = useState<boolean>(false);
	const [copyMessage, setCopyMessage] = useState<NotificationProps | null>(null);
	const copyTimerRef = useRef<number | null>(null);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [qrError, setQrError] = useState<string | null>(null);
	const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
	const [deleteCountdown, setDeleteCountdown] = useState<number>(5);
	const [countdownInterval, setCountdownInterval] = useState<NodeJS.Timeout | null>(null);
	const [installPromptStatus, setInstallPromptStatus] = useState<string | null>(null);
	const [installDiagnostics, setInstallDiagnostics] = useState<WPAState>({
		manifestLoaded: false,
		serviceWorkerActive: false,
		installAvailable: false,
		standaloneMode: false
	});
	const [pushWarning, setPushWarning] = useState<string | null>(null);
	const [pushDiagnostics, setPushDiagnostics] = useState<PushDiagnostics>({
		supported: false,
		permission: 'unsupported',
		invalidEndpoint: false
	});
	const contactPayload = buildContactPayload(userId, publicKey, signingPublicKey, fingerprint);

	const copyToClipboard = async (text: string, label: string) => {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
			setCopyMessage({ message: `${label} copied`, type: 'success' });
		} catch (_err) {
			if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
			setCopyMessage({ message: 'Copy failed', type: 'error' });
		}
	};

	const startDeleteCountdown = () => {
		const interval = setInterval(() => {
			setDeleteCountdown((prev) => {
				if (prev <= 1)
					clearInterval(interval);

				return prev - 1;
			});
		}, 1000);
		setCountdownInterval(interval);
	};

	const handleShowDeleteModal = () => {
		setShowDeleteModal(true);
		startDeleteCountdown();
	}

	const handleCancelDelete = () => {
		setShowDeleteModal(false);
		setDeleteCountdown(5);

		if (countdownInterval)
			clearInterval(countdownInterval);
	}

	const handleDeleteData = async () => {
		if (deleteCountdown === 0) {
			setIsDeleting(true);
			await deleteIdentity();
			setIsDeleting(false);
		}
	}

	const handleShowInstallPrompt = () => {
		localStorage.removeItem('pwa-install-dismissed');
		window.dispatchEvent(new Event('pwa-install:show'));
		setInstallPromptStatus('Install prompt enabled');
	}

	useEffect(() => {
		let active = true;

		const buildQr = async () => {
			if (!contactPayload) {
				setQrDataUrl(null);
				setQrError(null);
				return;
			}
			try {
				const { default: QRCode } = await import('qrcode');
				const dataUrl = await QRCode.toDataURL(contactPayload, {
					errorCorrectionLevel: 'M',
					scale: 4,
					margin: 1
				});

				if (!active) return;

				setQrDataUrl(dataUrl);
				setQrError(null);
			} catch (err) {
				clientLogger.error('QR generation failed:', err);
				if (!active) return;
				setQrError('Could not generate QR code');
				setQrDataUrl(null);
			}
		};

		void buildQr();

		return () => {
			active = false;
		};
	}, [contactPayload]);

	useEffect(() => {
		let mounted = true;

		const checkInstallState = async () => {
			const manifestLoaded = Boolean(document.querySelector('link[rel="manifest"]'));
			const standaloneMode = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

			let serviceWorkerActive = false;
			if ('serviceWorker' in navigator) {
				try {
					const registration = await navigator.serviceWorker.getRegistration();
					serviceWorkerActive = Boolean(registration);
				} catch {
					serviceWorkerActive = false;
				}
			}

			if (!mounted) return;

			const installAvailable = Boolean((window as Window & { __pwaInstallAvailable?: boolean }).__pwaInstallAvailable);
			setInstallDiagnostics({
				manifestLoaded,
				serviceWorkerActive,
				installAvailable,
				standaloneMode
			});
		};

		const handleInstallAvailable = (event: Event) => {
			const detail = (event as CustomEvent<unknown>).detail;
			setInstallDiagnostics((prev) => ({
				...prev,
				installAvailable: isInstallAvailableEventDetail(detail) ? detail.available : false
			}));
		};

		void checkInstallState();
		window.addEventListener('pwa-install:available', handleInstallAvailable);

		return () => {
			mounted = false;
			window.removeEventListener('pwa-install:available', handleInstallAvailable);
		};
	}, []);

	// Check push notification support and permission state on mount
	useEffect(() => {
		let mounted = true;
		const checkPushState = async () => {
			const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
			let permission: NotificationPermission | 'unsupported' = 'unsupported';
			let invalidEndpoint = false;

			if (supported) {
				permission = window.Notification.permission;
				try {
					const registration = await navigator.serviceWorker.getRegistration();
					const subscription = await registration?.pushManager.getSubscription();
					invalidEndpoint = subscription?.endpoint.includes('permanently-removed.invalid') ?? false;
				} catch {
					invalidEndpoint = false;
				}
			}

			if (!mounted) return;
			setPushDiagnostics({ supported, permission, invalidEndpoint });

			if (!supported) {
				setPushWarning("Push notifications are not supported in this browser.");
			} else if (invalidEndpoint) {
				setPushWarning("Push subscription is invalid. For the best experience, please use a compatible browser like Chrome on Android/iOS and ensure notifications are enabled.");
			} else if (permission === 'denied') {
				setPushWarning("Push permission is blocked. Enable notifications in browser settings.");
			} else {
				setPushWarning(null);
			}
		};

		void checkPushState();
		return () => {
			mounted = false;
		};
	}, []);

	return (
		<div className="app-shell h-full overflow-y-auto px-3 py-4 sm:p-6">
			<Notification message={copyMessage?.message ?? ''} type={copyMessage?.type ?? 'undefined'} />

			<section className="mb-6 sm:mb-8">
				<div className="app-panel overflow-hidden p-0">
					<div className="bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),linear-gradient(180deg,rgba(10,17,31,0.98),rgba(6,10,20,0.94))] px-4 py-5 sm:px-6 sm:py-6">
						<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Settings</p>
						<div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
							<div className="max-w-2xl">
								<h1 className="app-display-title text-2xl font-bold text-white sm:text-3xl">Your identity, backups and device state</h1>
								<p className="mt-2 text-sm text-white/70 sm:text-base">
									Keep verification details easy to share, make backups before changing devices, and confirm the PWA is ready to behave like an installed secure app.
								</p>
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
								<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
									<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Identity</p>
									<p className="mt-2 text-sm font-semibold text-white">{userId ? 'Active on this device' : 'Not available'}</p>
								</div>
								<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
									<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Backup</p>
									<p className="mt-2 text-sm font-semibold text-white">Recommended now</p>
								</div>
								<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
									<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">PWA</p>
									<p className="mt-2 text-sm font-semibold text-white">{installDiagnostics.serviceWorkerActive ? 'Service worker ready' : 'Needs attention'}</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="mb-6 sm:mb-8">
				<div className="app-panel space-y-6 p-4 sm:p-6">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Identity</p>
							<h2 className="app-display-title mt-2 text-lg font-semibold text-white">Share the right trust signals</h2>
							<p className="app-text-muted mt-2 text-sm">Your user ID, fingerprint and contact payload are the pieces another person needs to verify and add you safely.</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 lg:max-w-sm">
							Share the fingerprint out-of-band whenever you need stronger identity verification.
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)]">
						<div className="space-y-4">
							<div className="app-panel-muted space-y-4 p-4 sm:p-5">
								<div>
									<p className="app-text-muted mb-1 block text-sm">User ID</p>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
										<code className="app-code-block flex-1 px-3 py-2 text-sm font-mono text-gray-300 truncate">{userId}</code>
										<SmallGenericButton onClick={() => void copyToClipboard(userId ?? '', 'User ID')} className="w-full sm:w-auto">Copy</SmallGenericButton>
									</div>
								</div>

								<div>
									<p className="app-text-muted mb-1 block text-sm">
										Public Key Fingerprint
										<span className="ml-2 text-xs text-primary-400">Share this to verify your identity</span>
									</p>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
										<code className="app-code-block flex-1 break-all px-3 py-2 text-xs font-mono text-gray-300">{fingerprint}</code>
										<SmallGenericButton onClick={() => void copyToClipboard(fingerprint ?? '', 'Fingerprint')} className="w-full sm:w-auto">Copy</SmallGenericButton>
									</div>
								</div>
							</div>

							<div className="app-panel-muted space-y-3 p-4 sm:p-5">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<label className="app-text-muted block text-sm" htmlFor="contact-payload">Contact Payload (JSON)</label>
										<p className="mt-1 text-xs text-white/55">Share this payload directly when someone needs to import your contact details.</p>
									</div>
									<SmallGenericButton onClick={() => void copyToClipboard(contactPayload, 'Contact payload')} disabled={!contactPayload} className="w-full sm:w-auto">Copy payload</SmallGenericButton>
								</div>
								<TextArea
									id="contact-payload"
									value={contactPayload}
									className='app-code-block h-56 w-full resize-none p-3 text-sm text-white outline-none focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20'
									readOnly
								/>
							</div>
						</div>

						<div className="app-panel-muted flex flex-col items-center justify-center gap-4 p-5 text-center">
							<div className="rounded-[1.4rem] border border-white/10 bg-white p-4 shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
								<RenderIf condition={qrDataUrl !== null}
									then={
										<img src={qrDataUrl ?? ''} alt="Public key QR" className="h-auto w-44 sm:w-52" />
									}
									otherwise={
										<RenderIf condition={qrError !== null}
											then={<span className="text-sm text-red-600">{qrError}</span>}
											otherwise={<span className="text-sm text-slate-700">Generating...</span>}
										/>
									}
								/>
							</div>
							<div>
								<p className="text-sm font-semibold text-white">Scan to share your contact</p>
								<p className="mt-1 text-sm text-white/60">Useful for fast in-person setup without copying the raw payload.</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<BackupSettings />

			<section className="mb-6 sm:mb-8">
				<div className="app-panel space-y-6 p-4 sm:p-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">App state</p>
							<h2 className="app-display-title mt-2 text-lg font-semibold text-white">Check install readiness and browser support</h2>
							<p className="app-text-muted mt-2 text-sm">Re-enable the install prompt if you dismissed it or uninstalled the app, and confirm the local browser capabilities still match the secure app experience.</p>
						</div>
						<section className="w-full lg:w-56">
							<GenericButton onClick={handleShowInstallPrompt}
								disabled={!installDiagnostics.manifestLoaded || !installDiagnostics.serviceWorkerActive || installDiagnostics.installAvailable || installDiagnostics.standaloneMode}
							>
								Show install prompt
							</GenericButton>
						</section>
					</div>

					<div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
						<div className="app-panel-muted p-4">
							<div className="app-text-muted text-xs uppercase tracking-wide">Manifest</div>
							<div className="mt-3 flex items-center justify-between gap-3">
								<span className="text-sm text-gray-200">Loaded</span>
								<span className={`rounded-full px-2 py-0.5 text-xs ${installDiagnostics.manifestLoaded ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{installDiagnostics.manifestLoaded ? 'OK' : 'Missing'}</span>
							</div>
						</div>
						<div className="app-panel-muted p-4">
							<div className="app-text-muted text-xs uppercase tracking-wide">Service worker</div>
							<div className="mt-3 flex items-center justify-between gap-3">
								<span className="text-sm text-gray-200">Active</span>
								<span className={`rounded-full px-2 py-0.5 text-xs ${installDiagnostics.serviceWorkerActive ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{installDiagnostics.serviceWorkerActive ? 'OK' : 'Inactive'}</span>
							</div>
						</div>
						<div className="app-panel-muted p-4">
							<div className="app-text-muted text-xs uppercase tracking-wide">Install prompt</div>
							<div className="mt-3 flex items-center justify-between gap-3">
								<span className="text-sm text-gray-200">Available</span>
								<span className={`rounded-full px-2 py-0.5 text-xs ${installDiagnostics.installAvailable ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{installDiagnostics.installAvailable ? 'Yes' : 'No'}</span>
							</div>
						</div>
						<div className="app-panel-muted p-4">
							<div className="app-text-muted text-xs uppercase tracking-wide">Display mode</div>
							<div className="mt-3 flex items-center justify-between gap-3">
								<span className="text-sm text-gray-200">Standalone</span>
								<span className={`rounded-full px-2 py-0.5 text-xs ${installDiagnostics.standaloneMode ? 'bg-green-500/15 text-green-300' : 'bg-gray-500/15 text-gray-300'}`}>{installDiagnostics.standaloneMode ? 'Active' : 'No'}</span>
							</div>
						</div>
						<div className="app-panel-muted p-4 md:col-span-2 xl:col-span-2">
							<div className="app-text-muted text-xs uppercase tracking-wide">Push notifications</div>
							<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3">
									<span className="text-sm text-gray-200">Supported</span>
									<span className={`rounded-full px-2 py-0.5 text-xs ${pushDiagnostics.supported ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{pushDiagnostics.supported ? 'Yes' : 'No'}</span>
								</div>
								<div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/4 px-3 py-3">
									<span className="text-sm text-gray-200">Permission</span>
									<span className={`rounded-full px-2 py-0.5 text-xs ${pushDiagnostics.permission === 'granted' ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>{firstLetterUppercase(pushDiagnostics.permission)}</span>
								</div>
							</div>
						</div>
					</div>

					<RenderIf condition={pushWarning !== null} then={pushWarning ? <ErrorMessage message={pushWarning} /> : null} otherwise={null} />
					<RenderIf condition={installPromptStatus !== null} then={installPromptStatus ? <StatusMessage message={installPromptStatus} /> : null} otherwise={null} />
				</div>
			</section>

			<section>
				<div className="app-panel border-red-500/30 p-4 sm:p-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
						<div>
							<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-red-200">Danger zone</p>
							<h2 className="app-display-title mt-2 text-lg font-semibold text-white">Delete this local identity</h2>
							<p className="app-text-muted mt-2 text-sm">Deleting your keys will permanently remove your identity. You will not be able to decrypt old messages or recover your account.</p>
						</div>
						<div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-50/85 lg:max-w-sm">
							Only do this if you intentionally want to reset this device.
						</div>
					</div>
					<div className="mt-5">
						<RedButton
							onClick={handleShowDeleteModal}
							disabled={isDeleting}
						>
							Delete All Keys
						</RedButton>
					</div>
				</div>

				<RenderIf condition={showDeleteModal}
					then={<Modal
						active={showDeleteModal}
						setActive={handleCancelDelete}
						title="Are you sure?"
						message="This action is irreversible. Deleting your keys will permanently remove your identity."
						AcceptButton={
							<RedButton
								onClick={() => void handleDeleteData()}
								disabled={deleteCountdown > 0 || isDeleting}
							>
								{deleteCountdown > 0 ? `Delete (${deleteCountdown})` : 'Delete'}
							</RedButton>
						}
					/>}
					otherwise={null}
				/>
			</section>
		</div>
	);
}

export default SettingsView;