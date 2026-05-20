import { validateBackupPassphrase } from '@private-communication/pcbk-core';
import { zxcvbn, zxcvbnOptions  } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

import type { BackupPassphraseEvaluation } from '@/types/backup';

import type {Score} from '@zxcvbn-ts/core';

const REQUIRED_MANUAL_PASSPHRASE_SCORE: Score = 4;

const STRENGTH_LABELS: Record<Score, string> = {
	0: 'Very weak',
	1: 'Weak',
	2: 'Fair',
	3: 'Strong',
	4: 'Maximum'
};

zxcvbnOptions.setOptions({
	dictionary,
	graphs: adjacencyGraphs,
	useLevenshteinDistance: true
});

const evaluateBackupPassphrase = (passphrase: string): BackupPassphraseEvaluation => {
	const validation = validateBackupPassphrase(passphrase);

	if (!validation.valid) {
		return {
			...validation,
			score: null,
			strengthLabel: 'Invalid',
			warning: null,
			suggestions: [],
			crackTimeDisplay: null,
			meetsManualRequirement: false
		};
	}

	const result = zxcvbn(validation.normalizedPassphrase);

	return {
		...validation,
		score: result.score,
		strengthLabel: STRENGTH_LABELS[result.score],
		warning: result.feedback.warning,
		suggestions: result.feedback.suggestions,
		crackTimeDisplay: result.crackTimesDisplay.offlineSlowHashing1e4PerSecond,
		meetsManualRequirement: result.score === REQUIRED_MANUAL_PASSPHRASE_SCORE
	};
};

export {
	evaluateBackupPassphrase,
	REQUIRED_MANUAL_PASSPHRASE_SCORE,
	type BackupPassphraseEvaluation
};