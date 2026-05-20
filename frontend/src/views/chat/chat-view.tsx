import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';


import { PhoneCall, VideoCamera } from '@/assets';
import { ContactSettings, MessageInput, MessageList, PeerList } from '@/components/chat';
import { Loading } from '@/components/common/loaders';
import {
	getAttachmentForwardFailureMessage,
	getAttachmentForwardStartMessage,
	getAttachmentForwardSuccessMessage,
	getAttachmentStorageFailureMessage,
	getAttachmentTransferFeedback,
	getAttachmentTransferStatusMessage,
	getAttachmentUploadFailureMessage,
	getAttachmentUploadPartialFailureMessage,
	getAttachmentUploadSuccessMessage,
	isAttachmentNetworkErrorMessage,
	isAttachmentStorageErrorMessage,
	normalizeAttachmentTransferDisplayProgress
} from '@/helpers/attachments';
import { createReplyReference } from '@/helpers/messages';
import { navigation } from '@/helpers/navigation';
import { RenderIf } from '@/helpers/render-conditional';
import { forwardMessageAttachments, getForwardedMessageContent } from '@/services/attachment-forward-service';
import { uploadAttachment } from '@/services/attachment-upload-service';
import { clientLogger } from '@/services/logger';
import { getRecentRemoteGifs } from '@/services/remote-media-cache';
import { useAttachmentTransferStore } from '@/store/attachment-transfer-store';
import { useAuthStore } from '@/store/auth-store';
import { useCallStore } from '@/store/call-store';
import { useMessagesStore } from '@/store/messages-store';
import { usePeersStore } from '@/store/peers-store';
import type { AttachmentSelection, AttachmentSelectionResult, AttachmentState, DecryptedMessage, MessageAttachment, RemoteMediaRecord, ReplyReference, User } from '@/types';
import { AttachmentType, CallType } from '@/types';

import { AddContact } from '@components/add-contact';
import { SmallGenericButton } from '@components/common/buttons/generic';
import { AttachmentUploadDetailsModal, ForwardModal, RecentGifsModal } from '@components/common/modal';

import type { FC } from 'react';

type ForwardStatus = {
	isForwarding: boolean;
	message: string;
	progress: number;
	error: string;
};

type AttachmentUploadFailure = {
	fileName: string;
	reason: string;
};

type PeerHeaderState = {
	displayName: string;
	requiresVerification: boolean;
	presenceLabel: string;
	identityLabel: string;
};

const getNonEmptyStringOrUndefined = (value: string | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	getNonEmptyStringOrUndefined(value) ?? fallback
);

const getPeerAvatarLabel = (peerSelected: User | null): string => {
	if (!peerSelected)
		return '';

	return getNonEmptyStringOrUndefined(peerSelected.displayName?.[0])
		?? peerSelected.userId.slice(0, 2).toUpperCase();
};

const toAttachmentQueueStatusMessage = (
	fileName: string,
	progress: { phase: 'preparing' | 'encrypting' | 'uploading' | 'finalizing' | 'decrypting' | 'sending'; progress: number },
	queuePosition: { current: number; total: number; }
): string => {
	if (progress.phase === 'encrypting' || progress.phase === 'uploading' || progress.phase === 'decrypting') {
		return getAttachmentTransferStatusMessage(fileName, {
			phase: 'uploading',
			progress: progress.progress
		}, {
			queuePosition
		});
	}

	return getAttachmentTransferStatusMessage(fileName, progress, {
		queuePosition
	});
};

const getPeerHeaderState = (peerSelected: User | null): PeerHeaderState => {
	const displayName = peerSelected
		? getNonEmptyStringOrFallback(peerSelected.displayName, `User ${peerSelected.userId.slice(0, 8)}`)
		: '';
	const requiresVerification = peerSelected?.lastSeen === undefined;

	return {
		displayName,
		requiresVerification,
		presenceLabel: peerSelected?.isOnline ? 'Online now' : 'Offline',
		identityLabel: requiresVerification ? 'Identity not verified yet' : 'Identity verified'
	};
};

const ChatView: FC = () => {
	const { peerId } = useParams<{ peerId?: string }>();
	const navigate = useNavigate();
	const { userId } = useAuthStore();
	const transfers = useAttachmentTransferStore((state) => state.transfers);
	const { peers, selectedPeerId, selectPeer, loadPeers, removePeer, markPeerVerified, updateDisplayName, isLoading: peersLoading } = usePeersStore();
	const { messages, loadedPeerHistories, loadMessages, loadMore, send } = useMessagesStore();
	const { initiateCall } = useCallStore();
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [openContactSettings, setOpenContactSettings] = useState<boolean>(false);
	const [forwardOpen, setForwardOpen] = useState<boolean>(false);
	const [forwardMessage, setForwardMessage] = useState<DecryptedMessage | null>(null);
	const [forwardTargetId, setForwardTargetId] = useState<string>('');
	const [forwardStatus, setForwardStatus] = useState<ForwardStatus>({
		isForwarding: false,
		message: '',
		progress: 0,
		error: ''
	});
	const [replyToMessage, setReplyToMessage] = useState<DecryptedMessage | null>(null);
	const [attachmentState, setAttachmentState] = useState<AttachmentState>(null);
	const [attachmentMessage, setAttachmentMessage] = useState<string>('');
	const [dismissedTransferId, setDismissedTransferId] = useState<string | null>(null);
	const [attachmentFailedFiles, setAttachmentFailedFiles] = useState<AttachmentUploadFailure[]>([]);
	const [attachmentDetailsOpen, setAttachmentDetailsOpen] = useState<boolean>(false);
	const [recentGifsOpen, setRecentGifsOpen] = useState<boolean>(false);
	const [recentGifs, setRecentGifs] = useState<RemoteMediaRecord[]>([]);

	const peerSelected = useMemo<User | null>(
		() => peers.find((peer) => peer.userId === selectedPeerId) ?? null,
		[peers, selectedPeerId]
	);
	const hasSelectedPeer = peerSelected !== null;
	
	const peerHeaderState = useMemo(() => getPeerHeaderState(peerSelected), [peerSelected]);

	const selectedMessages = useMemo<ReadonlyArray<DecryptedMessage>>(
		() => (selectedPeerId ? messages.get(selectedPeerId) ?? [] : []),
		[messages, selectedPeerId]
	);

	const activeTransfer = useMemo(() => {
		if (!selectedPeerId)
			return null;

		return Object.values(transfers)
			.filter((transfer) => transfer.recipientId === selectedPeerId && transfer.source === AttachmentType.chat)
			.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
	}, [selectedPeerId, transfers]);

	const activeForwardTransfer = useMemo(() => {
		const forwardTransfers = Object.values(transfers)
			.filter((transfer) => transfer.source === AttachmentType.forward)
			.sort((left, right) => right.updatedAt - left.updatedAt);

		if (forwardTransfers.length === 0)
			return null;

		const firstForwardTransfer = forwardTransfers[0];

		if (!forwardTargetId)
			return firstForwardTransfer;

		return forwardTransfers.find((transfer) => transfer.recipientId === forwardTargetId) ?? firstForwardTransfer;
	}, [forwardTargetId, transfers]);

	const localAttachmentFeedback = useMemo(() => ({
		state: attachmentState,
		message: attachmentState === 'failed' && isAttachmentStorageErrorMessage(attachmentMessage)
			? getAttachmentStorageFailureMessage()
			: attachmentMessage
	}), [attachmentMessage, attachmentState]);

	const inputAttachmentFeedback = useMemo(() => {
		if (!activeTransfer || activeTransfer.uploadId === dismissedTransferId)
			return localAttachmentFeedback;

		if (activeTransfer.state !== 'uploading' && activeTransfer.state !== 'failed')
			return localAttachmentFeedback;

		return getAttachmentTransferFeedback({
			fileName: activeTransfer.fileName,
			phase: activeTransfer.phase,
			progress: activeTransfer.progress,
			state: activeTransfer.state,
			queueStatus: activeTransfer.queueStatus,
			retryCount: activeTransfer.retryCount,
			error: activeTransfer.error
		});
	}, [activeTransfer, dismissedTransferId, localAttachmentFeedback]);

	const clearAttachmentFeedback = useCallback(() => {
		setAttachmentState(null);
		setAttachmentMessage('');
		setAttachmentFailedFiles([]);
		setAttachmentDetailsOpen(false);
	}, []);
	const dismissAttachmentFeedback = useCallback(() => {
		if (activeTransfer)
			setDismissedTransferId(activeTransfer.uploadId);

		clearAttachmentFeedback();
	}, [activeTransfer, clearAttachmentFeedback]);

	const unreadCounts = useMemo<Readonly<Record<string, number>>>(() => {
		if (!userId)
			return {};

		const counts: Record<string, number> = {};
		messages.forEach((peerMessages, peerKey) => {
			const count = peerMessages.filter(
				message => message.senderId !== userId && message.status !== 'read' && message.senderId !== peerSelected?.userId
			).length;

			if (count > 0)
				counts[peerKey] = count;
		});

		return counts;
	}, [messages, peerSelected?.userId, userId]);

	const handleRemovePeer = async (peerIdToRemove: string) => {
		try {
			await removePeer(peerIdToRemove);
		} catch (error) {
			clientLogger.error('Failed to remove contact:', error);
		}
	};

	const handleSelectPeer = (nextPeerId: string | null) => {
		if (nextPeerId)
			void navigate(`${navigation.Chat}/${nextPeerId}`);
		else
			void navigate(navigation.Chat);
	};

	const handleSendMessage = async (content: string) => {
		if (!selectedPeerId || !content.trim())
			return;

		const replyPayload: ReplyReference | undefined = replyToMessage ? createReplyReference(replyToMessage) : undefined;
		clearAttachmentFeedback();
		try {
			await send(selectedPeerId, content, replyPayload);
			setReplyToMessage(null);
		} catch (error) {
			clientLogger.error('Failed to send message:', error);
		}
	};

	const handleAttachFiles = async (files: AttachmentSelection): Promise<AttachmentSelectionResult> => {
		if (!selectedPeerId || files.length === 0)
			return {
				totalCount: files.length,
				successCount: 0,
				failedCount: 0,
				recoverableCount: 0
			};

		setDismissedTransferId(null);
		clearAttachmentFeedback();
		const queuedFiles = Array.from(files);
		const totalFiles = queuedFiles.length;
		const firstFile = queuedFiles[0];
		if (!firstFile)
			return {
				totalCount: totalFiles,
				successCount: 0,
				failedCount: 0,
				recoverableCount: 0
			};

		const replyPayload: ReplyReference | undefined = replyToMessage ? createReplyReference(replyToMessage) : undefined;
		const failedFiles: Array<{ fileName: string; reason: string; }> = [];
		const recoverableFiles: Array<{ fileName: string; reason: string; }> = [];
		let successCount = 0;
		
		setAttachmentState('uploading');
		setAttachmentMessage(toAttachmentQueueStatusMessage(firstFile.name, {
			phase: 'preparing',
			progress: 0
		}, {
			current: 1,
			total: totalFiles
		}));

		for (const [index, file] of queuedFiles.entries()) {
			const queuePosition = {
				current: index + 1,
				total: totalFiles
			};

			try {
				await uploadAttachment(selectedPeerId, file, (progress) => {
					setAttachmentMessage(toAttachmentQueueStatusMessage(file.name, progress, queuePosition));
				}, {
					messageDispatch: {
						content: '',
						replyTo: replyPayload
					}
				});
				successCount += 1;
			} catch (error) {
				const reason = error instanceof Error ? error.message : 'Attachment upload failed';

				if (isAttachmentNetworkErrorMessage(reason)) {
					recoverableFiles.push({
						fileName: file.name,
						reason
					});
					continue;
				}

				failedFiles.push({
					fileName: file.name,
					reason
				});

				if (queuedFiles.length === 1 && isAttachmentStorageErrorMessage(reason)) {
					setAttachmentState('failed');
					setAttachmentMessage(getAttachmentStorageFailureMessage());
				}
			}
		}

		if (failedFiles.length === 0 && recoverableFiles.length === 0) {
			setAttachmentFailedFiles([]);
			setAttachmentState('uploaded');
			setAttachmentMessage(getAttachmentUploadSuccessMessage(totalFiles, queuedFiles[0]?.name));
			setReplyToMessage(null);
			return {
				totalCount: totalFiles,
				successCount,
				failedCount: 0,
				recoverableCount: 0
			};
		}

		if (failedFiles.length === 0 && recoverableFiles.length > 0) {
			setAttachmentFailedFiles([]);
			setAttachmentState(null);
			setAttachmentMessage('');
			return {
				totalCount: totalFiles,
				successCount,
				failedCount: 0,
				recoverableCount: recoverableFiles.length
			};
		}

		setAttachmentFailedFiles(failedFiles);
		setAttachmentDetailsOpen(false);

		if (successCount > 0) {
			setAttachmentState('failed');
			setAttachmentMessage(getAttachmentUploadPartialFailureMessage(successCount, totalFiles, failedFiles.length));
			setReplyToMessage(null);
			return {
				totalCount: totalFiles,
				successCount,
				failedCount: failedFiles.length,
				recoverableCount: recoverableFiles.length
			};
		}

		setAttachmentState('failed');
		setAttachmentMessage(getAttachmentUploadFailureMessage(failedFiles.length, totalFiles));

		return {
			totalCount: totalFiles,
			successCount,
			failedCount: failedFiles.length,
			recoverableCount: recoverableFiles.length
		};
	};

	const handleStartCall = async (type: CallType) => {
		if (!selectedPeerId)
			return;

		try {
			await initiateCall(selectedPeerId, type);
			void navigate(`${navigation.Call}/${selectedPeerId}`);
		} catch (error) {
			clientLogger.error('Failed to start call:', error);
		}
	};

	const renderCallActionButton = (type: CallType, className: string) => {
		const isVideoCall = type === CallType.video;

		return (
			<button
				type="button"
				onClick={() => { void handleStartCall(type); }}
				className={className}
			>
				<span className="flex h-5 w-5 items-center justify-center" aria-hidden="true">
					{isVideoCall
						? <VideoCamera className="h-[1.15rem] w-[1.15rem]" />
						: <PhoneCall className="h-[1.15rem] w-[1.15rem]" />}
				</span>
				<span>{isVideoCall ? 'Video call' : 'Audio call'}</span>
			</button>
		);
	};

	const handleVerifyPeer = async () => {
		if (!selectedPeerId)
			return;

		try {
			await markPeerVerified(selectedPeerId);
		} catch (error) {
			clientLogger.error('Failed to verify contact:', error);
		}
	};

	const handleSaveDisplayName = async (editedName: string) => {
		if (!selectedPeerId)
			return;

		try {
			await updateDisplayName(selectedPeerId, editedName.trim());
		} catch (error) {
			clientLogger.error('Failed to update contact name:', error);
		}
	};

	const handleDeletingContact = async () => {
		if (!peerSelected)
			return;

		await handleRemovePeer(peerSelected.userId);
		setOpenContactSettings(false);
		void navigate(navigation.Chat);
	};

	const openForwardModal = (message: DecryptedMessage) => {
		const availablePeers = peers.filter(peer => peer.userId !== selectedPeerId);
		const defaultTarget = availablePeers[0]?.userId ?? '';
		setForwardMessage(message);
		setForwardTargetId(defaultTarget);
		setForwardStatus({
			isForwarding: false,
			message: '',
			progress: 0,
			error: ''
		});
		setForwardOpen(true);
	};

	const handleReply = (message: DecryptedMessage) => {
		setReplyToMessage(message);
	};

	const openRecentGifs = async () => {
		setRecentGifs(await getRecentRemoteGifs());
		setRecentGifsOpen(true);
	};

	const handleSendRecentGif = async (gif: RemoteMediaRecord) => {
		if (!selectedPeerId)
			return;

		const replyPayload: ReplyReference | undefined = replyToMessage ? createReplyReference(replyToMessage) : undefined;
		clearAttachmentFeedback();
		setIsLoading(true);

		try {
			await send(selectedPeerId, gif.url, replyPayload);
			setReplyToMessage(null);
			setRecentGifsOpen(false);
		} catch (error) {
			clientLogger.error('Failed to send recent GIF:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleForward = async () => {
		if (!forwardMessage || !forwardTargetId || !userId)
			return;

		try {
			setForwardStatus({
				isForwarding: true,
				message: getAttachmentForwardStartMessage(forwardMessage.attachments?.[0]?.name),
				progress: 0,
				error: ''
			});

			const forwardedContent = getForwardedMessageContent(forwardMessage);
			const shouldAutoSendSingleAttachment = (forwardMessage.attachments?.length ?? 0) === 1;
			const forwardedAttachments: MessageAttachment[] = await forwardMessageAttachments({
				message: forwardMessage,
				targetPeerId: forwardTargetId,
				userId,
				forwardedContent,
				onProgress: (progress) => {
					setForwardStatus({
						isForwarding: true,
						message: getAttachmentTransferStatusMessage(progress.fileName, progress, {
							uploadLabel: 'Forwarding',
							sendingLabel: 'Sending'
						}),
						progress: progress.progress,
						error: ''
					});
				}
			});

			if (forwardedAttachments[0]) {
				setForwardStatus({
					isForwarding: true,
					message: getAttachmentTransferStatusMessage(forwardedAttachments[0].name, {
						phase: 'sending',
						progress: 1
					}),
					progress: 1,
					error: ''
				});
			}

			if (!shouldAutoSendSingleAttachment)
				await send(forwardTargetId, forwardedContent, undefined, forwardedAttachments.length > 0 ? forwardedAttachments : undefined);
			setForwardStatus({
				isForwarding: false,
				message: getAttachmentForwardSuccessMessage(forwardedAttachments[0]?.name),
				progress: 1,
				error: ''
			});
			setForwardOpen(false);
			setForwardMessage(null);
			setForwardTargetId('');
		} catch (error) {
			setForwardStatus((current) => ({
				...current,
				isForwarding: false,
				error: error instanceof Error ? error.message : getAttachmentForwardFailureMessage()
			}));
			clientLogger.error('Failed to forward message:', error);
		}
	};

	useEffect(() => {
		void loadPeers();
	}, [loadPeers]);

	useEffect(() => {
		const nextPeerId = peerId ?? null;

		if (selectedPeerId !== nextPeerId)
			selectPeer(nextPeerId);
	}, [peerId, selectedPeerId, selectPeer]);

	useEffect(() => {
		if (!selectedPeerId || loadedPeerHistories.has(selectedPeerId))
			return;

		void loadMessages(selectedPeerId);
	}, [loadMessages, loadedPeerHistories, selectedPeerId]);

	useEffect(() => {
		setReplyToMessage(null);
		setDismissedTransferId(null);
		clearAttachmentFeedback();
		setRecentGifsOpen(false);
		setForwardStatus({
			isForwarding: false,
			message: '',
			progress: 0,
			error: ''
		});
	}, [selectedPeerId, clearAttachmentFeedback]);

	useEffect(() => {
		if (!activeTransfer) {
			if (dismissedTransferId)
				setDismissedTransferId(null);

			return;
		}

		if (dismissedTransferId && activeTransfer.uploadId !== dismissedTransferId)
			setDismissedTransferId(null);
	}, [activeTransfer, dismissedTransferId]);

	useEffect(() => {
		if (!forwardOpen || !activeForwardTransfer)
			return;

		if (activeForwardTransfer.state === 'uploaded') {
			setForwardStatus((current) => ({
				...current,
				isForwarding: false,
				message: getAttachmentForwardSuccessMessage(activeForwardTransfer.fileName),
				progress: 1,
				error: ''
			}));
			useAttachmentTransferStore.getState().clearTransfer(activeForwardTransfer.uploadId);
			setForwardOpen(false);
			setForwardMessage(null);
			setForwardTargetId('');
			return;
		}

		if (activeForwardTransfer.state === 'failed') {
			setForwardStatus((current) => ({
				...current,
				isForwarding: false,
				message: current.message,
				progress: activeForwardTransfer.progress,
				error: activeForwardTransfer.error ?? ''
			}));
			return;
		}

		const displayProgress = normalizeAttachmentTransferDisplayProgress({
			phase: activeForwardTransfer.phase,
			progress: activeForwardTransfer.progress
		});

		setForwardStatus((current) => ({
			...current,
			isForwarding: activeForwardTransfer.state !== 'uploaded',
			message: getAttachmentTransferStatusMessage(activeForwardTransfer.fileName, displayProgress, {
				uploadLabel: 'Forwarding',
				sendingLabel: 'Sending'
			}),
			progress: displayProgress.progress,
			error: ''
		}));
	}, [activeForwardTransfer, forwardOpen]);

	useEffect(() => {
		if (attachmentState !== 'uploaded' || attachmentFailedFiles.length > 0 || !attachmentMessage)
			return;

		const timeoutId = window.setTimeout(() => {
			clearAttachmentFeedback();
		}, 8000);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [attachmentFailedFiles.length, attachmentMessage, attachmentState, clearAttachmentFeedback]);

	return (
		<div className="app-shell flex h-full min-h-0 flex-col md:flex-row">
			<aside className={`border-dark-300/80 bg-dark-200/88 backdrop-blur-xl md:flex md:w-88 md:shrink-0 md:flex-col md:border-r xl:w-96 ${hasSelectedPeer ? 'hidden md:flex' : 'flex min-h-0 flex-1 flex-col border-b md:flex-none md:border-b-0'}`}>
				<div className="border-b border-dark-300/80 px-4 py-4">
					<h2 className="app-display-title text-lg font-semibold text-white">Contacts</h2>
					<p className="app-text-muted mt-1 text-sm">Open an existing conversation or add a new trusted contact.</p>
				</div>
				<PeerList
					peers={peers}
					selectedPeerId={selectedPeerId}
					onSelectPeer={handleSelectPeer}
					unreadCounts={unreadCounts}
				/>
			</aside>

			<div className={`min-h-0 flex-1 flex-col ${hasSelectedPeer ? 'flex' : 'hidden md:flex'}`}>
				<RenderIf
					condition={hasSelectedPeer}
					then={
						<>
							<header className="border-b border-dark-300/80 bg-dark-200/88 px-3 py-3 backdrop-blur-xl sm:px-4 md:px-6">
								<div className="flex flex-col gap-3">
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<button
												type="button"
												onClick={() => handleSelectPeer(null)}
												className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-dark-300/90 text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)] md:hidden"
												aria-label="Back to contacts"
											>
												←
											</button>
											<div className="flex min-w-0 items-center gap-3">
												<div className="relative">
													<div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 sm:h-12 sm:w-12">
														<span className="text-white font-medium">
															{getPeerAvatarLabel(peerSelected)}
														</span>
													</div>
													<div className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-dark-200 ${peerSelected?.isOnline ? 'bg-green-500' : 'bg-gray-500'}`} />
												</div>
												<div className="min-w-0 flex-1 text-left">
													<div className="flex flex-wrap items-center gap-2">
														<p className="app-display-title truncate text-base font-medium text-white sm:text-lg">
															{peerHeaderState.displayName}
														</p>
														<span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${peerSelected?.isOnline ? 'border-green-400/25 bg-green-500/12 text-green-200' : 'border-white/10 bg-white/6 text-gray-300'}`}>
															{peerHeaderState.presenceLabel}
														</span>
													</div>
													<p className="app-text-muted mt-1 text-xs sm:text-sm">{peerHeaderState.identityLabel}</p>
												</div>
											</div>
										</div>
										<div className="flex shrink-0 items-start gap-2">
											<div className="hidden items-center gap-2 md:flex">
												{renderCallActionButton(CallType.audio, 'inline-flex h-11 items-center gap-2 rounded-2xl border border-white/8 bg-dark-300/88 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-primary-400/25 hover:bg-dark-200')}
												{renderCallActionButton(CallType.video, 'inline-flex h-11 items-center gap-2 rounded-2xl border border-primary-400/20 bg-primary-500/12 px-4 py-2 text-sm font-semibold text-primary-50 shadow-[0_12px_28px_rgba(6,182,212,0.12)] transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-primary-400/35 hover:bg-primary-500/18')}
											</div>
											<SmallGenericButton title="More options" onClick={() => setOpenContactSettings(!openContactSettings)} className="inline-flex h-11 w-11 items-center justify-center px-0">
												⋮
											</SmallGenericButton>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-2 md:hidden">
										{renderCallActionButton(CallType.audio, 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-dark-300/88 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-primary-400/25 hover:bg-dark-200')}
										{renderCallActionButton(CallType.video, 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-primary-400/20 bg-primary-500/12 px-4 py-2 text-sm font-semibold text-primary-50 shadow-[0_12px_28px_rgba(6,182,212,0.12)] transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-primary-400/35 hover:bg-primary-500/18')}
									</div>
								</div>
							</header>

							<RenderIf
								condition={peerHeaderState.requiresVerification}
								then={
									<div className="border-b border-dark-300/80 bg-dark-200/88 px-3 pb-3 pt-3 backdrop-blur-xl sm:px-4 md:px-6">
										<div className="app-panel-muted flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
											<div>
												<p className="text-sm font-semibold text-white">Verify this contact</p>
												<p className="app-text-muted text-xs sm:text-sm">Compare fingerprints before trusting this conversation on this device.</p>
											</div>
											<SmallGenericButton title="Mark as verified after fingerprint check" onClick={() => { void handleVerifyPeer(); }} className="w-full border-primary-400/25 bg-primary-500/12 text-primary-100 sm:w-auto">
											Verify now
											</SmallGenericButton>
										</div>
									</div>
								}
								otherwise={null}
							/>

							<RenderIf
								condition={openContactSettings}
								then={<ContactSettings setActionMenu={setOpenContactSettings} peerSelected={peerSelected} handleSaveDisplayName={handleSaveDisplayName} handleDeletingContact={handleDeletingContact} />}
								otherwise={null}
							/>

							<MessageList
								messages={selectedMessages}
								activePeerId={selectedPeerId}
								onForward={openForwardModal}
								onReply={handleReply}
								onLoadMore={async () => {
									if (!selectedPeerId)
										return 0;

									return loadMore(selectedPeerId);
								}}
								numberOfContacts={peers.length}
								peerDisplayName={peerHeaderState.displayName}
							/>

							<MessageInput
								onSend={(content) => { void handleSendMessage(content); }}
								onAttachFiles={handleAttachFiles}
								onOpenRecentGifs={() => { void openRecentGifs(); }}
								replyTo={replyToMessage}
								onCancelReply={() => setReplyToMessage(null)}
								onDismissAttachmentFeedback={inputAttachmentFeedback.state === 'uploading' ? undefined : dismissAttachmentFeedback}
								onOpenAttachmentDetails={attachmentFailedFiles.length > 0 ? () => setAttachmentDetailsOpen(true) : undefined}
								disabled={isLoading}
								peerId={peerSelected?.userId ?? ''}
								attachmentState={inputAttachmentFeedback.state}
								attachmentMessage={inputAttachmentFeedback.message}
								hasAttachmentDetails={attachmentFailedFiles.length > 0}
								peerDisplayName={peerHeaderState.displayName}
							/>
						</>
					}
					otherwise={
						<div className="flex flex-1 items-center justify-center px-4 py-6 text-center text-gray-500">
							<RenderIf
								condition={peersLoading}
								then={<Loading />}
								otherwise={
									<RenderIf
										condition={peers.length === 0}
										then={
											<div className="app-panel flex w-full max-w-md flex-col items-center gap-4 px-6 py-8">
												<div>
													<h2 className="app-display-title text-xl font-semibold text-white">Start a trusted conversation</h2>
													<p className="app-text-muted mt-2 text-sm">Add a contact to begin messaging, share files, and place secure calls.</p>
												</div>
												<AddContact />
											</div>
										}
										otherwise={
											<div className="app-panel-muted max-w-sm px-5 py-6">
												<p className="app-display-title text-base text-white">Pick a contact</p>
												<p className="app-text-muted mt-2 text-sm">Select a conversation from the list to see your messages and send a reply.</p>
											</div>
										}
									/>
								}
							/>
						</div>
					}
				/>
			</div>

			<RenderIf
				condition={forwardOpen}
				then={
					<ForwardModal
						peers={peers}
						selectedPeerId={selectedPeerId}
						forwardTargetId={forwardTargetId}
						setForwardTargetId={setForwardTargetId}
						setForwardOpen={setForwardOpen}
						handleForward={() => { void handleForward(); }}
						isForwarding={forwardStatus.isForwarding}
						forwardStatusMessage={forwardStatus.message}
						forwardProgress={forwardStatus.progress}
						forwardError={forwardStatus.error}
					/>
				}
				otherwise={null}
			/>

			<AttachmentUploadDetailsModal
				active={attachmentDetailsOpen}
				failedFiles={attachmentFailedFiles}
				onClose={() => setAttachmentDetailsOpen(false)}
			/>

			<RecentGifsModal
				key={recentGifsOpen ? 'recent-gifs-open' : 'recent-gifs-closed'}
				active={recentGifsOpen}
				setActive={setRecentGifsOpen}
				gifs={recentGifs}
				onSelectGif={(gif) => {
					void handleSendRecentGif(gif);
				}}
			/>
		</div>
	);
};

export default ChatView;
