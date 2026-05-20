import type { FC } from 'react';

interface SendProps {
	className?: string;
}

const Send: FC<SendProps> = ({ className }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.9"
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className ?? 'h-5 w-5'}
		aria-hidden="true"
	>
		<path d="M21 3 10 14" />
		<path d="m21 3-7 18-4-7-7-4z" />
	</svg>
);

export default Send;