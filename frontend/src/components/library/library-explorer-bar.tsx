import { useState } from 'react';

import { SmallGenericButton } from '@/components/common/buttons/generic';
import { Select } from '@/components/common/select';
import { Input } from '@/components/common/text/input';
import { RenderIf } from '@/helpers/render-conditional';

import type { FC, ReactNode} from 'react';

type ExplorerOption = {
	id: string;
	label: string;
};

type ExplorerCategoryOption = {
	id: string;
	title: string;
	count: number;
	active: boolean;
	onClick: () => void;
};

interface LibraryExplorerBarProps {
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	activePeerFilter: string;
	activePeerFilterLabel: string;
	onPeerFilterChange: (value: string) => void;
	peerFilterOptions: ReadonlyArray<ExplorerOption>;
	sortOrder: string;
	activeSortLabel: string;
	onSortOrderChange: (value: string) => void;
	sortOptions: ReadonlyArray<ExplorerOption>;
	categoryOptions: ReadonlyArray<ExplorerCategoryOption>;
	activeCategoryTitle: string;
	hasActiveExplorerFilters: boolean;
	onClearAll: () => void;
	matchingItemCount: number;
	contactScopeCount: number;
	showScopedDeleteHint: boolean;
}

const LibraryExplorerBar: FC<LibraryExplorerBarProps> = ({
	searchQuery,
	onSearchQueryChange,
	activePeerFilter,
	activePeerFilterLabel,
	onPeerFilterChange,
	peerFilterOptions,
	sortOrder,
	activeSortLabel,
	onSortOrderChange,
	sortOptions,
	categoryOptions,
	activeCategoryTitle,
	hasActiveExplorerFilters,
	onClearAll,
	matchingItemCount,
	contactScopeCount,
	showScopedDeleteHint
}) => {
	const [mobileExpanded, setMobileExpanded] = useState<boolean>(false);

	const summaryChips = (
		<div className="flex flex-wrap gap-2 text-xs">
			<div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/72">
				<span className="text-white/46">View</span> {activeCategoryTitle}
			</div>
			<div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/72">
				<span className="text-white/46">Contact</span> {activePeerFilterLabel}
			</div>
			<div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/72">
				<span className="text-white/46">Sort</span> {activeSortLabel}
			</div>
		</div>
	);

	const controlsContent: ReactNode = (
		<>
			<div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:items-end">
				<div>
					<p className="mb-2 text-sm font-medium text-gray-300">Search</p>
					<Input
						value={searchQuery}
						onChange={(event) => onSearchQueryChange(event.target.value)}
						placeholder="Search files, links, URLs, or contacts"
					/>
				</div>
				<Select
					title="Contact"
					value={activePeerFilter}
					onChange={(event) => onPeerFilterChange(event.target.value)}
					list={peerFilterOptions}
				/>
				<Select
					title="Sort"
					value={sortOrder}
					onChange={(event) => onSortOrderChange(event.target.value)}
					list={sortOptions}
				/>
				<div className="flex items-end">
					<SmallGenericButton
						onClick={onClearAll}
						disabled={!hasActiveExplorerFilters}
						className="w-full lg:w-auto"
					>
						Clear all
					</SmallGenericButton>
				</div>
			</div>
			<div>
				<p className="mb-2 text-sm font-medium text-gray-300">Category</p>
				<div className="flex gap-2 overflow-x-auto pb-1">
					{categoryOptions.map((option) => (
						<button
							key={option.id}
							type="button"
							onClick={option.onClick}
							aria-pressed={option.active}
							className={`shrink-0 rounded-2xl border px-3 py-2 text-left transition-colors ${option.active
								? 'border-primary-300/45 bg-primary-400/16 text-white'
								: 'border-white/10 bg-white/4 text-white/72 hover:border-white/20 hover:bg-white/8'}`}
						>
							<p className="text-sm font-semibold">{option.title}</p>
							<p className="mt-1 text-[0.7rem] uppercase tracking-[0.18em] text-white/48">{option.count} items</p>
						</button>
					))}
				</div>
			</div>
			<div className="flex flex-col gap-2 text-xs text-white/52 sm:flex-row sm:items-center sm:justify-between">
				<p>{matchingItemCount} matching item{matchingItemCount === 1 ? '' : 's'} across {contactScopeCount} contact scope{contactScopeCount === 1 ? '' : 's'}.</p>
				<RenderIf
					condition={showScopedDeleteHint}
					then={<p>Delete-all actions are hidden while search or contact filters are narrowing the view.</p>}
					otherwise={null}
				/>
			</div>
		</>
	);

	return (
		<section className="sticky -top-2 z-20 mb-4 pt-0 sm:mb-1">
			<div className="rounded-[1.75rem] bg-[linear-gradient(180deg,rgba(6,10,20,0.96),rgba(6,10,20,0.72)_72%,transparent)] px-1 pb-1">
				<div className="app-panel overflow-hidden border-white/8 bg-dark-300/84 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-5">
					<div className="flex flex-col gap-4">
						<div className="hidden flex-col gap-3 border-b border-white/8 pb-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-primary-100/80">Explore</p>
								<p className="mt-2 text-sm text-white/68">Keep search, category and sorting controls within reach while you scroll.</p>
							</div>
							{summaryChips}
						</div>

						<div className="flex flex-col gap-3 sm:hidden">
							<div className="flex items-start justify-between gap-3">
								<div>
									<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-primary-100/80">Explore</p>
									<p className="mt-1 text-sm text-white/68">Filters and sorting stay one tap away.</p>
								</div>
								<SmallGenericButton
									onClick={() => setMobileExpanded((current) => !current)}
									className="shrink-0"
								>
									{mobileExpanded ? 'Hide filters' : 'Show filters'}
								</SmallGenericButton>
							</div>
							{summaryChips}
						</div>

						<div className="hidden sm:flex sm:flex-col sm:gap-4">
							{controlsContent}
						</div>

						<RenderIf
							condition={mobileExpanded}
							then={<div className="border-t border-white/8 pt-4 sm:hidden">{controlsContent}</div>}
							otherwise={null}
						/>
					</div>
				</div>
			</div>
		</section>
	);
};

export default LibraryExplorerBar;
export type { LibraryExplorerBarProps };