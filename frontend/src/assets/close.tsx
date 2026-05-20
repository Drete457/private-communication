import type { FC } from 'react';

interface CloseProps {
	className?: string;
}

const Close: FC<CloseProps> = ({ className }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className ?? 'h-5 w-5'}
		aria-hidden="true"
	>
		<path d="M6 6l12 12" />
		<path d="M18 6 6 18" />
	</svg>
);

export default Close;