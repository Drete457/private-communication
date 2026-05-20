type BackupWriter = {
	write: (chunk: Uint8Array) => Promise<void>;
	close: () => Promise<void>;
	abort: (reason?: unknown) => Promise<void>;
};

export type { BackupWriter };