const formatFileSize = (sizeBytes?: number): string => {
	if (!sizeBytes || sizeBytes <= 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB'];
	let size = sizeBytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex += 1;
	}

	const unit = units[unitIndex] ?? 'GB';
	return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${unit}`;
};

export { formatFileSize };