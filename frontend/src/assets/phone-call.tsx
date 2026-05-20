import type { FC } from 'react';

interface PhoneCallProps {
	className?: string;
}

const PhoneCall: FC<PhoneCallProps> = ({ className }) => (
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
		<path d="M4.9 4.9c1.2-1.2 3.2-1.2 4.4 0l1.5 1.5c.6.6.8 1.5.4 2.3l-.9 1.8a2 2 0 0 0 .4 2.3l1 1a2 2 0 0 0 2.3.4l1.8-.9c.8-.4 1.7-.2 2.3.4l1.5 1.5c1.2 1.2 1.2 3.2 0 4.4l-.6.6c-1.4 1.4-3.5 2-5.5 1.4-2.3-.6-5-2.2-7.6-4.7-2.5-2.5-4.1-5.3-4.7-7.6-.5-2 .1-4.1 1.4-5.5z" />
		<path d="M15.5 5.5a4.5 4.5 0 0 1 3 3" />
		<path d="M15.5 2.5a7.5 7.5 0 0 1 6 6" />
	</svg>
);

export default PhoneCall;