import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useReactMediaRecorder } from 'react-media-recorder';

import { getAttachmentPoliciesSnapshot, subscribeAttachmentPolicies } from '@/services/attachment-policy';
import type { AttachmentSelection, AttachmentSelectionResult, AttachmentState } from '@/types';

import { buildVoiceNoteFileName, getSupportedAudioRecordingConfig } from './audio-recording';
import { formatFileSize } from './format-file-size';
import { useLiveAudioWaveform } from './use-live-audio-waveform';
import { useScreenWakeLock } from './use-screen-wake-lock';

type VoiceNoteDraft = {
	file: File;
	previewUrl: string;
};

type UseVoiceNoteRecorderOptions = {
	onAttachFiles?: ((files: AttachmentSelection) => Promise<AttachmentSelectionResult> | AttachmentSelectionResult) | undefined;
	disabled?: boolean | undefined;
	attachmentState?: AttachmentState | undefined;
};

type UseVoiceNoteRecorderResult = {
	canRecordVoice: boolean;
	isVoiceRecording: boolean;
	voiceWaveformBars: ReadonlyArray<number>;
	startVoiceRecording: () => void;
	stopVoiceRecording: () => void;
	canStopVoiceRecording: boolean;
	voiceRecordingStatusText: string;
	voiceRecordingProgress: number;
	voiceNoteDraft: VoiceNoteDraft | null;
	discardVoiceNote: () => void;
	sendVoiceNote: () => Promise<void>;
	isSendingVoiceNote: boolean;
	recordingLimitLabel: string;
	feedbackMessage: string;
};

const RECORDER_ERROR_MESSAGES: Partial<Record<string, string>> = {
	permission_denied: 'Microphone access is blocked on this device.',
	media_aborted: 'The recording stopped before it could be saved.',
	media_in_use: 'The microphone is being used by another app or tab.',
	invalid_media_constraints: 'This microphone setup is not supported here.',
	no_specified_media_found: 'No microphone was detected on this device.',
	recorder_error: 'This browser could not start audio recording.'
};

const formatDuration = (durationMs: number): string => {
	const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
};

const isVoiceRecordingStatus = (recorderStatus: string): boolean => (
	recorderStatus === 'acquiring_media'
	|| recorderStatus === 'recording'
	|| recorderStatus === 'stopping'
);

const getVoiceRecordingRemainingMs = (maxDurationMs: number | undefined, elapsedMs: number): number => (
	Math.max(0, (maxDurationMs ?? 0) - elapsedMs)
);

const getVoiceRecordingProgress = (maxDurationMs: number | undefined, elapsedMs: number): number => {
	if (!maxDurationMs)
		return 0;

	return Math.min(100, (elapsedMs / maxDurationMs) * 100);
};

const getRecorderErrorMessage = (recorderError: string): string => (
	recorderError ? (RECORDER_ERROR_MESSAGES[recorderError] ?? 'Unable to record audio in this browser.') : ''
);

const getVoiceRecordingStatusText = (
	recorderStatus: string,
	voiceRecordingElapsedMs: number,
	voiceRecordingRemainingMs: number
): string => {
	if (recorderStatus === 'acquiring_media')
		return 'Waiting for microphone access...';

	if (recorderStatus === 'stopping')
		return 'Saving your voice note...';

	return `${formatDuration(voiceRecordingElapsedMs)} recorded, ${formatDuration(voiceRecordingRemainingMs)} left`;
};

const canRecordVoiceNote = ({
	audioRecordingConfig,
	disabled,
	attachmentState,
	isSendingVoiceNote,
	isVoiceRecording,
	voiceNoteDraft
}: {
	audioRecordingConfig: { maxDurationMs: number; safeMaxBytes: number; } | null;
	disabled?: boolean | undefined;
	attachmentState?: AttachmentState | undefined;
	isSendingVoiceNote: boolean;
	isVoiceRecording: boolean;
	voiceNoteDraft: VoiceNoteDraft | null;
}): boolean => Boolean(
	audioRecordingConfig
	&& !disabled
	&& attachmentState !== 'uploading'
	&& !isSendingVoiceNote
	&& !isVoiceRecording
	&& !voiceNoteDraft
);

const useVoiceNoteRecorder = ({ onAttachFiles, disabled, attachmentState }: UseVoiceNoteRecorderOptions): UseVoiceNoteRecorderResult => {
	const [voiceNoteDraft, setVoiceNoteDraft] = useState<VoiceNoteDraft | null>(null);
	const [voiceRecordingStartedAt, setVoiceRecordingStartedAt] = useState<number | null>(null);
	const [voiceRecordingElapsedMs, setVoiceRecordingElapsedMs] = useState<number>(0);
	const [voiceRecordingNotice, setVoiceRecordingNotice] = useState<string>('');
	const [isSendingVoiceNote, setIsSendingVoiceNote] = useState<boolean>(false);
	const attachmentPolicies = useSyncExternalStore(subscribeAttachmentPolicies, getAttachmentPoliciesSnapshot, getAttachmentPoliciesSnapshot);
	const audioAttachmentPolicy = useMemo(
		() => attachmentPolicies.find((policy) => policy.kind === 'audio') ?? null,
		[attachmentPolicies]
	);
	const audioRecordingConfig = useMemo(
		() => getSupportedAudioRecordingConfig(audioAttachmentPolicy),
		[audioAttachmentPolicy]
	);
	const {
		clearBlobUrl,
		error: recorderError,
		previewAudioStream,
		startRecording,
		status: recorderStatus,
		stopRecording
	} = useReactMediaRecorder({
		audio: true,
		...(audioRecordingConfig ? {
			blobPropertyBag: { type: audioRecordingConfig.mimeType },
			mediaRecorderOptions: {
				mimeType: audioRecordingConfig.mimeType,
				audioBitsPerSecond: audioRecordingConfig.audioBitsPerSecond
			}
		} : {}),
		onStart: () => {
			setVoiceRecordingNotice('');
			setVoiceRecordingStartedAt(window.performance.now());
			setVoiceRecordingElapsedMs(0);
		},
		onStop: (blobUrl, blob) => {
			setVoiceRecordingStartedAt(null);
			setVoiceRecordingElapsedMs(0);

			if (!audioRecordingConfig)
				return;

			setVoiceNoteDraft({
				file: new File([blob], buildVoiceNoteFileName(audioRecordingConfig.fileExtension), {
					type: audioRecordingConfig.mimeType,
					lastModified: Date.now()
				}),
				previewUrl: blobUrl
			});
		},
		stopStreamsOnStop: true
	});

	const isVoiceRecording = isVoiceRecordingStatus(recorderStatus);
	useScreenWakeLock({ isActive: isVoiceRecording });
	const maxVoiceRecordingDurationMs = audioRecordingConfig?.maxDurationMs;
	const maxVoiceRecordingBytes = audioRecordingConfig?.safeMaxBytes;
	const handleRecordingLimitReached = useCallback((maxDurationMs: number, safeMaxBytes: number) => {
		setVoiceRecordingElapsedMs(maxDurationMs);
		setVoiceRecordingNotice(`Maximum voice note length reached (${formatFileSize(safeMaxBytes)}).`);
		stopRecording();
	}, [stopRecording]);
	const handleWaveformSample = useCallback((sampleTimestampMs: number) => {
		if (
			voiceRecordingStartedAt === null
			|| maxVoiceRecordingDurationMs === undefined
			|| maxVoiceRecordingDurationMs <= 0
			|| maxVoiceRecordingBytes === undefined
			|| maxVoiceRecordingBytes <= 0
		)
			return;

		const elapsedMs = Math.max(0, sampleTimestampMs - voiceRecordingStartedAt);
		if (elapsedMs >= maxVoiceRecordingDurationMs) {
			handleRecordingLimitReached(maxVoiceRecordingDurationMs, maxVoiceRecordingBytes);
			return;
		}

		setVoiceRecordingElapsedMs(elapsedMs);
	}, [handleRecordingLimitReached, maxVoiceRecordingBytes, maxVoiceRecordingDurationMs, voiceRecordingStartedAt]);
	const voiceRecordingRemainingMs = getVoiceRecordingRemainingMs(maxVoiceRecordingDurationMs, voiceRecordingElapsedMs);
	const voiceRecordingProgress = getVoiceRecordingProgress(maxVoiceRecordingDurationMs, voiceRecordingElapsedMs);
	const recorderErrorMessage = getRecorderErrorMessage(recorderError);
	const voiceRecordingStatusText = getVoiceRecordingStatusText(
		recorderStatus,
		voiceRecordingElapsedMs,
		voiceRecordingRemainingMs
	);
	const voiceWaveformBars = useLiveAudioWaveform({
		isActive: isVoiceRecording,
		previewAudioStream,
		onSample: handleWaveformSample
	});
	const canRecordVoice = canRecordVoiceNote({
		audioRecordingConfig,
		disabled,
		attachmentState,
		isSendingVoiceNote,
		isVoiceRecording,
		voiceNoteDraft
	});

	const discardVoiceNote = () => {
		setVoiceNoteDraft(null);
		setVoiceRecordingStartedAt(null);
		setVoiceRecordingElapsedMs(0);
		setVoiceRecordingNotice('');
		clearBlobUrl();
	};

	const startVoiceRecording = () => {
		if (!canRecordVoice)
			return;

		discardVoiceNote();
		startRecording();
	};

	const sendVoiceNote = async () => {
		if (!voiceNoteDraft || !onAttachFiles || isSendingVoiceNote)
			return;

		setIsSendingVoiceNote(true);
		setVoiceRecordingNotice('');

		try {
			const result = await onAttachFiles([voiceNoteDraft.file]);
			if (result.successCount === result.totalCount) {
				discardVoiceNote();
				return;
			}

			setVoiceRecordingNotice('Voice note stayed on this device. Check the attachment feedback and try again.');
		} catch (error) {
			setVoiceRecordingNotice(error instanceof Error ? error.message : 'Could not send the voice note.');
		} finally {
			setIsSendingVoiceNote(false);
		}
	};

	return {
		canRecordVoice,
		isVoiceRecording,
		voiceWaveformBars,
		startVoiceRecording,
		stopVoiceRecording: stopRecording,
		canStopVoiceRecording: recorderStatus === 'recording',
		voiceRecordingStatusText,
		voiceRecordingProgress,
		voiceNoteDraft,
		discardVoiceNote,
		sendVoiceNote,
		isSendingVoiceNote,
		recordingLimitLabel: audioRecordingConfig
			? `Up to ${formatDuration(audioRecordingConfig.maxDurationMs)} or ${formatFileSize(audioRecordingConfig.safeMaxBytes)}`
			: '',
		feedbackMessage: voiceRecordingNotice || recorderErrorMessage
	};
};

export { useVoiceNoteRecorder };

export type { UseVoiceNoteRecorderResult };