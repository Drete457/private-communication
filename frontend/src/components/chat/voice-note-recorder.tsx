

import type { UseVoiceNoteRecorderResult } from '@/helpers/media';
import { formatFileSize  } from '@/helpers/media';
import { RenderIf } from '@/helpers/render-conditional';

import { SmallGenericButton } from '@components/common/buttons/generic';

import type { FC } from 'react';

interface VoiceNoteRecorderProps {
	recorder: UseVoiceNoteRecorderResult;
}

const getWaveformBarHeight = (level: number): string => `${Math.max(10, Math.round(level * 100))}%`;

const VoiceNoteRecorder: FC<VoiceNoteRecorderProps> = ({ recorder }) => {
	const {
		discardVoiceNote,
		feedbackMessage,
		isSendingVoiceNote,
		isVoiceRecording,
		recordingLimitLabel,
		sendVoiceNote,
		voiceNoteDraft,
		voiceWaveformBars,
		voiceRecordingProgress,
		voiceRecordingStatusText
	} = recorder;

	return (
		<>
			<RenderIf
				condition={isVoiceRecording}
				then={
					<div className="mb-3 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
						<div className="flex items-start gap-3">
							<div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-300" />
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold text-white">Recording voice note</p>
								<p className="mt-1 text-xs text-red-100/85">{voiceRecordingStatusText}</p>
								<RenderIf
									condition={recordingLimitLabel.length > 0}
									then={<p className="mt-2 text-xs text-red-100/70">{recordingLimitLabel}</p>}
									otherwise={null}
								/>
							</div>
						</div>
						<div className="mt-3 flex h-14 items-end gap-1 overflow-hidden rounded-xl border border-white/8 bg-black/10 px-2 py-2">
							{voiceWaveformBars.map((level, index) => (
								<div
									key={index}
									className="flex-1 rounded-full bg-linear-to-t from-red-300/70 to-red-100 transition-[height,opacity] duration-75"
									style={{
										height: getWaveformBarHeight(level),
										opacity: Math.max(0.35, level)
									}}
								/>
							))}
						</div>
						<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
							<div className="h-full rounded-full bg-red-300 transition-all" style={{ width: `${voiceRecordingProgress}%` }} />
						</div>
					</div>
				}
				otherwise={null}
			/>
			<RenderIf
				condition={voiceNoteDraft !== null}
				then={
					<div className="app-panel-muted mb-3 px-4 py-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-sm font-semibold text-white">Voice note ready</p>
								<p className="mt-1 text-xs text-gray-300">Listen back, then send it or discard it.</p>
								<p className="mt-2 text-xs text-gray-400">
									{voiceNoteDraft?.file.name} • {formatFileSize(voiceNoteDraft?.file.size ?? 0)}
								</p>
							</div>
							<div className="flex shrink-0 gap-2 self-start">
								<SmallGenericButton
									title="Discard voice note"
									onClick={discardVoiceNote}
									disabled={isSendingVoiceNote}
									className="bg-dark-100 enabled:hover:bg-dark-50"
								>
									Discard
								</SmallGenericButton>
								<SmallGenericButton
									title="Send voice note"
									onClick={() => void sendVoiceNote()}
									disabled={isSendingVoiceNote}
								>
									{isSendingVoiceNote ? 'Sending...' : 'Send'}
								</SmallGenericButton>
							</div>
						</div>
						<audio controls preload="metadata" className="mt-3 w-full" src={voiceNoteDraft?.previewUrl} />
						<RenderIf
							condition={recordingLimitLabel.length > 0}
							then={<p className="mt-2 text-xs text-gray-400">{recordingLimitLabel}</p>}
							otherwise={null}
						/>
					</div>
				}
				otherwise={null}
			/>
			<RenderIf
				condition={feedbackMessage.length > 0}
				then={
					<p className="app-panel-muted mt-2 px-3 py-2 text-xs text-gray-300">
						{feedbackMessage}
					</p>
				}
				otherwise={null}
			/>
		</>
	);
};

export default VoiceNoteRecorder;