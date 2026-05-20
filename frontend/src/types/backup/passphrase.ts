import type { validateBackupPassphrase } from '@private-communication/pcbk-core';
import type { Score } from '@zxcvbn-ts/core';

type BackupPassphraseEvaluation = ReturnType<typeof validateBackupPassphrase> & {
	score: Score | null;
	strengthLabel: string;
	warning: string | null;
	suggestions: string[];
	crackTimeDisplay: string | null;
	meetsManualRequirement: boolean;
};

export type { BackupPassphraseEvaluation };