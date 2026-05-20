import type { FC } from 'react';

interface VideoCameraProps {
	className?: string;
}

const VideoCamera: FC<VideoCameraProps> = ({ className }) => (
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
		<rect x="3" y="6" width="13" height="12" rx="3" />
		<path d="m16 10 4-2.5A1 1 0 0 1 21.5 8v8a1 1 0 0 1-1.5.9L16 14" />
	</svg>
);

export default VideoCamera;