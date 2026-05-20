import type { FC } from 'react';

interface PhoneOffProps {
	className?: string;
}

const PhoneOff: FC<PhoneOffProps> = ({ className }) => (
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
		<path d="M3 3l18 18" />
		<path d="M9.8 6.2 8.9 5.3a3.1 3.1 0 0 0-4.4 0l-.6.6C2.6 7.2 2 9.2 2.5 11.2c.4 1.5 1.3 3.3 2.5 5.1" />
		<path d="M10.8 10.8a2 2 0 0 0 .4 2.4l1 1a2 2 0 0 0 2.4.4l1.8-.9c.7-.4 1.6-.2 2.2.4l1.5 1.5a3.1 3.1 0 0 1 0 4.4l-.6.6c-1.4 1.4-3.5 2-5.5 1.4-1.8-.5-3.9-1.6-5.9-3.2" />
	</svg>
);

export default PhoneOff;