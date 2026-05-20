import type { FC } from 'react';

interface ChatBubbleProps {
	className?: string;
}

const ChatBubble: FC<ChatBubbleProps> = ({ className }) => (
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
		<path d="M7 18.5c-2.8 0-5-2.2-5-5V8c0-2.8 2.2-5 5-5h10c2.8 0 5 2.2 5 5v5.5c0 2.8-2.2 5-5 5H10l-4.5 3z" />
		<path d="M8 9h8" />
		<path d="M8 13h5" />
	</svg>
);

export default ChatBubble;