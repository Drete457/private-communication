import { useEffect, useMemo, useRef, useState } from 'react';

import { clientLogger } from '@/services/logger';

type UseLiveAudioWaveformOptions = {
	isActive: boolean;
	previewAudioStream: MediaStream | null;
	onSample?: (timestampMs: number) => void;
};

const VOICE_WAVEFORM_BAR_COUNT = 28;
const VOICE_WAVEFORM_IDLE_LEVEL = 0.08;
const VOICE_WAVEFORM_SAMPLE_INTERVAL_MS = 80;

const createVoiceWaveformBars = (): number[] => Array.from(
	{ length: VOICE_WAVEFORM_BAR_COUNT },
	() => VOICE_WAVEFORM_IDLE_LEVEL
);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const appendVoiceWaveformLevel = (bars: ReadonlyArray<number>, nextLevel: number): number[] => {
	const nextBars = bars.length >= VOICE_WAVEFORM_BAR_COUNT
		? bars.slice(-(VOICE_WAVEFORM_BAR_COUNT - 1))
		: [...bars];

	nextBars.push(nextLevel);

	while (nextBars.length < VOICE_WAVEFORM_BAR_COUNT)
		nextBars.unshift(VOICE_WAVEFORM_IDLE_LEVEL);

	return nextBars;
};

const getVoiceWaveformLevel = (analyser: AnalyserNode, timeDomainData: Uint8Array): number => {
	analyser.getByteTimeDomainData(timeDomainData as Uint8Array<ArrayBuffer>);

	let sumOfSquares = 0;
	for (const sample of timeDomainData) {
		const centeredSample = (sample - 128) / 128;
		sumOfSquares += centeredSample * centeredSample;
	}

	const rms = Math.sqrt(sumOfSquares / timeDomainData.length);
	return clamp(rms * 4.5, VOICE_WAVEFORM_IDLE_LEVEL, 1);
};

const getAudioContextConstructor = (): typeof AudioContext | undefined => (
	(globalThis as typeof globalThis & {
		AudioContext?: typeof AudioContext;
		webkitAudioContext?: typeof AudioContext;
	}).AudioContext
	?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext; }).webkitAudioContext
);

const getPreviewAudioTrackIds = (previewAudioStream: MediaStream | null): string => (
	previewAudioStream ? previewAudioStream.getAudioTracks().map((track) => track.id).join(',') : ''
);

const useLiveAudioWaveform = ({ isActive, previewAudioStream, onSample }: UseLiveAudioWaveformOptions): ReadonlyArray<number> => {
	const [voiceWaveformBars, setVoiceWaveformBars] = useState<number[]>(() => createVoiceWaveformBars());
	const onSampleRef = useRef<typeof onSample>(onSample);
	const previewAudioStreamRef = useRef<MediaStream | null>(null);
	const idleVoiceWaveformBars = useMemo(() => createVoiceWaveformBars(), []);
	const previewAudioTrackIds = useMemo(
		() => getPreviewAudioTrackIds(previewAudioStream),
		[previewAudioStream]
	);

	useEffect(() => {
		onSampleRef.current = onSample;
	}, [onSample]);

	useEffect(() => {
		previewAudioStreamRef.current = previewAudioStream;
	}, [previewAudioStream]);

	useEffect(() => {
		if (!isActive)
			return;

		const activePreviewAudioStream = previewAudioStreamRef.current;
		if (!activePreviewAudioStream || previewAudioTrackIds.length === 0)
			return;

		const AudioContextConstructor = getAudioContextConstructor();
		if (!AudioContextConstructor)
			return;

		const audioContext = new AudioContextConstructor();
		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.82;

		const sourceNode = audioContext.createMediaStreamSource(activePreviewAudioStream);
		sourceNode.connect(analyser);

		const timeDomainData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
		let animationFrameId = 0;
		let lastSampleAt = 0;

		const sampleWaveform = (timestamp: number) => {
			animationFrameId = window.requestAnimationFrame(sampleWaveform);

			if (timestamp - lastSampleAt < VOICE_WAVEFORM_SAMPLE_INTERVAL_MS)
				return;

			lastSampleAt = timestamp;
			onSampleRef.current?.(timestamp);
			setVoiceWaveformBars((currentBars) => appendVoiceWaveformLevel(
				currentBars,
				getVoiceWaveformLevel(analyser, timeDomainData)
			));
		};

		void audioContext.resume().catch((error: unknown) => {
			clientLogger.debug('Failed to resume audio context for waveform:', error);
		});
		animationFrameId = window.requestAnimationFrame(sampleWaveform);

		return () => {
			window.cancelAnimationFrame(animationFrameId);
			sourceNode.disconnect();
			analyser.disconnect();
			void audioContext.close().catch((error: unknown) => {
				clientLogger.debug('Failed to close audio context for waveform:', error);
			});
		};
	}, [isActive, previewAudioTrackIds]);

	return isActive ? voiceWaveformBars : idleVoiceWaveformBars;
};

export { useLiveAudioWaveform };