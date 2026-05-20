import type { FC } from "react";

const Eye: FC = () => (
	<svg
		className="h-3 w-3"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
		<circle cx="12" cy="12" r="3" />
	</svg>
);

export default Eye;