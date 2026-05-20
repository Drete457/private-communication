import type { FC } from 'react';

interface VideoCameraOffProps {
	className?: string;
}

const VideoCameraOff: FC<VideoCameraOffProps> = ({ className }) => (
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
		<path d="M10.6 6H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h9.6" />
		<path d="m16 10 4-2.5A1 1 0 0 1 21.5 8v8a1 1 0 0 1-1.5.9L16 14" />
		<path d="M14.5 6.7A3 3 0 0 1 16 9v2.2" />
	</svg>
);

export default VideoCameraOff;