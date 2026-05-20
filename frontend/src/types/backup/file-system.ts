type SaveFilePickerAcceptType = {
	description?: string;
	accept: Record<string, string[]>;
};

type SaveFilePickerOptions = {
	suggestedName?: string;
	types?: SaveFilePickerAcceptType[];
	excludeAcceptAllOption?: boolean;
};

type FileSystemWritableFileStreamLike = {
	write: (data: Uint8Array | Blob | string) => Promise<void>;
	close: () => Promise<void>;
	abort: (reason?: unknown) => Promise<void>;
};

type FileSystemFileHandleLike = {
	createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

type SaveFilePickerWindow = Window & typeof globalThis & {
	showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
};

export type {
	FileSystemFileHandleLike,
	FileSystemWritableFileStreamLike,
	SaveFilePickerAcceptType,
	SaveFilePickerOptions,
	SaveFilePickerWindow
};