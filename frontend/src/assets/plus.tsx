import type { FC } from 'react';

interface PlusProps {
	className?: string;
}

const Plus: FC<PlusProps> = ({ className }) => (
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
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	</svg>
);

export default Plus;