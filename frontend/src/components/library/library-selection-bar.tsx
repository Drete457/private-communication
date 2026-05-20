
import { SmallGenericButton } from '@/components/common/buttons/generic';
import { RenderIf } from '@/helpers/render-conditional';

import type { FC } from 'react';

type LibrarySelectionBarProps = {
	selectionMode: boolean;
	selectedCount: number;
	visibleCount: number;
	allVisibleSelected: boolean;
	onEnterSelectionMode: () => void;
	onExitSelectionMode: () => void;
	onToggleSelectVisible: () => void;
	onDeleteSelected: () => void;
	actionsDisabled: boolean;
};

const LibrarySelectionBar: FC<LibrarySelectionBarProps> = ({
	selectionMode,
	selectedCount,
	visibleCount,
	allVisibleSelected,
	onEnterSelectionMode,
	onExitSelectionMode,
	onToggleSelectVisible,
	onDeleteSelected,
	actionsDisabled
}) => (
	<RenderIf condition={selectionMode}
		then={
			<section className="mb-4 sm:mb-5">
				<div className="app-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
					<div>
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-primary-100/80">Batch actions</p>
						<p className="mt-2 text-sm text-white/65">Select multiple items when you want to clean a view without deleting one by one.</p>
					</div>
					<SmallGenericButton onClick={onEnterSelectionMode} disabled={actionsDisabled} className="w-full sm:w-auto">
						Select items
					</SmallGenericButton>
				</div>
			</section>
		}
		otherwise={<section className="mb-4 sm:mb-5">
			<div className="app-panel flex flex-col gap-4 border-primary-300/16 bg-primary-500/8 p-4 sm:p-5">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-primary-100/80">Batch actions</p>
						<p className="mt-2 text-sm font-semibold text-white">{selectedCount} item{selectedCount === 1 ? '' : 's'} selected</p>
						<p className="mt-1 text-sm text-white/62">You can select the items shown in this view, then remove them in one step.</p>
					</div>
					<SmallGenericButton onClick={onExitSelectionMode} disabled={actionsDisabled} className="w-full sm:w-auto">
						Done selecting
					</SmallGenericButton>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
					<SmallGenericButton onClick={onToggleSelectVisible} disabled={actionsDisabled || visibleCount === 0} className="w-full sm:w-auto">
						{allVisibleSelected ? 'Clear shown items' : `Select shown items (${visibleCount})`}
					</SmallGenericButton>
					<SmallGenericButton onClick={onExitSelectionMode} disabled={actionsDisabled} className="w-full border-white/10 bg-white/5 text-white/72 enabled:hover:border-white/20 enabled:hover:bg-white/8 sm:w-auto">
						Clear selection
					</SmallGenericButton>
					<SmallGenericButton
						onClick={onDeleteSelected}
						disabled={actionsDisabled || selectedCount === 0}
						className="w-full border-red-400/18 bg-red-500/12 text-red-50 enabled:hover:border-red-300/28 enabled:hover:bg-red-500/18 sm:w-auto"
					>
						Delete selected
					</SmallGenericButton>
				</div>
			</div>
		</section>}
	/>
)

export default LibrarySelectionBar;
export type { LibrarySelectionBarProps };