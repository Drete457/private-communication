import type { FC } from 'react';

interface SettingsSlidersProps {
	className?: string;
}

const SettingsSliders: FC<SettingsSlidersProps> = ({ className }) => (
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
		<path d="M4 7h6" />
		<path d="M14 7h6" />
		<path d="M4 17h10" />
		<path d="M18 17h2" />
		<circle cx="12" cy="7" r="2" />
		<circle cx="16" cy="17" r="2" />
	</svg>
);

export default SettingsSliders;