import type { FC } from 'react';

interface ArrowProps {
  direction?: 'up' | 'down';
	className?: string;
}

const ArrowUp: FC<ArrowProps> = ({ direction = 'up', className }) => (
	<svg
		className={`${className ?? 'h-5 w-5 text-gray-400'} transition-transform duration-150 ${direction === 'down' ? 'rotate-180' : ''}`.trim()}
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
	>
		<path
			fillRule="evenodd"
			d="M10 3a1 1 0 01.707.293l5 5a1 1 0 01-1.414 1.414L10 5.414 5.707 9.707A1 1 0 014.293 8.293l5-5A1 1 0 0110 3z"
			clipRule="evenodd"
		/>
	</svg>
);

export default ArrowUp;