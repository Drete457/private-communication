import { useRef } from 'react';


import { Close, Send } from '@/assets';
import { getAttachmentStateTextColor } from '@/helpers/attachments';
import { useVoiceNoteRecorder } from '@/helpers/media';
import { getReplyPreviewText, replyAuthor } from '@/helpers/messages';
import { RenderIf } from '@/helpers/render-conditional';
import { useChatDraft } from '@/hooks/use-chat-draft';
import { useAuthStore } from '@/store/auth-store';
import type { AttachmentSelection, AttachmentSelectionResult, AttachmentState, DecryptedMessage } from '@/types';

import { SmallGenericButton } from '@components/common/buttons/generic';
import { TextArea } from '@components/common/text/text-area';

import MessageInputActions from './message-input-actions';
import VoiceNoteRecorder from './voice-note-recorder';

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, FC } from 'react';

interface MessageInputProps {
	onSend: (content: string) => void;
	onAttachFiles?: ((files: AttachmentSelection) => Promise<AttachmentSelectionResult> | AttachmentSelectionResult) | undefined;
	onOpenRecentGifs?: (() => void) | undefined;
	replyTo?: DecryptedMessage | null | undefined;
	onCancelReply?: (() => void) | undefined;
	onDismissAttachmentFeedback?: (() => void) | undefined;
	onOpenAttachmentDetails?: (() => void) | undefined;
	disabled?: boolean | undefined;
	peerId: string;
	peerDisplayName?: string | undefined;
	attachmentState?: AttachmentState | undefined;
	attachmentMessage?: string | undefined;
	hasAttachmentDetails?: boolean | undefined;
}

const getVoiceComposerButtonState = (isVoiceRecording: boolean, canRecordVoice: boolean) => ({
	show: canRecordVoice || isVoiceRecording,
	title: isVoiceRecording ? 'Stop voice recording' : 'Start voice recording',
	label: isVoiceRecording ? 'Stop' : 'Mic'
});

const MessageInput: FC<MessageInputProps> = ({
	onSend,
	onAttachFiles,
	onOpenRecentGifs,
	replyTo,
	onCancelReply,
	onDismissAttachmentFeedback,
	onOpenAttachmentDetails,
	disabled,
	peerId,
	peerDisplayName,
	attachmentState,
	attachmentMessage,
	hasAttachmentDetails = false
}) => {
	const { userId } = useAuthStore();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { message, setMessage, clearMessage } = useChatDraft({ userId, peerId });
	const voiceRecorder = useVoiceNoteRecorder({
		onAttachFiles,
		disabled,
		attachmentState
	});

	const handleSend = () => {
		if (message.trim() && !disabled) {
			onSend(message.trim());
			clearMessage();
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	};

	const keepInputFocus = (event: ReactMouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
	};

	const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const voiceComposerButton = getVoiceComposerButtonState(
		voiceRecorder.isVoiceRecording,
		voiceRecorder.canRecordVoice
	);

	return (
		<div className="border-t border-dark-300/80 bg-dark-200/84 px-3 py-3 backdrop-blur-xl sm:px-4 sm:py-4">
			<div className="app-panel rounded-[1.65rem] px-3 py-3 sm:px-4 sm:py-4">
				<RenderIf condition={replyTo !== undefined && replyTo !== null}
					then={
						<div className="app-panel-muted mb-3 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2">
							<div className="min-w-0">
								<p className="text-xs font-semibold text-primary-200">Replying to {replyAuthor(replyTo?.senderId, userId, peerDisplayName)}</p>
								<p className="text-xs text-gray-300 line-clamp-2 wrap-break-words">{replyTo ? getReplyPreviewText(replyTo) : ''}</p>
							</div>
							<SmallGenericButton
								title="Cancel reply"
								onClick={() => onCancelReply?.()}
							>
								<Close className="h-4 w-4" />
							</SmallGenericButton>
						</div>
					}
					otherwise={null}
				/>
				<VoiceNoteRecorder recorder={voiceRecorder} />
				<div className="flex items-center gap-2">
					<MessageInputActions
						key={`message-actions-${disabled ? 'disabled' : 'enabled'}-${attachmentState === 'uploading' ? 'uploading' : 'idle'}`}
						onAttachFiles={onAttachFiles}
						onOpenRecentGifs={onOpenRecentGifs}
						disabled={disabled}
						attachmentState={attachmentState}
					/>

					<TextArea
						ref={inputRef}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Type a message..."
						disabled={(disabled ?? false) || voiceRecorder.isVoiceRecording}
						rows={1}
						className="w-full resize-none rounded-[1.25rem] border border-white/8 bg-dark-100/46 px-3 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-gray-500 focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20 disabled:opacity-50 sm:px-4"
						style={{ minHeight: '48px', maxHeight: '120px' }}
					/>

					<RenderIf
						condition={voiceComposerButton.show}
						then={
							<SmallGenericButton
								title={voiceComposerButton.title}
								onMouseDown={keepInputFocus}
								onPointerDown={keepInputFocus}
								onClick={voiceRecorder.isVoiceRecording ? voiceRecorder.stopVoiceRecording : voiceRecorder.startVoiceRecording}
								disabled={voiceRecorder.isVoiceRecording ? !voiceRecorder.canStopVoiceRecording : !voiceRecorder.canRecordVoice}
								className={voiceRecorder.isVoiceRecording
									? 'min-h-12 min-w-16 border-red-400/30 bg-red-500/20 text-red-100 enabled:hover:bg-red-500/30'
									: 'min-h-12 min-w-12 border-white/8 bg-dark-100/70 text-gray-100 enabled:hover:bg-dark-100'}
							>
								{voiceComposerButton.label}
							</SmallGenericButton>
						}
						otherwise={null}
					/>

					<SmallGenericButton
						title="Send message"
						onMouseDown={keepInputFocus}
						onPointerDown={keepInputFocus}
						onClick={handleSend}
						disabled={(disabled ?? false) || voiceRecorder.isVoiceRecording || !message.trim()}
						className="min-h-12 min-w-12 border-primary-400/30 bg-primary-500/14 text-primary-50 enabled:hover:bg-primary-500/22"
					>
						<Send className="h-4.5 w-4.5" />
					</SmallGenericButton>
				</div>
				<RenderIf
					condition={attachmentMessage !== undefined && attachmentMessage.length > 0}
					then={
						<div className="mt-3 flex items-center justify-between gap-3 border-t border-white/6 pt-3">
							<p className={`min-w-0 flex-1 text-xs ${getAttachmentStateTextColor(attachmentState ?? null)}`}>
								{attachmentMessage}
							</p>
							<div className="flex shrink-0 gap-2">
								<RenderIf
									condition={hasAttachmentDetails ? onOpenAttachmentDetails !== undefined : false}
									then={
										<SmallGenericButton title="View upload details" onClick={() => onOpenAttachmentDetails?.()} className="text-xs">
											Details
										</SmallGenericButton>
									}
									otherwise={null}
								/>
								<RenderIf
									condition={onDismissAttachmentFeedback !== undefined}
									then={
										<SmallGenericButton title="Dismiss attachment feedback" onClick={() => onDismissAttachmentFeedback?.()} className="text-xs">
											Dismiss
										</SmallGenericButton>
									}
									otherwise={null}
								/>
							</div>
						</div>
					}
					otherwise={null}
				/>
			</div>
		</div>
	);
}

export default MessageInput;