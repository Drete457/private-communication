import { useEffect, useRef, useState } from 'react';

import { RedButton } from '@/components/common/buttons/red';
import { ErrorMessage } from '@/components/common/messages/error';
import { StatusMessage } from '@/components/common/messages/status';
import { Modal } from '@/components/common/modal';
import { Input } from '@/components/common/text/input';
import {
	getRestoreByteProgressLabel,
	getRestoreErrorMessage,
	getRestoreItemProgressLabel,
	getRestoreProgressLabel,
	getRestoreProgressRatio,
	getRestoreSelectedFileStatus,
	getRestoreSuccessStatus,
	isPcbkBackupFile,
	RESTORE_PANEL_COPY
} from '@/helpers/backup';
import { RenderIf } from '@/helpers/render-conditional';
import { restoreBackup } from '@/services/identity-backup-service';
import type { BackupRestoreProgress } from '@/types/backup';

import type { PCBKMode } from '@private-communication/pcbk-core';
import type { ChangeEvent, FC} from 'react';

interface RestoreBackupPanelProps {
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
	onRestoreSuccess?: (mode: PCBKMode) => void | Promise<void>;
	title?: string;
	description?: string;
	surface?: 'default' | 'embedded';
	showHeader?: boolean;
}

const RestoreBackupPanel: FC<RestoreBackupPanelProps> = ({
	disabled = false,
	onBusyChange,
	onRestoreSuccess,
	title = RESTORE_PANEL_COPY.defaultTitle,
	description = RESTORE_PANEL_COPY.defaultDescription,
	surface = 'default',
	showHeader = true
}) => {
	const [restorePassphrase, setRestorePassphrase] = useState<string>('');
	const [selectedBackupFile, setSelectedBackupFile] = useState<File | null>(null);
	const [restoreProgress, setRestoreProgress] = useState<BackupRestoreProgress | null>(null);
	const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
	const [restoreError, setRestoreError] = useState<string | null>(null);
	const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);
	const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
	const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

	const restoreProgressPercent = Math.round(getRestoreProgressRatio(restoreProgress) * 100);
	const restoreItemProgressLabel = getRestoreItemProgressLabel(restoreProgress);
	const restoreByteProgressLabel = getRestoreByteProgressLabel(restoreProgress);
	const isBusy = disabled || isRestoringBackup;

	const handleChooseRestoreFile = () => {
		if (isBusy)
			return;

		restoreFileInputRef.current?.click();
	};

	const handleBackupFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0] ?? null;
		setRestoreProgress(null);

		if (file && !isPcbkBackupFile(file)) {
			setSelectedBackupFile(null);
			setRestoreStatus(null);
			setRestoreError(RESTORE_PANEL_COPY.choosePcbkFileError);
			event.target.value = '';
			return;
		}

		setSelectedBackupFile(file);
		setRestoreError(null);
		setRestoreStatus(file ? getRestoreSelectedFileStatus(file.name) : null);
	};

	const handleRequestRestore = () => {
		if (!selectedBackupFile) {
			setRestoreError(RESTORE_PANEL_COPY.chooseAnyFileError);
			setRestoreStatus(null);
			return;
		}

		if (!isPcbkBackupFile(selectedBackupFile)) {
			setRestoreError(RESTORE_PANEL_COPY.choosePcbkFileError);
			setRestoreStatus(null);
			return;
		}

		setRestoreError(null);
		setShowRestoreModal(true);
	};

	const handleRestoreBackup = async () => {
		if (!selectedBackupFile)
			return;

		setShowRestoreModal(false);
		setRestoreError(null);
		setRestoreStatus(null);
		setRestoreProgress(null);
		setIsRestoringBackup(true);

		try {
			const mode = await restoreBackup(selectedBackupFile, restorePassphrase, {
				onProgress: (progress) => {
					setRestoreProgress(progress);
					setRestoreError(null);
				}
			});
			setRestoreProgress(null);
			setRestoreStatus(getRestoreSuccessStatus(mode));

			if (onRestoreSuccess) {
				await onRestoreSuccess(mode);
			} else {
				window.location.reload();
			}
		} catch (error) {
			setRestoreProgress(null);
			setRestoreError(getRestoreErrorMessage(error));
		} finally {
			setIsRestoringBackup(false);
		}
	};

	const getContainerClassName = () => {
		if (surface === 'embedded')
			return 'space-y-4';

		return 'rounded-xl border border-white/5 bg-dark-300/40 p-4';
	};

	const getFilePickerLayoutClassName = () => {
		if (surface === 'embedded')
			return 'flex flex-col gap-3';

		return 'flex flex-col gap-3 md:flex-row md:items-center';
	};

	const getChooseFileButtonClassName = () => {
		const stateClassName = isBusy
			? 'cursor-not-allowed bg-primary-700/50 text-white/70'
			: 'bg-primary-700 text-white hover:bg-primary-600';

		if (surface === 'embedded')
			return `w-full rounded-lg px-4 py-3 font-bold transition-all sm:w-auto sm:min-w-44 ${stateClassName}`;

		return `w-full rounded-lg px-4 py-3 font-bold transition-all md:w-auto ${stateClassName}`;
	};

	const getSelectedFileLabelClassName = () => {
		const toneClassName = selectedBackupFile ? 'text-white/80' : 'text-gray-300';

		if (surface === 'embedded')
			return `text-sm break-all ${toneClassName}`;

		return `text-sm ${toneClassName}`;
	};

	useEffect(() => {
		onBusyChange?.(isRestoringBackup);
	}, [isRestoringBackup, onBusyChange]);

	return (
		<div className={getContainerClassName()}>
			<div className="flex flex-col gap-3">
				<RenderIf
					condition={showHeader}
					then={
						<div>
							<h3 className="text-sm font-semibold text-white">{title}</h3>
							<p className="mt-1 text-sm text-gray-400">{description}</p>
						</div>
					}
					otherwise={null}
				/>
				<input
					ref={restoreFileInputRef}
					type="file"
					accept=".pcbk"
					className="hidden"
					onChange={handleBackupFileSelection}
					disabled={isBusy}
				/>
				<div className={getFilePickerLayoutClassName()}>
					<button
						type="button"
						onClick={handleChooseRestoreFile}
						disabled={isBusy}
						className={getChooseFileButtonClassName()}
					>
						{RESTORE_PANEL_COPY.chooseFileButton}
					</button>
					<span className={getSelectedFileLabelClassName()}>
						<RenderIf condition={selectedBackupFile !== null}
							then={selectedBackupFile?.name}
							otherwise={RESTORE_PANEL_COPY.noFileSelected} 
						/>
					</span>
				</div>
				<div>
					<label className="mb-1 block text-sm text-gray-400" htmlFor="restore-passphrase">{RESTORE_PANEL_COPY.passphraseLabel}</label>
					<Input
						id="restore-passphrase"
						value={restorePassphrase}
						onChange={(event) => setRestorePassphrase(event.target.value)}
						placeholder={RESTORE_PANEL_COPY.passphrasePlaceholder}
						type="password"
					/>
				</div>
				<RenderIf condition={isRestoringBackup ? restoreProgress !== null : false}
					then={
						<div className="app-panel space-y-3 p-4">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary-100">{RESTORE_PANEL_COPY.progressTitle}</p>
									<p className="mt-1 text-sm font-medium text-white">{getRestoreProgressLabel(restoreProgress)}</p>
								</div>
								<p className="text-sm font-semibold text-primary-100">{restoreProgressPercent}%</p>
							</div>
							<div className="h-2 overflow-hidden rounded-full bg-dark-300">
								<div className="h-full rounded-full bg-primary-400 transition-[width] duration-200" style={{ width: `${restoreProgressPercent}%` }} />
							</div>
							<div className="flex flex-col gap-1 text-xs text-white/58 sm:flex-row sm:flex-wrap sm:gap-3">
								<RenderIf condition={restoreItemProgressLabel !== null}
									then={<span>{restoreItemProgressLabel}</span>}
									otherwise={null}
								/>
								<RenderIf condition={restoreByteProgressLabel !== null}
									then={<span>{restoreByteProgressLabel}</span>}
									otherwise={null}
								/>
							</div>
						</div>
					}
					otherwise={null}
				/>
				<RedButton onClick={handleRequestRestore}
					disabled={isBusy}
				>
					<RenderIf condition={isRestoringBackup}
						then={RESTORE_PANEL_COPY.restoringAction}
						otherwise={RESTORE_PANEL_COPY.restoreAction}
					/>
				</RedButton>

				<RenderIf condition={restoreError !== null}
					then={restoreError ? <ErrorMessage message={restoreError} /> : null}
					otherwise={null}
				/>
				<RenderIf condition={restoreStatus !== null}
					then={restoreStatus ? <StatusMessage message={restoreStatus} /> : null}
					otherwise={null}
				/>
			</div>

			<RenderIf condition={showRestoreModal}
				then={<Modal
					active={showRestoreModal}
					setActive={setShowRestoreModal}
					title={RESTORE_PANEL_COPY.modalTitle}
					message={RESTORE_PANEL_COPY.modalMessage}
					AcceptButton={
						<RedButton
							onClick={() => void handleRestoreBackup()}
							disabled={isBusy}
						>
							<RenderIf condition={isRestoringBackup}
								then={RESTORE_PANEL_COPY.modalRestoring}
								otherwise={RESTORE_PANEL_COPY.modalAccept}
							/>
						</RedButton>
					}
				/>}
				otherwise={null}
			/>
		</div>
	);
};

export default RestoreBackupPanel;