import { useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useLocation } from 'react-router-dom';

import { GenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { ErrorMessage } from '@/components/common/messages/error';
import { StatusMessage } from '@/components/common/messages/status';
import { Input } from '@/components/common/text/input';
import {
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
} from '@/helpers/backup';
import { RenderIf } from '@/helpers/render-conditional';
import {
	CANCELED_BACKUP_EXPORT_MESSAGE,
	generateBackupPassphrase,
	isBackupExportSupported,
	REQUIRED_MANUAL_PASSPHRASE_SCORE,
	UNSUPPORTED_BACKUP_EXPORT_MESSAGE,
} from '@/services/backup';
import { exportFullBackup, exportIdentityBackup } from '@/services/identity-backup-service';
import type {
	BackupExportKind,
	BackupExportProgress,
	BackupPassphraseMode,
	NavigationLocationState
} from '@/types/backup';

import RestoreBackupPanel from './restore-backup-panel';

import type { FC} from 'react';

const BackupSettings: FC = () => {
	const location = useLocation();
	const [passphraseMode, setPassphraseMode] = useState<BackupPassphraseMode>('generated');
	const [manualPassphrase, setManualPassphrase] = useState<string>('');
	const [manualPassphraseConfirm, setManualPassphraseConfirm] = useState<string>('');
	const [generatedPassphrase, setGeneratedPassphrase] = useState<string>('');
	const [generatedWords, setGeneratedWords] = useState<string[]>([]);
	const [generatedConfirmationIndexes, setGeneratedConfirmationIndexes] = useState<number[]>([]);
	const [generatedConfirmationValues, setGeneratedConfirmationValues] = useState<string[]>([]);
	const [backupStatus, setBackupStatus] = useState<string | null>(null);
	const [backupError, setBackupError] = useState<string | null>(null);
	const [copyStatus, setCopyStatus] = useState<string | null>(null);
	const [activeExportKind, setActiveExportKind] = useState<BackupExportKind | null>(null);
	const [exportProgress, setExportProgress] = useState<BackupExportProgress | null>(null);
	const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
	const exportAbortControllerRef = useRef<AbortController | null>(null);
	const copyStatusTimeoutRef = useRef<number | null>(null);
	const skipNextPopStateRef = useRef<boolean>(false);
	const exportSupported = isBackupExportSupported();
	const isExporting = activeExportKind !== null;
	const manualPassphraseState = getManualPassphraseState(manualPassphrase, manualPassphraseConfirm);
	const generatedPassphraseState = getGeneratedPassphraseState(
		generatedPassphrase,
		generatedWords,
		generatedConfirmationIndexes,
		generatedConfirmationValues
	);
	const exportUiState = getExportUiState({
		isExporting,
		isRestoringBackup,
		passphraseMode,
		generatedPassphraseConfirmed: generatedPassphraseState.confirmed,
		manualPassphraseReady: manualPassphraseState.ready,
		generatedPassphrase,
		manualPassphrase,
		exportProgress
	});

	const getErrorMessage = (error: unknown): string => {
		return error instanceof Error ? error.message : 'Unexpected backup error';
	};

	const clearExportFeedback = (): void => {
		setBackupError(null);
		setBackupStatus(null);
	};

	const setTimedCopyStatus = (message: string): void => {
		setCopyStatus(message);

		if (copyStatusTimeoutRef.current !== null)
			window.clearTimeout(copyStatusTimeoutRef.current);

		copyStatusTimeoutRef.current = window.setTimeout(() => {
			setCopyStatus(null);
			copyStatusTimeoutRef.current = null;
		}, 2500);
	};

	const handlePassphraseModeChange = (nextMode: BackupPassphraseMode): void => {
		setPassphraseMode(nextMode);
		clearExportFeedback();
	};

	const handleGeneratedModeSelection = (): void => {
		handlePassphraseModeChange('generated');
	};

	const handleManualModeSelection = (): void => {
		handlePassphraseModeChange('manual');
	};

	const handleManualPassphraseChange = (value: string): void => {
		setManualPassphrase(value);
		clearExportFeedback();
	};

	const handleManualPassphraseConfirmChange = (value: string): void => {
		setManualPassphraseConfirm(value);
		clearExportFeedback();
	};

	const handleGeneratePassphrase = (): void => {
		const generated = generateBackupPassphrase();
		const sampleIndexes = createGeneratedConfirmationIndexes(generated.words.length);

		setPassphraseMode('generated');
		setGeneratedPassphrase(generated.value);
		setGeneratedWords(generated.words);
		setGeneratedConfirmationIndexes(sampleIndexes);
		setGeneratedConfirmationValues(sampleIndexes.map(() => ''));
		clearExportFeedback();
		setCopyStatus(null);
	};

	const handleGeneratedConfirmationChange = (inputIndex: number, value: string): void => {
		setGeneratedConfirmationValues((currentValues) => {
			const nextValues = [...currentValues];
			nextValues[inputIndex] = value;
			return nextValues;
		});
		clearExportFeedback();
	};

	const handleCopyGeneratedPassphrase = async (): Promise<void> => {
		if (!generatedPassphrase)
			return;

		try {
			await navigator.clipboard.writeText(generatedPassphrase);
			setTimedCopyStatus('Backup passphrase copied.');
		} catch {
			setTimedCopyStatus('Could not copy backup passphrase.');
		}
	};

	const handleCopyGeneratedPassphraseClick = (): void => {
		void handleCopyGeneratedPassphrase();
	};

	const validateExportPassphrase = (): string | null => {
		if (passphraseMode === 'generated') {
			if (!generatedPassphrase)
				return 'Generate secure backup passphrase first.';

			if (!generatedPassphraseState.confirmed)
				return 'Confirm the sampled mnemonic words before exporting.';

			return null;
		}

		if (!manualPassphraseState.evaluation.valid)
			return manualPassphraseState.evaluation.errors[0] ?? 'Backup passphrase is invalid.';

		if (!manualPassphraseState.evaluation.meetsManualRequirement)
			return `Manual passphrase must reach zxcvbn score ${REQUIRED_MANUAL_PASSPHRASE_SCORE}/4.`;

		if (!manualPassphraseState.confirmed)
			return 'Backup passphrase and confirmation must match.';

		return null;
	};

	const handleIdentityExportClick = (): void => {
		void handleExport('identity');
	};

	const handleFullExportClick = (): void => {
		void handleExport('full');
	};

	const handleExport = async (kind: BackupExportKind): Promise<void> => {
		const validationError = validateExportPassphrase();
		if (validationError) {
			setBackupError(validationError);
			setBackupStatus(null);
			return;
		}

		const abortController = new AbortController();
		exportAbortControllerRef.current = abortController;
		clearExportFeedback();
		setActiveExportKind(kind);
		setExportProgress({ stage: 'validating-passphrase' });

		try {
			const exportFn = kind === 'identity' ? exportIdentityBackup : exportFullBackup;
			await exportFn(exportUiState.selectedPassphrase, {
				onProgress: (progress) => {
					setExportProgress(progress);
				},
				signal: abortController.signal
			});
			setBackupStatus(kind === 'identity'
				? 'Identity backup export completed.'
				: 'Full backup export completed.');
		} catch (error) {
			const message = getErrorMessage(error);

			if (message === CANCELED_BACKUP_EXPORT_MESSAGE)
				setBackupStatus(CANCELED_BACKUP_EXPORT_MESSAGE);
			else
				setBackupError(message);
		} finally {
			exportAbortControllerRef.current = null;
			setActiveExportKind(null);
			setExportProgress(null);
		}
	};

	const handleCancelExport = (): void => {
		exportAbortControllerRef.current?.abort();
	};

	useEffect(() => {
		return () => {
			exportAbortControllerRef.current?.abort();

			if (copyStatusTimeoutRef.current !== null)
				window.clearTimeout(copyStatusTimeoutRef.current);
		};
	}, []);

	useBeforeUnload((event) => {
		if (!isExporting)
			return;

		event.preventDefault();
		event.returnValue = '';
	});

	useEffect(() => {
		if (!isExporting)
			return;

		const currentLocation: NavigationLocationState = {
			pathname: location.pathname,
			search: location.search,
			hash: location.hash
		};

		const handleDocumentClick = (event: MouseEvent) => {
			const anchor = getNavigationAnchor(event);
			if (!anchor || !isLeavingCurrentPage(anchor, currentLocation))
				return;

			if (window.confirm(LEAVING_EXPORT_PAGE_MESSAGE))
				return;

			event.preventDefault();
			event.stopPropagation();
		};

		const handlePopState = () => {
			if (skipNextPopStateRef.current) {
				skipNextPopStateRef.current = false;
				return;
			}

			if (window.confirm(LEAVING_EXPORT_PAGE_MESSAGE))
				return;

			skipNextPopStateRef.current = true;
			window.history.forward();
		};

		document.addEventListener('click', handleDocumentClick, true);
		window.addEventListener('popstate', handlePopState);

		return () => {
			document.removeEventListener('click', handleDocumentClick, true);
			window.removeEventListener('popstate', handlePopState);
			skipNextPopStateRef.current = false;
		};
	}, [isExporting, location.hash, location.pathname, location.search]);

	return (
		<section className="mb-6 sm:mb-8">
			<div className="app-panel space-y-6 p-4 sm:p-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary-100">Backup and recovery</p>
						<h2 className="app-display-title mt-2 text-lg font-semibold text-white">Protect continuity before you switch devices</h2>
						<p className="app-text-muted mt-2 text-sm">
							Export a backup after a new start, then use restore when you want the same trusted identity to continue on another device. Restoring a backup replaces the current local identity and data on this device.
						</p>
					</div>
					<div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75 sm:max-w-xs">
						Keep one backup offline and another somewhere you control.
					</div>
				</div>

				<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
					<div className="app-panel-muted rounded-3xl p-4">
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">After a new start</p>
						<h3 className="mt-2 text-sm font-semibold text-white">Export a backup soon</h3>
						<p className="mt-2 text-sm text-white/66">A new identity lives only on this device until you export a backup. Do that before changing or resetting hardware.</p>
					</div>
					<div className="app-panel-muted rounded-3xl p-4">
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">For continuity</p>
						<h3 className="mt-2 text-sm font-semibold text-white">Restore instead of starting again</h3>
						<p className="mt-2 text-sm text-white/66">Use a trusted backup when you want the same identity, trust history, and future backups to continue here.</p>
					</div>
				</div>

				<div className="app-panel-muted space-y-5 p-4 sm:p-5">
					<div>
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Export</p>
						<h3 className="mt-2 text-base font-semibold text-white">Create an encrypted backup for continuity</h3>
						<p className="mt-1 text-sm text-white/65">Wallet-like flow. Generate secure mnemonic or bring your own passphrase. Backup stays encrypted and cannot be restored without exact passphrase.</p>
					</div>

					<RenderIf condition={exportSupported}
						then={<>
							<div className="app-panel rounded-3xl p-4 sm:p-5">
								<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
									<div>
										<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Passphrase mode</p>
										<h4 className="mt-2 text-sm font-semibold text-white">Choose how backup passphrase will be created</h4>
										<p className="mt-1 text-sm text-white/60">Generated mode is preferred. Manual mode stays blocked unless zxcvbn reaches maximum score.</p>
									</div>
									<div className="grid grid-cols-2 gap-2 sm:min-w-80">
										<SmallGenericButton
											onClick={handleGeneratedModeSelection}
											disabled={isExporting}
											className={getModeButtonClassName(passphraseMode === 'generated')}
										>
											Generate secure
										</SmallGenericButton>
										<SmallGenericButton
											onClick={handleManualModeSelection}
											disabled={isExporting}
											className={getModeButtonClassName(passphraseMode === 'manual')}
										>
											Use my own password
										</SmallGenericButton>
									</div>
								</div>
							</div>

							<RenderIf
								condition={passphraseMode === 'generated'}
								then={
									<div className="space-y-4 rounded-3xl border border-primary-400/18 bg-[linear-gradient(180deg,rgba(8,25,40,0.92),rgba(7,15,25,0.98))] p-4 sm:p-5">
										<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
											<div>
												<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Generated mnemonic</p>
												<h4 className="mt-2 text-sm font-semibold text-white">12-word BIP39 backup passphrase</h4>
												<p className="mt-1 text-sm text-white/60">Write it down exactly. Export stays blocked until sampled words are confirmed.</p>
											</div>
											<div className="flex flex-wrap gap-2">
												<SmallGenericButton
													onClick={handleGeneratePassphrase}
													disabled={isExporting}
												>
													<RenderIf condition={generatedWords.length > 0} then="Generate new words" otherwise="Generate words" />
												</SmallGenericButton>
												<SmallGenericButton
													onClick={handleCopyGeneratedPassphraseClick}
													disabled={generatedPassphrase.length === 0 || isExporting}
												>
													Copy
												</SmallGenericButton>
											</div>
										</div>

										<RenderIf
											condition={generatedWords.length > 0}
											then={
												<>
													<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
														{generatedWords.map((word, index) => (
															<div key={`${word}-${index}`} className="rounded-2xl border border-white/8 bg-dark-300/72 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
																<p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary-100/76">Word {index + 1}</p>
																<p className="mt-2 text-base font-semibold text-white">{word}</p>
															</div>
														))}
													</div>

													<div className="app-panel-muted space-y-4 p-4">
														<div>
															<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Active confirmation</p>
															<h5 className="mt-2 text-sm font-semibold text-white">Confirm sampled words</h5>
															<p className="mt-1 text-sm text-white/60">Enter requested words exactly as shown above.</p>
														</div>
														<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
															{generatedConfirmationIndexes.map((wordIndex, inputIndex) => (
																<div key={wordIndex}>
																	<label className="app-text-muted mb-1 block text-sm">Word {wordIndex + 1}</label>
																	<Input
																		value={generatedConfirmationValues[inputIndex] ?? ''}
																		onChange={(event) => handleGeneratedConfirmationChange(inputIndex, event.target.value)}
																		placeholder={`Enter word ${wordIndex + 1}`}
																	/>
																</div>
															))}
														</div>
														<p className={`text-sm ${generatedPassphraseState.confirmed ? 'text-emerald-200' : 'text-white/62'}`}>
															{generatedPassphraseState.statusMessage}
														</p>
													</div>
												</>
											}
											otherwise={
												<div className="rounded-3xl border border-dashed border-white/12 bg-white/4 px-4 py-5 text-sm text-white/62">
													Generate secure words first. App will sample 3 positions for confirmation before export unlocks.
												</div>
											}
										/>

										<RenderIf condition={copyStatus !== null}
											then={copyStatus ? <StatusMessage message={copyStatus} /> : null}
											otherwise={null}
										/>
									</div>
								}
								otherwise={
									<div className="space-y-4 rounded-3xl border border-white/10 bg-white/4 p-4 sm:p-5">
										<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
											<div>
												<label className="app-text-muted mb-1 block text-sm" htmlFor="backup-manual-passphrase">Manual passphrase</label>
												<Input
													id="backup-manual-passphrase"
													value={manualPassphrase}
													onChange={(event) => handleManualPassphraseChange(event.target.value)}
													placeholder="Use 20+ characters or 12 words"
													type="password"
												/>
											</div>
											<div>
												<label className="app-text-muted mb-1 block text-sm" htmlFor="backup-manual-passphrase-confirm">Confirm passphrase</label>
												<Input
													id="backup-manual-passphrase-confirm"
													value={manualPassphraseConfirm}
													onChange={(event) => handleManualPassphraseConfirmChange(event.target.value)}
													placeholder="Confirm the passphrase"
													type="password"
												/>
											</div>
										</div>

										<div className="app-panel-muted space-y-4 p-4">
											<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
												<div>
													<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Manual strength gate</p>
													<h5 className="mt-2 text-sm font-semibold text-white">Need maximum zxcvbn score to export</h5>
												</div>
												<p className={`text-sm font-semibold ${manualPassphraseState.strengthClassName}`}>
													{manualPassphraseState.strengthSummary}
												</p>
											</div>

											<div className="grid grid-cols-5 gap-2">
												{BACKUP_SCORE_STEPS.map((scoreIndex) => (
													<div
														key={scoreIndex}
														className={`h-2 rounded-full ${getManualScoreStepClassName(manualPassphraseState.evaluation.score, scoreIndex)}`}
													/>
												))}
											</div>

											<p className={`text-sm ${manualPassphraseState.feedback.className}`}>
												{manualPassphraseState.feedback.message}
											</p>

											<RenderIf condition={manualPassphraseState.crackTimeSummary !== null}
												then={<p className="text-xs text-white/55">{manualPassphraseState.crackTimeSummary}</p>}
												otherwise={null}
											/>
											<RenderIf condition={manualPassphraseConfirm.length > 0 && !manualPassphraseState.confirmed}
												then={<p className="text-xs text-rose-200">Confirmation must match exact passphrase.</p>}
												otherwise={null}
											/>
										</div>
									</div>
								}
							/>

							<div className="rounded-3xl border border-amber-300/20 bg-[linear-gradient(180deg,rgba(120,53,15,0.16),rgba(9,14,24,0.92))] p-4 text-sm text-amber-50/88">
								Lose passphrase = lose restore path. Keep one offline copy you control before exporting.
							</div>

							<div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
								<GenericButton
									onClick={handleIdentityExportClick}
									disabled={exportUiState.actionsDisabled}
								>
									<RenderIf condition={activeExportKind === 'identity'} then="Exporting identity..." otherwise="Export Identity Backup" />
								</GenericButton>
								<GenericButton
									onClick={handleFullExportClick}
									disabled={exportUiState.actionsDisabled}
								>
									<RenderIf condition={activeExportKind === 'full'} then="Exporting full backup..." otherwise="Export Full Backup" />
								</GenericButton>
								<SmallGenericButton onClick={handleCancelExport}
									disabled={!isExporting}
									className="w-full justify-center"
								>
									Cancel export
								</SmallGenericButton>
							</div>

							<RenderIf condition={isExporting ? exportProgress !== null : false}
								then={
									<div className="app-panel space-y-3 p-4">
										<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<div>
												<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Export progress</p>
												<p className="mt-1 text-sm font-medium text-white">{getProgressLabel(exportProgress)}</p>
											</div>
											<p className="text-sm font-semibold text-primary-100">{exportUiState.progressPercent}%</p>
										</div>
										<div className="h-2 overflow-hidden rounded-full bg-dark-300">
											<div className="h-full rounded-full bg-primary-400 transition-[width] duration-200" style={{ width: `${exportUiState.progressPercent}%` }} />
										</div>
										<div className="flex flex-col gap-1 text-xs text-white/58 sm:flex-row sm:flex-wrap sm:gap-3">
											<RenderIf condition={exportUiState.itemProgressLabel !== null}
												then={<span>{exportUiState.itemProgressLabel}</span>}
												otherwise={null}
											/>
											<RenderIf condition={exportUiState.byteProgressLabel !== null}
												then={<span>{exportUiState.byteProgressLabel}</span>}
												otherwise={null}
											/>
										</div>
									</div>
								}
								otherwise={null}
							/>
						</>
						}
						otherwise={
							<div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-white/72">
								{UNSUPPORTED_BACKUP_EXPORT_MESSAGE}
							</div>
						}
					/>

					<RenderIf condition={backupError !== null}
						then={backupError ? <ErrorMessage message={backupError} /> : null}
						otherwise={null}
					/>
					<RenderIf condition={backupStatus !== null}
						then={backupStatus ? <StatusMessage message={backupStatus} /> : null}
						otherwise={null}
					/>
				</div>

				<div className="app-panel-muted space-y-4 p-4 sm:p-5">
					<div>
						<p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/55">Restore</p>
						<h3 className="mt-2 text-base font-semibold text-white">Continue an existing identity on this device</h3>
						<p className="mt-1 text-sm text-white/65">Use restore when you are moving to a new device or recovering after reinstalling and you want the same trusted identity to continue here.</p>
					</div>

					<RestoreBackupPanel
						disabled={isExporting}
						onBusyChange={setIsRestoringBackup}
					/>
				</div>
			</div>

		</section>
	);
};

export default BackupSettings;