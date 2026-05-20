import { useEffect, useRef, useState } from 'react';

import { RemoteMediaPreview } from '@/components/common/media';

import type { FC, ImgHTMLAttributes} from 'react';

type RemoteInlineMediaProps = {
	url: string;
	alt: string;
	peerId?: string;
	messageId?: string;
	onLoad?: () => void;
	imageClassName?: string;
	imgProps?: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className' | 'onLoad' | 'onError'>;
};

const RemoteInlineMedia: FC<RemoteInlineMediaProps> = ({ url, alt, peerId, messageId, onLoad, imageClassName, imgProps }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isVisible, setIsVisible] = useState<boolean>(() => typeof window !== 'undefined' && !('IntersectionObserver' in window));

	useEffect(() => {
		const current = containerRef.current;
		if (!current)
			return;

		if (!('IntersectionObserver' in window))
			return;

		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setIsVisible(true);
				observer.disconnect();
			}
		}, {
			rootMargin: '200px 0px'
		});

		observer.observe(current);
		return () => observer.disconnect();
	}, []);

	return (
		<div ref={containerRef} className="mb-3 overflow-hidden rounded-lg bg-black/20">
			{!isVisible ? (
				<div className="flex h-40 w-full items-center justify-center rounded-lg bg-white/5 text-xs text-white/60">
					Loading image...
				</div>
			) : (
				<RemoteMediaPreview
					url={url}
					alt={alt}
					peerId={peerId}
					messageId={messageId}
					className={`max-h-72 w-full object-cover ${imageClassName ?? ''}`.trim()}
					loadingClassName="flex h-40 w-full items-center justify-center rounded-lg bg-white/5 text-xs text-white/60"
					onLoad={onLoad}
					imgProps={{ loading: 'lazy', ...imgProps }}
				/>
			)}
		</div>
	);
};

export default RemoteInlineMedia;