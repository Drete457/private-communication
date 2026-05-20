import { useEffect, useState } from 'react';

import { SmallGenericButton } from '@/components/common/buttons/generic';
import { OverlayShell } from '@/components/common/modal';
import type { OverlayMode } from '@/components/common/modal/overlay-shell';
import { RenderIf } from '@/helpers/render-conditional';

import type { FC} from 'react';

type MediaPreviewKind = 'gif' | 'image' | 'video' | 'audio';

interface MediaPreviewOverlayProps {
	active: boolean;
	title: string;
	kind: MediaPreviewKind;
	url: string;
	details?: string | undefined;
	onClose: () => void;
}

const getViewportMediaQuery = (): MediaQueryList | null => {
	const matchMedia = (globalThis as Partial<Pick<Window, 'matchMedia'>>).matchMedia;

	if (!matchMedia)
		return null;

	return matchMedia.call(globalThis, '(max-width: 639px)');
};

const getPreviewDetails = (details: string | undefined): string => (
	details?.length ? details : 'Preview local content'
);

const MediaPreviewOverlay: FC<MediaPreviewOverlayProps> = ({
	active,
	title,
	kind,
	url,
	details,
	onClose
}) => {
	const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false);

	const getOverlayMode = (): OverlayMode => {
		if (isMobileViewport)
			return 'fullscreen';

		return 'dialog';
	};

	const getSurfaceClassName = () => {
		if (isMobileViewport)
			return 'flex h-full max-w-none flex-col p-3';

		if (kind === 'video' || kind === 'audio')
			return 'h-auto max-w-4xl p-4 sm:p-6';

		return 'h-auto !max-w-6xl p-3 sm:p-4';
	};

	const getMediaFrameClassName = () => {
		if (isMobileViewport)
			return kind === 'audio'
				? 'flex min-h-0 flex-1 items-center justify-center rounded-xl bg-dark-100 p-3'
				: 'flex min-h-0 flex-1 items-center justify-center rounded-xl bg-dark-100 p-2';

		if (kind === 'video')
			return 'flex items-center justify-center rounded-xl bg-dark-100 p-2';

		return 'flex items-center justify-center rounded-xl bg-dark-100 p-2';
	};

	const getMediaClassName = () => {
		if (isMobileViewport)
			return 'h-full max-h-full w-full rounded-lg object-contain';

		if (kind === 'video')
			return 'max-h-[70vh] w-full rounded-lg';

		return 'max-h-[82vh] w-auto max-w-full rounded-lg object-contain';
	};

	useEffect(() => {
		if (!active)
			return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape')
				onClose();
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [active, onClose]);

	useEffect(() => {
		const mediaQuery = getViewportMediaQuery();

		if (!mediaQuery)
			return;

		const updateViewport = () => setIsMobileViewport(mediaQuery.matches);

		updateViewport();
		mediaQuery.addEventListener('change', updateViewport);

		return () => mediaQuery.removeEventListener('change', updateViewport);
	}, []);

	return (
		<RenderIf
			condition={active}
			then={
				<OverlayShell active={active} onClose={onClose} mode={getOverlayMode()} surfaceClassName={getSurfaceClassName()}>
					<div className="mb-4 flex items-start justify-between gap-3">
						<div className="min-w-0">
							<h3 className="app-display-title truncate text-lg font-semibold text-white">{title}</h3>
							<p className="app-text-muted text-sm">{getPreviewDetails(details)}</p>
						</div>
						<SmallGenericButton onClick={onClose} className="shrink-0">
								Close
						</SmallGenericButton>
					</div>
					<div className={getMediaFrameClassName()}>
						<RenderIf
							condition={kind === 'audio'}
							then={<audio controls className="w-full" src={url} />}
							otherwise={
								<RenderIf
									condition={kind === 'video'}
									then={<video controls className={getMediaClassName()} src={url} />}
									otherwise={<img src={url} alt={title} className={getMediaClassName()} />}
								/>
							}
						/>
					</div>
				</OverlayShell>
			}
			otherwise={null}
		/>
	);
};

export default MediaPreviewOverlay;