import type { FC } from 'react';

interface AlertCircleProps {
	className?: string;
}

const AlertCircle: FC<AlertCircleProps> = ({ className }) => (
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
		<circle cx="12" cy="12" r="9" />
		<path d="M12 8v5" />
		<path d="M12 16h.01" />
	</svg>
);

export default AlertCircle;