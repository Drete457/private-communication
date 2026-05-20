import { useCallback, useEffect, useMemo, useState } from 'react';

import { Close } from '@/assets';
import { isIosDevice, isMobileDevice } from '@/helpers/navigation';
import { RenderIf } from '@/helpers/render-conditional';

import { SmallGenericButton } from '../buttons/generic';

import type { FC} from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_DISMISS_KEY = 'pwa-install-dismissed';
const INSTALL_SHOW_EVENT = 'pwa-install:show';
const INSTALL_AVAILABLE_EVENT = 'pwa-install:available';
const INSTALL_AVAILABLE_FLAG = '__pwaInstallAvailable';

const isStandaloneMode = () =>
	window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isInstallDismissed = (): boolean => localStorage.getItem(INSTALL_DISMISS_KEY) === '1';

const shouldShowIosInstallHint = (): boolean => !isStandaloneMode() && isMobileDevice() && isIosDevice();

const InstallPrompt: FC = () => {
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [isVisible, setIsVisible] = useState<boolean>(() => shouldShowIosInstallHint() && !isInstallDismissed());
	const [isDismissed, setIsDismissed] = useState<boolean>(() => isInstallDismissed());

	const canShow = useMemo(() => !isStandaloneMode(), []);
	const showIosHint = useMemo(() => canShow && isMobileDevice() && isIosDevice(), [canShow]);

	const handleInstall = useCallback(async () => {
		if (!deferredPrompt) return;

		await deferredPrompt.prompt();
		await deferredPrompt.userChoice;

		(window as Window & { [INSTALL_AVAILABLE_FLAG]?: boolean })[INSTALL_AVAILABLE_FLAG] = false;
		window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT, { detail: { available: false } }));
		setIsVisible(false);
		setDeferredPrompt(null);
	}, [deferredPrompt]);

	const handleClose = useCallback(() => {
		setIsVisible(false);
		localStorage.setItem(INSTALL_DISMISS_KEY, '1');
		setIsDismissed(true);
		(window as Window & { [INSTALL_AVAILABLE_FLAG]?: boolean })[INSTALL_AVAILABLE_FLAG] = false;
		window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT, { detail: { available: false } }));
	}, []);

	useEffect(() => {
		if (!canShow || !isMobileDevice()) return;

		const handleBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			setDeferredPrompt(event as BeforeInstallPromptEvent);

			(window as Window & { [INSTALL_AVAILABLE_FLAG]?: boolean })[INSTALL_AVAILABLE_FLAG] = true;
			window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT, { detail: { available: true } }));

			if (!isDismissed) setIsVisible(true);
		};

		const handleAppInstalled = () => {
			setDeferredPrompt(null);
			setIsVisible(false);
			localStorage.setItem(INSTALL_DISMISS_KEY, '1');
			setIsDismissed(true);

			(window as Window & { [INSTALL_AVAILABLE_FLAG]?: boolean })[INSTALL_AVAILABLE_FLAG] = false;
			window.dispatchEvent(new CustomEvent(INSTALL_AVAILABLE_EVENT, { detail: { available: false } }));
		};

		const handleShowRequest = () => {
			localStorage.removeItem(INSTALL_DISMISS_KEY);
			setIsDismissed(false);

			if (showIosHint) {
				setIsVisible(true);
				return;
			}

			if (deferredPrompt) {
				setIsVisible(true);
			}
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);
		window.addEventListener(INSTALL_SHOW_EVENT, handleShowRequest);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
			window.removeEventListener(INSTALL_SHOW_EVENT, handleShowRequest);
		};
	}, [canShow, deferredPrompt, isDismissed, showIosHint]);

	return (
		<RenderIf condition={isVisible ? (showIosHint || deferredPrompt !== null) : false}
			then={
				<div className="app-install-prompt app-panel fixed left-1/2 z-50 w-[calc(100%-1rem)] max-w-md -translate-x-1/2 p-4 text-sm text-gray-200 sm:w-[92%]">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-2">
							<p className="app-display-title text-base font-semibold text-white">Install app</p>
							<RenderIf condition={showIosHint}
								then={
									<p className="app-text-muted">
                    On iOS, tap <span className="font-semibold text-white">Share</span> and then <span className="font-semibold text-white">Add to Home Screen</span>.
									</p>
								}
								otherwise={<p className="app-text-muted">Install this PWA to use it like a mobile app.</p>}
							/>
						</div>
						<SmallGenericButton
							onClick={handleClose}

							aria-label="Close"
						>
							<Close className="h-4 w-4" />
						</SmallGenericButton>
					</div>
					<RenderIf condition={!showIosHint}
						then={
							<div className="mt-3 flex justify-stretch sm:justify-end">
								<SmallGenericButton
									onClick={() => void handleInstall()}
									className="w-full sm:w-auto"
								>
                  Install
								</SmallGenericButton>
							</div>
						}
						otherwise={null}
					/>
				</div >
			}
			otherwise={null}
		/>
	);
};

export default InstallPrompt;
