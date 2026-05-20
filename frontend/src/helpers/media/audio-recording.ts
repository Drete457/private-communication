import type { AttachmentPolicy } from '@/types';

type AudioRecordingCandidate = {
	mimeType: string;
	fileExtension: string;
	audioBitsPerSecond: number;
};

type SupportedAudioRecordingConfig = AudioRecordingCandidate & {
	maxBytes: number;
	safeMaxBytes: number;
	maxDurationMs: number;
};

type NavigatorWithOptionalMediaDevices = Navigator & {
	mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
};

type GlobalAudioRecordingApis = {
	MediaRecorder?: typeof MediaRecorder;
	navigator?: NavigatorWithOptionalMediaDevices;
};

const AUDIO_RECORDING_SIZE_MARGIN_RATIO = 0.002;
const AUDIO_RECORDING_MIN_MARGIN_BYTES = 8 * 1024;

const AUDIO_RECORDING_CANDIDATES: ReadonlyArray<AudioRecordingCandidate> = [
	{
		mimeType: 'audio/webm;codecs=opus',
		fileExtension: 'webm',
		audioBitsPerSecond: 48_000
	},
	{
		mimeType: 'audio/webm',
		fileExtension: 'webm',
		audioBitsPerSecond: 48_000
	},
	{
		mimeType: 'audio/mp4',
		fileExtension: 'm4a',
		audioBitsPerSecond: 64_000
	},
	{
		mimeType: 'audio/aac',
		fileExtension: 'aac',
		audioBitsPerSecond: 64_000
	},
	{
		mimeType: 'audio/ogg;codecs=opus',
		fileExtension: 'ogg',
		audioBitsPerSecond: 48_000
	},
	{
		mimeType: 'audio/wav',
		fileExtension: 'wav',
		audioBitsPerSecond: 768_000
	}
] as const;

const matchesMimeRule = (mimeType: string, rule: string): boolean => {
	if (rule.endsWith('/'))
		return mimeType.startsWith(rule);

	return mimeType === rule;
};

const hasUserMediaSupport = (): boolean => {
	const mediaDevices = (globalThis as GlobalAudioRecordingApis).navigator?.mediaDevices;

	return typeof mediaDevices?.getUserMedia === 'function';
};

const getMediaRecorderConstructor = (): typeof MediaRecorder | undefined => (
	(globalThis as GlobalAudioRecordingApis).MediaRecorder
);

const isMimeTypeRecordable = (mimeType: string): boolean => {
	if (!hasUserMediaSupport())
		return false;

	const mediaRecorderConstructor = getMediaRecorderConstructor();
	if (!mediaRecorderConstructor)
		return mimeType === 'audio/wav';

	if (mimeType === 'audio/wav')
		return true;

	if (typeof mediaRecorderConstructor.isTypeSupported !== 'function')
		return true;

	return mediaRecorderConstructor.isTypeSupported(mimeType);
};

const buildVoiceNoteFileName = (fileExtension: string, timestamp: Date = new Date()): string => {
	const year = timestamp.getFullYear();
	const month = `${timestamp.getMonth() + 1}`.padStart(2, '0');
	const day = `${timestamp.getDate()}`.padStart(2, '0');
	const hours = `${timestamp.getHours()}`.padStart(2, '0');
	const minutes = `${timestamp.getMinutes()}`.padStart(2, '0');
	const seconds = `${timestamp.getSeconds()}`.padStart(2, '0');

	return `voice-note-${year}${month}${day}-${hours}${minutes}${seconds}.${fileExtension}`;
};

const getSupportedAudioRecordingConfig = (policy: AttachmentPolicy | null | undefined): SupportedAudioRecordingConfig | null => {
	const policyMaxBytes = policy?.maxBytes;

	if (!policy || policy.mimeRules.length === 0 || policyMaxBytes === undefined || !Number.isFinite(policyMaxBytes) || policyMaxBytes <= 0)
		return null;

	const candidate = AUDIO_RECORDING_CANDIDATES.find((currentCandidate) => (
		policy.mimeRules.some((rule) => matchesMimeRule(currentCandidate.mimeType, rule))
		&& isMimeTypeRecordable(currentCandidate.mimeType)
	));

	if (!candidate)
		return null;

	const marginBytes = Math.max(
		AUDIO_RECORDING_MIN_MARGIN_BYTES,
		Math.round(policyMaxBytes * AUDIO_RECORDING_SIZE_MARGIN_RATIO)
	);
	const safeMaxBytes = Math.max(1, policyMaxBytes - marginBytes);
	const maxDurationMs = Math.max(1_000, Math.floor((safeMaxBytes * 8 * 1_000) / candidate.audioBitsPerSecond));

	return {
		...candidate,
		maxBytes: policyMaxBytes,
		safeMaxBytes,
		maxDurationMs
	};
};

export { buildVoiceNoteFileName, getSupportedAudioRecordingConfig };

export type { SupportedAudioRecordingConfig };