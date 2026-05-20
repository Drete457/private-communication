import { useEffect, useMemo, useState } from 'react';

import { FavoriteStar } from '@/assets';
import { RemoteMediaPreview } from '@/components/common/media';
import { formatFileSize } from '@/helpers/media';
import { RenderIf } from '@/helpers/render-conditional';
import { getFavoriteRemoteGifs, setRemoteMediaFavorite } from '@/services/remote-media-cache';
import type { RemoteMediaRecord } from '@/types';

import { SmallGenericButton } from '../buttons/generic';
import { SegmentedTabs } from '../select';

import OverlayShell from './overlay-shell';

import type { FC, MouseEvent} from 'react';

type RecentGifsTab = 'recent' | 'favorites';

const GIF_TAB_OPTIONS = [
	{ value: 'recent', label: 'Recent' },
	{ value: 'favorites', label: 'Favorites' },
] as const satisfies ReadonlyArray<{ value: RecentGifsTab; label: string; }>;

interface RecentGifsModalProps {
	active: boolean;
	setActive: (open: boolean) => void;
	gifs: ReadonlyArray<RemoteMediaRecord>;
	onSelectGif: (gif: RemoteMediaRecord) => void;
}

const RecentGifsModal: FC<RecentGifsModalProps> = ({ active, setActive, gifs, onSelectGif }) => {
	const [activeTab, setActiveTab] = useState<RecentGifsTab>('recent');
	const [favoriteGifs, setFavoriteGifs] = useState<RemoteMediaRecord[]>([]);
	const [favoriteUrls, setFavoriteUrls] = useState<Set<string>>(new Set());
	const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());

	const sortedGifs = useMemo(() => [...gifs].slice(0, 40), [gifs]);

	const modalDescription = () => {
		switch (activeTab) {
			case 'favorites':
				return 'Manage the GIFs you saved as favorites in this browser.';
			case 'recent':
				return 'Use one of the last 40 GIFs cached in this browser.';
			default:
				return '';
		}
	}

	const visibleGifs = () => {
		if (activeTab === 'favorites') 
			return favoriteGifs;

		return sortedGifs;
	}

	const handleFavoriteToggle = async (event: MouseEvent<HTMLButtonElement | HTMLDivElement>, gif: RemoteMediaRecord, nextFavoriteState: boolean) => {
		event.stopPropagation();

		setPendingFavorites((current) => new Set(current).add(gif.url));

		try {
			const updated = await setRemoteMediaFavorite(gif.url, nextFavoriteState);
			if (!updated)
				return;

			setFavoriteUrls((current) => {
				const next = new Set(current);
				if (nextFavoriteState)
					next.add(updated.url);
				else
					next.delete(updated.url);
				return next;
			});

			setFavoriteGifs((current) => {
				if (!nextFavoriteState)
					return current.filter((favoriteGif) => favoriteGif.url !== updated.url);

				const existingIndex = current.findIndex((favoriteGif) => favoriteGif.url === updated.url);
				if (existingIndex === -1)
					return [updated, ...current].sort((left, right) => right.updatedAt - left.updatedAt);

				const next = [...current];
				next[existingIndex] = updated;
				return next.sort((left, right) => right.updatedAt - left.updatedAt);
			});
		} finally {
			setPendingFavorites((current) => {
				const next = new Set(current);
				next.delete(gif.url);
				return next;
			});
		}
	};

	useEffect(() => {
		if (!active)
			return;

		void (async () => {
			const favorites = await getFavoriteRemoteGifs();
			setFavoriteGifs(favorites);
			setFavoriteUrls(new Set(favorites.map((gif) => gif.url)));
		})();
	}, [active]);

	return (
		<RenderIf
			condition={active}
			then={
				<OverlayShell active={active} onClose={() => setActive(false)} mode="sheet" surfaceClassName="w-full max-w-4xl p-4 sm:p-6">
					<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h3 className="text-xl font-semibold text-white">GIF Library</h3>
							<p className="text-sm text-gray-400">{modalDescription()}</p>
						</div>
						<div className="flex items-center gap-2 self-end sm:self-start">
							<SegmentedTabs value={activeTab} onChange={setActiveTab} options={GIF_TAB_OPTIONS} />
							<SmallGenericButton onClick={() => setActive(false)}>Close</SmallGenericButton>
						</div>
					</div>
					<div className="app-panel-muted mb-4 px-4 py-3 text-sm text-white/70">
						{activeTab === 'favorites'
							? `${visibleGifs().length} favorites saved in this browser.`
							: `${visibleGifs().length} recently cached GIFs ready to resend.`}
					</div>

					<RenderIf
						condition={visibleGifs().length > 0}
						then={
							<div className="max-h-[min(68dvh,42rem)] overflow-y-auto pr-1">
								<div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
									{visibleGifs().map((gif) => {
										const isFavorite = favoriteUrls.has(gif.url);
										const isPendingFavorite = pendingFavorites.has(gif.url);

										return (
											<div
												key={gif.url}
												className="overflow-hidden rounded-2xl border border-white/10 bg-dark-100 text-left transition-colors hover:border-primary-400/50 hover:bg-dark-300"
											>
												<button
													type="button"
													onClick={() => onSelectGif(gif)}
													className="block w-full text-left"
												>
													<div className="aspect-4/3 overflow-hidden bg-black/20">
														<RemoteMediaPreview
															url={gif.url}
															alt={gif.url}
															initialRecord={gif}
															peerId={gif.peerId}
															messageId={gif.messageId}
															className="h-full w-full object-cover"
															loadingClassName="flex h-full items-center justify-center text-xs text-white/60"
															loadingText="Loading..."
															recoveringText="Reloading..."
															failedText="Preview unavailable"
															imgProps={{ loading: 'lazy' }}
														/>
													</div>
												</button>
												<div
													onClickCapture={(event) => void handleFavoriteToggle(event, gif, !isFavorite)}
													className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-2">
													<section className="min-w-0 flex-1">
														<p className="truncate text-[0.9rem] text-white">{gif.sourceHost}</p>
														<p className="text-[0.75rem] text-gray-400">{formatFileSize(gif.blob.size)}</p>
													</section>
													<button
														type="button"
														onClick={(event) => void handleFavoriteToggle(event, gif, !isFavorite)}
														disabled={isPendingFavorite}
														title={activeTab === 'favorites' ? 'Remove from favorites' : isFavorite ? 'Remove from favorites' : 'Add to favorites'}
														className={`inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors ${isFavorite ? 'text-amber-300 hover:bg-amber-300/10 hover:text-amber-200' : 'text-white/45 hover:bg-white/8 hover:text-white/80'} disabled:opacity-50`}
													>
														<FavoriteStar filled={isFavorite} className="h-4 w-4" />
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						}
						otherwise={<div className="app-panel-muted px-4 py-6 text-center"><p className="text-sm text-gray-300">{activeTab === 'favorites' ? 'No favorite GIFs yet.' : 'No cached GIFs yet.'}</p></div>}
					/>
				</OverlayShell>
			}
			otherwise={null}
		/>
	);
};

export default RecentGifsModal;