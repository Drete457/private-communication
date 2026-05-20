import type { FC } from 'react';

interface TrashBinProps {
	className?: string;
}

const TrashBin: FC<TrashBinProps> = ({ className }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className ?? 'h-5 w-5'}
		aria-hidden="true"
	>
		<path d="M4 7h16" />
		<path d="M9 3h6" />
		<path d="M18 7l-1 12a2 2 0 0 1-2 1H9a2 2 0 0 1-2-1L6 7" />
		<path d="M10 11v5" />
		<path d="M14 11v5" />
	</svg>
);

export default TrashBin;