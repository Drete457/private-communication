import { useCallback, useEffect, useMemo, useState } from 'react';

type VideoInputDevice = {
	id: string;
	label: string;
};

type OptionalMediaDevices = Pick<MediaDevices, 'enumerateDevices'> & Partial<Pick<MediaDevices, 'addEventListener' | 'removeEventListener'>>;

type GlobalMediaDeviceApis = {
	navigator?: Navigator & {
		mediaDevices?: OptionalMediaDevices;
	};
};

const getMediaDevices = (): OptionalMediaDevices | undefined => (
	(globalThis as GlobalMediaDeviceApis).navigator?.mediaDevices
);

const mapVideoInputDevices = async (): Promise<VideoInputDevice[]> => {
	const mediaDevices = getMediaDevices();
	if (!mediaDevices)
		return [];
	
	const devices = await mediaDevices.enumerateDevices();
	return devices
		.filter((device) => device.kind === 'videoinput')
		.map((device, index) => ({
			id: device.deviceId,
			label: device.label.length > 0 ? device.label : `Camera ${index + 1}`
		}));
};

const useVideoInputDevices = () => {
	const [isLoading, setIsLoading] = useState<boolean>(true);
	const [cameras, setCameras] = useState<VideoInputDevice[]>([]);
	const [selectedCameraId, setSelectedCameraId] = useState<string>('');

	const applyDiscoveredCameras = useCallback((discovered: VideoInputDevice[]) => {
		setCameras(discovered);
		setSelectedCameraId((previousId) => {
			if (previousId && discovered.some((camera) => camera.id === previousId)) {
				return previousId;
			}

			return discovered[0]?.id ?? '';
		});
	}, []);

	const refreshCameras = useCallback(async () => {
		setIsLoading(true);
		try {
			const discovered = await mapVideoInputDevices();
			applyDiscoveredCameras(discovered);
		} catch {
			setCameras([]);
			setSelectedCameraId('');
		} finally {
			setIsLoading(false);
		}
	}, [applyDiscoveredCameras]);

	useEffect(() => {
		let active = true;

		const loadInitialCameras = async () => {
			try {
				const discovered = await mapVideoInputDevices();
				if (!active)
					return;

				applyDiscoveredCameras(discovered);
			} catch {
				if (!active)
					return;

				setCameras([]);
				setSelectedCameraId('');
			} finally {
				if (active)
					setIsLoading(false);
			}
		};

		void loadInitialCameras();

		return () => {
			active = false;
		};
	}, [applyDiscoveredCameras]);

	useEffect(() => {
		const mediaDevices = getMediaDevices();
		if (!mediaDevices?.addEventListener || !mediaDevices.removeEventListener) {
			return;
		}

		const handleDeviceChange = () => {
			void refreshCameras();
		};

		mediaDevices.addEventListener('devicechange', handleDeviceChange);
		return () => {
			mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
		};
	}, [refreshCameras]);

	return useMemo(
		() => ({
			isLoading,
			cameras,
			selectedCameraId,
			setSelectedCameraId,
			refreshCameras
		}),
		[isLoading, cameras, selectedCameraId, refreshCameras]
	);
};

export { useVideoInputDevices };
export type { VideoInputDevice };
