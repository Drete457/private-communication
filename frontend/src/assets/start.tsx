import type { FC } from "react";

type FavoriteStarProps = {
  filled: boolean;
  className?: string;
};

const FavoriteStar: FC<FavoriteStarProps> = ({ filled, className }) => (
	<svg
		viewBox="0 0 24 24"
		fill={filled ? 'currentColor' : 'none'}
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		<path d="M12 3.75L14.55 8.92L20.25 9.75L16.12 13.78L17.1 19.45L12 16.77L6.9 19.45L7.88 13.78L3.75 9.75L9.45 8.92L12 3.75Z" />
	</svg>
);

export default FavoriteStar;