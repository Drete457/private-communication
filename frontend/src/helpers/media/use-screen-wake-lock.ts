import { useCallback, useEffect, useRef } from 'react';

import { clientLogger } from '@/services/logger';

type WakeLockSentinelLike = {
	released: boolean;
	release: () => Promise<void>;
	addEventListener?: (type: 'release', listener: () => void) => void;
};

type WakeLockLike = {
	request: (type: 'screen') => Promise<WakeLockSentinelLike>;
};

type GlobalWakeLockApis = {
	navigator?: Navigator & {
		wakeLock?: WakeLockLike;
	};
};

type UseScreenWakeLockOptions = {
	isActive: boolean;
};

const getWakeLock = (): WakeLockLike | undefined => (
	(globalThis as GlobalWakeLockApis).navigator?.wakeLock
);

const useScreenWakeLock = ({ isActive }: UseScreenWakeLockOptions): void => {
	const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

	const releaseWakeLock = useCallback(async () => {
		if (!wakeLockRef.current)
			return;

		try {
			if (!wakeLockRef.current.released)
				await wakeLockRef.current.release();
		} catch (error) {
			clientLogger.debug('Failed to release screen wake lock:', error);
		} finally {
			wakeLockRef.current = null;
		}
	}, []);

	const requestWakeLock = useCallback(async () => {
		const wakeLock = getWakeLock();
		if (!wakeLock)
			return;

		if (wakeLockRef.current && !wakeLockRef.current.released)
			return;

		try {
			const sentinel = await wakeLock.request('screen');
			wakeLockRef.current = sentinel;
			sentinel.addEventListener?.('release', () => {
				wakeLockRef.current = null;
			});
		} catch (error) {
			clientLogger.debug('Failed to request screen wake lock:', error);
		}
	}, []);

	useEffect(() => {
		if (isActive) {
			void requestWakeLock();
		} else {
			void releaseWakeLock();
		}
	}, [isActive, releaseWakeLock, requestWakeLock]);

	useEffect(() => {
		const handleVisibility = () => {
			if (document.visibilityState === 'visible' && isActive)
				void requestWakeLock();
		};

		document.addEventListener('visibilitychange', handleVisibility);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibility);
			void releaseWakeLock();
		};
	}, [isActive, releaseWakeLock, requestWakeLock]);
};

export { useScreenWakeLock };