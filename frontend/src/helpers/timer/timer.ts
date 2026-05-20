const formatTimer = (elapsedMs: number): string => {
	const hours = Math.floor(elapsedMs / 3600);
	const minutes = Math.floor((elapsedMs % 3600) / 60);
	const seconds = elapsedMs % 60;

	// Helper function to add leading zeros
	const pad = (num: number): string => num.toString().padStart(2, '0');

	if (hours > 0)
		return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

	return `${pad(minutes)}:${pad(seconds)}`;
};

const calculateElapsedTime = (startTime: number): number =>
	Math.max(0, Math.floor((Date.now() - startTime) / 1000))

export { formatTimer, calculateElapsedTime };