import type { FC } from 'react';

const GifSticker: FC = () => (
	<svg
		className="h-10 w-10"
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
	>
		<defs>
			<linearGradient id="gif-sticker-bg" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
				<stop stopColor="#7DD3FC" />
				<stop offset="1" stopColor="#0EA5E9" />
			</linearGradient>
		</defs>
		<rect x="3" y="4" width="18" height="16" rx="5" fill="url(#gif-sticker-bg)" />
		<rect x="4.25" y="5.25" width="15.5" height="13.5" rx="4" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
		<path d="M7.5 15.25L10.25 12.5L12.25 14.5L14.75 11.5L17 13.75" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
		<circle cx="15.75" cy="9" r="1.25" fill="white">
			<animate attributeName="r" values="1.1;1.7;1.1" dur="1.3s" repeatCount="indefinite" />
			<animate attributeName="opacity" values="0.75;1;0.75" dur="1.3s" repeatCount="indefinite" />
		</circle>
		<rect x="6.25" y="7.1" width="4.6" height="1.4" rx="0.7" fill="rgba(255,255,255,0.92)">
			<animate attributeName="opacity" values="0.45;1;0.45" dur="1.1s" repeatCount="indefinite" />
		</rect>
		<rect x="6.25" y="9.45" width="3.1" height="1.35" rx="0.675" fill="rgba(255,255,255,0.7)">
			<animate attributeName="opacity" values="1;0.45;1" dur="1.1s" repeatCount="indefinite" />
		</rect>
	</svg>
);

export default GifSticker;