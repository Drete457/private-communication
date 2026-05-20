import { useCallback, useEffect, useRef, useState } from 'react';

import { getOrFetchRemoteMedia, refreshRemoteMedia } from '@/services/remote-media-cache';
import type { RemoteMediaRecord } from '@/types';

import type { FC, ImgHTMLAttributes} from 'react';

type RemoteMediaPreviewStatus = 'loading' | 'ready' | 'failed' | 'recovering';

type RemoteMediaPreviewState = {
	mediaUrl: string | null;
	sourceUrl: string | null;
	status: RemoteMediaPreviewStatus;
};

interface RemoteMediaPreviewProps {
  url: string;
  alt: string;
	initialRecord?: RemoteMediaRecord | undefined;
	peerId?: string | undefined;
	messageId?: string | undefined;
	className?: string | undefined;
	loadingClassName?: string | undefined;
	loadingText?: string | undefined;
	failedText?: string | undefined;
	recoveringText?: string | undefined;
	onLoad?: (() => void) | undefined;
	imgProps?: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className' | 'onLoad' | 'onError'> | undefined;
}

const RemoteMediaPreview: FC<RemoteMediaPreviewProps> = ({
	url,
	alt,
	initialRecord,
	peerId,
	messageId,
	className,
	loadingClassName,
	loadingText = 'Loading image...',
	failedText = 'Unable to load image preview',
	recoveringText = 'Reloading...',
	onLoad,
	imgProps
}) => {
	const objectUrlRef = useRef<string | null>(null);
	const loadRequestIdRef = useRef<number>(0);
	const [previewState, setPreviewState] = useState<RemoteMediaPreviewState>({
		mediaUrl: null,
		sourceUrl: null,
		status: 'loading'
	});
	const isCurrentMedia = previewState.sourceUrl === url;
	const mediaUrl = isCurrentMedia ? previewState.mediaUrl : null;
	const status = isCurrentMedia ? previewState.status : 'loading';

	const applyRecord = useCallback((record: RemoteMediaRecord) => {
		if (objectUrlRef.current)
			URL.revokeObjectURL(objectUrlRef.current);

		const nextMediaUrl = URL.createObjectURL(record.blob);
		objectUrlRef.current = nextMediaUrl;
		setPreviewState({
			mediaUrl: nextMediaUrl,
			sourceUrl: record.url,
			status: 'ready'
		});
	}, []);

	const handleError = () => {
		if (status === 'recovering')
			return;

		setPreviewState((current) => ({
			...current,
			sourceUrl: url,
			status: 'recovering'
		}));

		void (async () => {
			try {
				const refreshedRecord = await refreshRemoteMedia(url, { peerId, messageId });
				applyRecord(refreshedRecord);
			} catch {
				setPreviewState((current) => ({
					...current,
					sourceUrl: url,
					status: 'failed'
				}));
			}
		})();
	};

	const getStatusText = () => {
		if (status === 'recovering')
			return recoveringText;

		if (status === 'failed')
			return failedText;

		return loadingText;
	};

	useEffect(() => {
		loadRequestIdRef.current += 1;
		const loadRequestId = loadRequestIdRef.current;

		void (async () => {
			try {
				const record = initialRecord?.url === url
					? initialRecord
					: await getOrFetchRemoteMedia(url, { peerId, messageId });

				if (loadRequestIdRef.current !== loadRequestId)
					return;

				applyRecord(record);
			} catch {
				if (loadRequestIdRef.current === loadRequestId)
					setPreviewState((current) => ({
						...current,
						sourceUrl: url,
						status: 'failed'
					}));
			}
		})();

		return () => {
			loadRequestIdRef.current += 1;
		};
	}, [applyRecord, initialRecord, messageId, peerId, url]);

	useEffect(() => () => {
		if (objectUrlRef.current)
			URL.revokeObjectURL(objectUrlRef.current);
	}, []);

	return status === 'ready' && mediaUrl !== null ? (
		<img
			src={mediaUrl}
			alt={alt}
			className={className}
			onLoad={onLoad}
			onError={handleError}
			{...imgProps}
		/>
	) : (
		<div className={loadingClassName}>
			{getStatusText()}
		</div>
	);
};

export default RemoteMediaPreview;