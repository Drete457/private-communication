import type { FC } from 'react';

interface MicrophoneOffProps {
	className?: string;
}

const MicrophoneOff: FC<MicrophoneOffProps> = ({ className }) => (
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
		<path d="M9 5.5V11a3 3 0 0 0 3 3c.6 0 1.2-.2 1.7-.5" />
		<path d="M15 9.8V6a3 3 0 0 0-5.1-2.1" />
		<path d="M6 11a6 6 0 0 0 9.4 4.9" />
		<path d="M12 17v4" />
		<path d="M9 21h6" />
	</svg>
);

export default MicrophoneOff;