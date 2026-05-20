
import { TrashBin } from '@/assets';
import { SmallGenericButton } from '@/components/common/buttons/generic';
import { RenderIf } from '@/helpers/render-conditional';

import LibraryItemCard from './library-item-card';
import LibraryMediaCard from './library-media-card';

import type { LibraryItemCardProps } from './library-item-card';
import type { FC } from 'react';

type LibrarySectionLayout = 'grid' | 'list';

type LibrarySectionCardProps = {
  badgeLabel: string;
  title: string;
  itemCount: number;
  totalSizeLabel: string;
  items: ReadonlyArray<LibraryItemCardProps>;
  layout?: LibrarySectionLayout;
  emptyMessage: string;
  showDeleteAll: boolean;
  onDeleteAll: () => void;
  deleteAllDisabled: boolean;
  showLoadMore: boolean;
  onLoadMore: () => void;
  loadMoreDisabled: boolean;
};

const LibrarySectionCard: FC<LibrarySectionCardProps> = ({
	badgeLabel,
	title,
	itemCount,
	totalSizeLabel,
	items,
	layout = 'list',
	emptyMessage,
	showDeleteAll,
	onDeleteAll,
	deleteAllDisabled,
	showLoadMore,
	onLoadMore,
	loadMoreDisabled
}) => {
	const isGridLayout = layout === 'grid';

	return (
		<section className="app-panel space-y-4 p-4 sm:p-5">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">{badgeLabel}</div>
					<h2 className="mt-3 text-base font-semibold text-white">{title}</h2>
					<p className="mt-1 text-xs text-white/55">{itemCount} items • {totalSizeLabel}</p>
				</div>
				<RenderIf
					condition={showDeleteAll}
					then={
						<SmallGenericButton
							onClick={onDeleteAll}
							disabled={deleteAllDisabled}
							className="inline-flex w-full items-center justify-center gap-2 border-red-400/18 bg-red-500/12 text-red-50 enabled:hover:border-red-300/28 enabled:hover:bg-red-500/18 sm:w-auto"
						>
							<TrashBin className="h-4 w-4" />
							<span>Delete all</span>
						</SmallGenericButton>
					}
					otherwise={null}
				/>
			</header>

			<RenderIf
				condition={items.length > 0}
				then={
					<div className="space-y-3">
						<div className={isGridLayout ? 'grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4' : 'space-y-3'}>
							{items.map((item) => (
								<section key={item.id}>
									<RenderIf condition={isGridLayout}
										then={<LibraryMediaCard {...item} />}
										otherwise={<LibraryItemCard {...item} />}
									/>
								</section>
							))}
						</div>
						<RenderIf
							condition={showLoadMore}
							then={
								<div className="flex justify-center pt-2">
									<SmallGenericButton
										onClick={onLoadMore}
										disabled={loadMoreDisabled}
										className="w-full sm:w-auto"
									>
                    Load more
									</SmallGenericButton>
								</div>
							}
							otherwise={null}
						/>
					</div>
				}
				otherwise={<p className="rounded-2xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-white/50">{emptyMessage}</p>}
			/>
		</section>
	);
};

export default LibrarySectionCard;
export type { LibrarySectionCardProps, LibrarySectionLayout };