import type { FC } from 'react';

interface UserPlusProps {
	className?: string;
}

const UserPlus: FC<UserPlusProps> = ({ className }) => (
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
		<path d="M15 19a4.5 4.5 0 0 0-9 0" />
		<circle cx="10.5" cy="7.5" r="3.5" />
		<path d="M19 8v6" />
		<path d="M16 11h6" />
	</svg>
);

export default UserPlus;