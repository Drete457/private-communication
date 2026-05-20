import type { AttachmentDownloadState } from "@/types";

const getAttachmentActionLabel = (
	downloadState: AttachmentDownloadState,
	hasLocalAttachment: boolean
): string => {
	if (downloadState.status === 'downloading')
		return `Downloading ${Math.round(downloadState.progress * 100)}%`;

	return hasLocalAttachment ? 'Save on device' : 'Download';
};

export { getAttachmentActionLabel };