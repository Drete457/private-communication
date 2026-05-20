import type { BackupPassphraseEvaluation } from './passphrase';

type BackupPassphraseMode = 'generated' | 'manual';
type BackupExportKind = 'identity' | 'full';

type NavigationLocationState = {
	pathname: string;
	search: string;
	hash: string;
};

type GeneratedPassphraseState = {
	confirmed: boolean;
	statusMessage: string;
};

type ManualPassphraseFeedback = {
	className: string;
	message: string;
};

type ManualPassphraseState = {
	evaluation: BackupPassphraseEvaluation;
	confirmed: boolean;
	ready: boolean;
	strengthSummary: string;
	strengthClassName: string;
	crackTimeSummary: string | null;
	feedback: ManualPassphraseFeedback;
};

type ExportUiState = {
	actionsDisabled: boolean;
	selectedPassphrase: string;
	progressPercent: number;
	itemProgressLabel: string | null;
	byteProgressLabel: string | null;
};

export type {
	BackupExportKind,
	BackupPassphraseMode,
	ExportUiState,
	GeneratedPassphraseState,
	ManualPassphraseFeedback,
	ManualPassphraseState,
	NavigationLocationState
};