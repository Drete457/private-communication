import type { FC } from 'react';

type LibraryHeroProps = {
	itemCount: number;
	storageLabel: string;
	viewLabel: string;
	showExplorerHint: boolean;
};

const LibraryHero: FC<LibraryHeroProps> = ({ itemCount, storageLabel, viewLabel, showExplorerHint }) => (
	<section className="mb-4 sm:mb-6">
		<div className="app-panel overflow-hidden p-0">
			<div className="bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_32%),linear-gradient(180deg,rgba(10,17,31,0.98),rgba(6,10,20,0.94))] px-4 py-5 sm:px-6 sm:py-6">
				<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Library</p>
				<div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div className="max-w-2xl">
						<h1 className="text-2xl font-bold text-white sm:text-3xl">Your local media and link cache</h1>
						<p className="mt-2 text-sm text-white/70 sm:text-base">Browse stored content by type, switch to one category when you want a focused view, and remove local copies when you want to reclaim space.</p>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
						<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
							<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Items</p>
							<p className="mt-2 text-lg font-semibold text-white">{itemCount}</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
							<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Storage</p>
							<p className="mt-2 text-lg font-semibold text-white">{storageLabel}</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
							<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">View</p>
							<p className="mt-2 text-lg font-semibold text-white">{viewLabel}</p>
						</div>
					</div>
				</div>
				{showExplorerHint ? (
					<div className="mt-4 rounded-3xl border border-white/8 bg-dark-400/55 px-4 py-4 sm:px-6">
						<p className="text-xs text-white/52">Browse all categories or narrow the view with the explorer controls below.</p>
					</div>
				) : null}
			</div>
		</div>
	</section>
);

export default LibraryHero;
export type { LibraryHeroProps };