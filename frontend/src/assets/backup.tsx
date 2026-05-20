import type { FC } from 'react';

interface BackupProps {
	className?: string;
}

const Backup: FC<BackupProps> = ({ className = 'h-5 w-5' }) => (
	<svg
		className={className}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M12 4v9" />
		<path d="m8.5 9.5 3.5 3.5 3.5-3.5" />
		<path d="M4.75 14.75v1.5A2.75 2.75 0 0 0 7.5 19h9a2.75 2.75 0 0 0 2.75-2.75v-1.5" />
		<path d="M8 19h8" />
	</svg>
);

export default Backup;