import {
	evaluateBackupPassphrase,
	REQUIRED_MANUAL_PASSPHRASE_SCORE
} from '@/services/backup';
import type {
	BackupExportProgress,
	BackupExportProgressStage,
	BackupPassphraseEvaluation,
	BackupPassphraseMode,
	ExportUiState,
	GeneratedPassphraseState,
	ManualPassphraseFeedback,
	ManualPassphraseState,
	NavigationLocationState
} from '@/types/backup';

const GENERATED_CONFIRMATION_COUNT = 3;
const LEAVING_EXPORT_PAGE_MESSAGE = 'Backup export in progress. Leaving this page will cancel the export. Continue?';
const BACKUP_SCORE_STEPS = [0, 1, 2, 3, 4] as const;

const EXPORT_STAGE_ORDER: BackupExportProgressStage[] = [
	'validating-passphrase',
	'deriving-keys',
	'writing-header',
	'exporting-identity',
	'exporting-peer-keys',
	'exporting-messages',
	'exporting-link-previews',
	'exporting-outbox',
	'exporting-attachments',
	'exporting-transfer-queue',
	'exporting-remote-media',
	'writing-manifest',
	'finalizing'
];

const EXPORT_STAGE_LABELS: Record<BackupExportProgressStage, string> = {
	'validating-passphrase': 'Validating passphrase',
	'deriving-keys': 'Deriving encryption keys',
	'writing-header': 'Writing backup header',
	'exporting-identity': 'Exporting identity',
	'exporting-peer-keys': 'Exporting peer keys',
	'exporting-messages': 'Exporting messages',
	'exporting-link-previews': 'Exporting link previews',
	'exporting-outbox': 'Exporting outbox',
	'exporting-attachments': 'Exporting attachments',
	'exporting-transfer-queue': 'Exporting transfer queue',
	'exporting-remote-media': 'Exporting remote media',
	'writing-manifest': 'Writing manifest',
	'finalizing': 'Finalizing backup file'
};

const createRandomIndex = (limit: number): number => {
	if (limit <= 0)
		return 0;

	if (typeof globalThis.crypto !== 'undefined') {
		const randomValues = new Uint32Array(1);
		globalThis.crypto.getRandomValues(randomValues);
		return (randomValues[0] ?? 0) % limit;
	}

	return Math.floor(Math.random() * limit);
};

const createSampleWordIndexes = (totalWords: number, count: number): number[] => {
	const indexes = Array.from({ length: totalWords }, (_, index) => index);

	for (let currentIndex = indexes.length - 1; currentIndex > 0; currentIndex -= 1) {
		const nextIndex = createRandomIndex(currentIndex + 1);
		const currentValue = indexes[currentIndex];
		const nextValue = indexes[nextIndex];
		if (currentValue === undefined || nextValue === undefined)
			continue;

		indexes[currentIndex] = nextValue;
		indexes[nextIndex] = currentValue;
	}

	return indexes.slice(0, count).sort((left, right) => left - right);
};

const normalizeWordValue = (value: string): string => value.trim().toLowerCase();

const formatBytes = (value: number): string => {
	if (value < 1024)
		return `${value} B`;

	if (value < 1024 * 1024)
		return `${(value / 1024).toFixed(1)} KB`;

	return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const getProgressRatio = (progress: BackupExportProgress | null): number => {
	if (!progress)
		return 0;

	if (typeof progress.totalBytes === 'number' && progress.totalBytes > 0)
		return Math.max(0, Math.min(1, (progress.processedBytes ?? 0) / progress.totalBytes));

	if (typeof progress.totalItems === 'number' && progress.totalItems > 0)
		return Math.max(0, Math.min(1, (progress.processedItems ?? 0) / progress.totalItems));

	const stageIndex = EXPORT_STAGE_ORDER.indexOf(progress.stage);
	if (stageIndex === -1)
		return 0;

	return (stageIndex + 1) / EXPORT_STAGE_ORDER.length;
};

const getProgressLabel = (progress: BackupExportProgress | null): string => {
	if (!progress)
		return 'Preparing backup export';

	return EXPORT_STAGE_LABELS[progress.stage];
};

const getModeButtonClassName = (active: boolean): string => {
	if (active)
		return 'border-primary-300/40 bg-primary-500/16 text-primary-50';

	return 'border-white/10 bg-dark-300/90 text-white/72';
};

const createGeneratedConfirmationIndexes = (totalWords: number): number[] => {
	return createSampleWordIndexes(totalWords, GENERATED_CONFIRMATION_COUNT);
};

const getGeneratedPassphraseState = (
	generatedPassphrase: string,
	generatedWords: string[],
	generatedConfirmationIndexes: number[],
	generatedConfirmationValues: string[]
): GeneratedPassphraseState => {
	const confirmed = generatedPassphrase.length > 0
		&& generatedConfirmationIndexes.length === GENERATED_CONFIRMATION_COUNT
		&& generatedConfirmationIndexes.every((wordIndex, inputIndex) => {
			return normalizeWordValue(generatedConfirmationValues[inputIndex] ?? '') === normalizeWordValue(generatedWords[wordIndex] ?? '');
		});

	return {
		confirmed,
		statusMessage: confirmed
			? 'Mnemonic confirmed. Export ready.'
			: 'Mnemonic still locked. Confirm sampled words to unlock export.'
	};
};

const getManualPassphraseFeedback = (evaluation: BackupPassphraseEvaluation): ManualPassphraseFeedback => {
	if (!evaluation.valid) {
		return {
			className: 'text-rose-200',
			message: evaluation.errors[0] ?? 'Manual passphrase is invalid.'
		};
	}

	if (evaluation.meetsManualRequirement) {
		return {
			className: 'text-emerald-200',
			message: 'Manual passphrase meets policy and score gate.'
		};
	}

	return {
		className: 'text-amber-200',
		message: `Manual passphrase blocked until zxcvbn reaches ${REQUIRED_MANUAL_PASSPHRASE_SCORE}/4.`
	};
};

const getManualScoreStepClassName = (
	score: BackupPassphraseEvaluation['score'],
	scoreIndex: number
): string => {
	if (score === null || score < scoreIndex)
		return 'bg-white/10';

	return score === REQUIRED_MANUAL_PASSPHRASE_SCORE
		? 'bg-emerald-300'
		: 'bg-amber-300';
};

const getManualPassphraseState = (passphrase: string, confirmation: string): ManualPassphraseState => {
	const evaluation = evaluateBackupPassphrase(passphrase);
	const confirmed = confirmation.length > 0 && passphrase === confirmation;

	return {
		evaluation,
		confirmed,
		ready: evaluation.valid && evaluation.meetsManualRequirement && confirmed,
		strengthSummary: evaluation.score === null
			? 'Awaiting valid passphrase'
			: `zxcvbn ${evaluation.score}/4 • ${evaluation.strengthLabel}`,
		strengthClassName: evaluation.meetsManualRequirement ? 'text-emerald-200' : 'text-amber-200',
		crackTimeSummary: evaluation.crackTimeDisplay
			? `Can be cracked in about ${evaluation.crackTimeDisplay}.`
			: null,
		feedback: getManualPassphraseFeedback(evaluation)
	};
};

const getExportUiState = (input: {
	isExporting: boolean;
	isRestoringBackup: boolean;
	passphraseMode: BackupPassphraseMode;
	generatedPassphraseConfirmed: boolean;
	manualPassphraseReady: boolean;
	generatedPassphrase: string;
	manualPassphrase: string;
	exportProgress: BackupExportProgress | null;
}): ExportUiState => {
	const {
		isExporting,
		isRestoringBackup,
		passphraseMode,
		generatedPassphraseConfirmed,
		manualPassphraseReady,
		generatedPassphrase,
		manualPassphrase,
		exportProgress
	} = input;
	const progressRatio = getProgressRatio(exportProgress);

	return {
		actionsDisabled: isExporting || isRestoringBackup || (passphraseMode === 'generated'
			? !generatedPassphraseConfirmed
			: !manualPassphraseReady),
		selectedPassphrase: passphraseMode === 'generated' ? generatedPassphrase : manualPassphrase,
		progressPercent: Math.max(6, Math.round(progressRatio * 100)),
		itemProgressLabel: exportProgress && typeof exportProgress.totalItems === 'number'
			? `${exportProgress.processedItems ?? 0} / ${exportProgress.totalItems} item(s)`
			: null,
		byteProgressLabel: exportProgress && typeof exportProgress.totalBytes === 'number'
			? `${formatBytes(exportProgress.processedBytes ?? 0)} / ${formatBytes(exportProgress.totalBytes)}`
			: null
	};
};

const getNavigationAnchor = (event: MouseEvent): HTMLAnchorElement | null => {
	if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
		return null;

	if (!(event.target instanceof Element))
		return null;

	const anchor = event.target.closest('a');
	if (!(anchor instanceof HTMLAnchorElement))
		return null;

	if (anchor.target && anchor.target !== '_self')
		return null;

	if (anchor.hasAttribute('download'))
		return null;

	return anchor;
};

const isLeavingCurrentPage = (anchor: HTMLAnchorElement, currentLocation: NavigationLocationState): boolean => {
	const nextUrl = new URL(anchor.href, window.location.href);

	if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:')
		return false;

	if (nextUrl.origin !== window.location.origin)
		return true;

	return nextUrl.pathname !== currentLocation.pathname
		|| nextUrl.search !== currentLocation.search
		|| nextUrl.hash !== currentLocation.hash;
};

export {
	BACKUP_SCORE_STEPS,
	LEAVING_EXPORT_PAGE_MESSAGE,
	createGeneratedConfirmationIndexes,
	getExportUiState,
	getGeneratedPassphraseState,
	getManualPassphraseState,
	getManualScoreStepClassName,
	getModeButtonClassName,
	getNavigationAnchor,
	getProgressLabel,
	isLeavingCurrentPage
};