import type { FC } from 'react';

interface MicrophoneProps {
	className?: string;
}

const Microphone: FC<MicrophoneProps> = ({ className }) => (
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
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M6 11a6 6 0 0 0 12 0" />
		<path d="M12 17v4" />
		<path d="M9 21h6" />
	</svg>
);

export default Microphone;