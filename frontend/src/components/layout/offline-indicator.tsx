import { useEffect, useRef, useState } from 'react';

import { RenderIf } from '@/helpers/render-conditional';

import type { FC} from 'react';

const EXIT_ANIMATION_MS = 380;

const OfflineIndicator: FC = () => {
	const [isOffline, setIsOffline] = useState<boolean>(() => typeof navigator !== 'undefined' && !navigator.onLine);
	const [isVisible, setIsVisible] = useState<boolean>(() => typeof navigator !== 'undefined' && !navigator.onLine);
	const [isExiting, setIsExiting] = useState<boolean>(false);
	const exitTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		const clearExitTimeout = () => {
			if (exitTimeoutRef.current !== null) {
				window.clearTimeout(exitTimeoutRef.current);
				exitTimeoutRef.current = null;
			}
		};

		const handleOffline = () => {
			clearExitTimeout();
			setIsOffline(true);
			setIsExiting(false);
			setIsVisible(true);
		};

		const handleOnline = () => {
			setIsOffline(false);
			setIsExiting(true);
			clearExitTimeout();
			exitTimeoutRef.current = window.setTimeout(() => {
				setIsVisible(false);
				setIsExiting(false);
				exitTimeoutRef.current = null;
			}, EXIT_ANIMATION_MS);
		};

		window.addEventListener('offline', handleOffline);
		window.addEventListener('online', handleOnline);

		return () => {
			clearExitTimeout();
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('online', handleOnline);
		};
	}, []);

	return (
		<RenderIf condition={isVisible}
			then={
				<div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 sm:bottom-6">
					<div className={`offline-indicator-shell ${isExiting ? 'offline-indicator-shell-exit' : 'offline-indicator-shell-enter'}`} aria-live="assertive" role="status">
						<div className="offline-indicator-orb">
							<span className="offline-indicator-orb-core" />
							<span className="offline-indicator-orb-ring" />
						</div>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-amber-50">
								{isOffline ? 'No internet connection' : 'Connection restored'}
							</p>
							<p className="mt-1 text-xs text-amber-100/80">
								{isOffline
									? 'Reconnect to keep messages, uploads, and downloads moving.'
									: 'Sync is available again.'}
							</p>
						</div>
					</div>
				</div>
			}
			otherwise={null}
		/>
	);
};

export default OfflineIndicator;