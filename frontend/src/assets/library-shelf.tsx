import type { FC } from 'react';

interface LibraryShelfProps {
	className?: string;
}

const LibraryShelf: FC<LibraryShelfProps> = ({ className }) => (
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
		<path d="M4 5.5h4v13H4z" />
		<path d="M10 4h4v14h-4z" />
		<path d="M16 7h4v11h-4z" />
		<path d="M3 20h18" />
	</svg>
);

export default LibraryShelf;