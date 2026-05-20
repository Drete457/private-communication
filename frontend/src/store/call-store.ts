// CallStore - Manages call state for voice/video calls
import { create } from 'zustand';

import { signedFetch } from '@/helpers/messages/http-auth';
import { calculateElapsedTime, formatTimer } from '@/helpers/timer';
import { isFiniteNumber, isRecord, isString, parseJsonResponse } from '@/helpers/validation';
import { clientLogger } from '@/services/logger';
import { webRTCService } from '@/services/web-rtc-service';
import { webSocketService } from '@/services/web-socket-service';
import type { CallRecoveryResponse, CallState, CallStatus} from '@/types';
import { CallType } from '@/types';

import { useMessagesStore } from './messages-store';

const RECOVERY_MAX_ATTEMPTS = 3;
const RECOVERY_RETRY_DELAYS_MS = [600, 1200];
const ACTIVE_RECOVERY_WATCHDOG_MS = 12000;
const SIGNAL_READY_TIMEOUT_MS = 10000;
const CALL_SETUP_WATCHDOG_MS = 45000;
const CALL_RECOVERY_WATCHDOG_MS = 15000;
const PENDING_CALL_FALLBACK_TIMEOUT_MS = 100000;
const CALL_TYPE_VALUES = new Set<string>(Object.values(CallType));
const RTC_SESSION_DESCRIPTION_TYPES = new Set<string>(['answer', 'offer', 'pranswer', 'rollback']);

type RtcSessionDescriptionRecord = {
	type?: unknown;
	sdp?: unknown;
};

type CallRecoveryResponseRecord = {
	state?: unknown;
	peerId?: unknown;
	senderId?: unknown;
	offer?: unknown;
	callType?: unknown;
	expiresAt?: unknown;
};

const isRtcSessionDescriptionRecord = (value: unknown): value is RtcSessionDescriptionRecord => isRecord(value);

const isCallRecoveryResponseRecord = (value: unknown): value is CallRecoveryResponseRecord => isRecord(value);

const isCallType = (value: unknown): value is CallType => (
	isString(value)
	&& CALL_TYPE_VALUES.has(value)
);

const isRtcSdpType = (value: unknown): value is RTCSdpType => (
	isString(value)
	&& RTC_SESSION_DESCRIPTION_TYPES.has(value)
);

const parseRtcSessionDescriptionInit = (value: unknown): RTCSessionDescriptionInit | null => {
	if (!isRtcSessionDescriptionRecord(value) || !isRtcSdpType(value.type))
		return null;

	return {
		type: value.type,
		...(isString(value.sdp) ? { sdp: value.sdp } : {})
	};
};

const parseCallRecoveryResponse = (value: unknown): CallRecoveryResponse | null => {
	if (!isCallRecoveryResponseRecord(value) || !isString(value.state))
		return null;

	if (value.state === 'none')
		return { state: 'none' };

	if (value.state === 'active') {
		if (!isString(value.peerId) || !isCallType(value.callType) || !isFiniteNumber(value.expiresAt))
			return null;

		return {
			state: 'active',
			peerId: value.peerId,
			callType: value.callType,
			expiresAt: value.expiresAt
		};
	}

	if (value.state === 'pending') {
		const offer = parseRtcSessionDescriptionInit(value.offer);
		if (!isString(value.senderId)
			|| offer?.type !== 'offer'
			|| !isCallType(value.callType)
			|| !isFiniteNumber(value.expiresAt)) {
			return null;
		}

		return {
			state: 'pending',
			senderId: value.senderId,
			offer,
			callType: value.callType,
			expiresAt: value.expiresAt
		};
	}

	return null;
};

const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

interface CallStoreState extends CallState {
	// Actions
	initializeListeners: () => void;
	initiateCall: (peerId: string, type: CallType) => Promise<void>;
	answerCall: (peerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
	endCall: (source?: 'local' | 'remote' | 'failed') => void;
	setStatus: (status: CallStatus) => void;
	recoverCallState: (peerId: string) => Promise<boolean>;
	toggleMute: () => void;
	toggleVideo: () => Promise<void>;
	switchCamera: (deviceId: string) => Promise<void>;
	incomingOffer?: RTCSessionDescriptionInit | undefined;
	callErrorMessage?: string | undefined;
	awaitingPeerWake?: boolean | undefined;
	listenersInitialized?: boolean | undefined;
}

const useCallStore = create<CallStoreState>((set, get) => {
	let remoteVideoCleanup: (() => void) | null = null;
	let connectedEventLogged = false;
	let activeRecoveryWatchdog: number | null = null;
	let callSetupWatchdog: number | null = null;
	let callRecoveryWatchdog: number | null = null;

	const appendCallLog = async (peerId: string | null, type: CallType | null, content: string): Promise<void> => {
		if (!peerId || !type) 
			return;

		await useMessagesStore.getState().appendCallEvent(peerId, content, type);
	};

	const clearRemoteVideoCleanup = () => {
		if (remoteVideoCleanup) {
			remoteVideoCleanup();
			remoteVideoCleanup = null;
		}
	};

	const clearActiveRecoveryWatchdog = () => {
		if (activeRecoveryWatchdog !== null) {
			window.clearTimeout(activeRecoveryWatchdog);
			activeRecoveryWatchdog = null;
		}
	};

	const clearCallSetupWatchdog = () => {
		if (callSetupWatchdog !== null) {
			window.clearTimeout(callSetupWatchdog);
			callSetupWatchdog = null;
		}
	};

	const clearCallRecoveryWatchdog = () => {
		if (callRecoveryWatchdog !== null) {
			window.clearTimeout(callRecoveryWatchdog);
			callRecoveryWatchdog = null;
		}
	};

	const clearAwaitingPeerWake = () => {
		if (get().awaitingPeerWake)
			set({ awaitingPeerWake: false });
	};

	const failCall = (peerId: string | null, message: string, endDelayMs = 2000) => {
		if (!peerId) 
			return;

		clearAwaitingPeerWake();
		clearActiveRecoveryWatchdog();
		clearCallSetupWatchdog();
		clearCallRecoveryWatchdog();
		set({ status: 'failed', callErrorMessage: message });

		window.setTimeout(() => {
			const state = get();
			if (state.peerId === peerId && state.status === 'failed') 
				state.endCall('failed');
		}, endDelayMs);
	};

	const scheduleCallSetupWatchdog = (peerId: string, message: string, timeoutMs = CALL_SETUP_WATCHDOG_MS) => {
		clearCallSetupWatchdog();
		callSetupWatchdog = window.setTimeout(() => {
			const state = get();
			if (state.peerId !== peerId) 
				return;

			if (state.status !== 'initiating' && state.status !== 'connecting') 
				return;

			void appendCallLog(peerId, state.type, 'Call ended • setup timeout');
			failCall(peerId, message);
		}, timeoutMs);
	};

	const markAwaitingPeerWake = (peerId: string, expiresAt?: number) => {
		const state = get();
		if (state.peerId !== peerId) 
			return;

		set({ status: 'connecting', callErrorMessage: undefined, awaitingPeerWake: true });
		if (!state.awaitingPeerWake)
			void appendCallLog(peerId, state.type, 'Waiting for peer to come online');

		const remainingMs = typeof expiresAt === 'number' ? Math.max(expiresAt - Date.now(), 0) : 0;
		scheduleCallSetupWatchdog(
			peerId,
			'The peer did not answer in time. Please try the call again.',
			Math.max(remainingMs, PENDING_CALL_FALLBACK_TIMEOUT_MS)
		);
	};

	const scheduleCallRecoveryWatchdog = (peerId: string, message: string) => {
		clearCallRecoveryWatchdog();
		callRecoveryWatchdog = window.setTimeout(() => {
			const state = get();
			if (state.peerId !== peerId) 
				return;

			if (state.status !== 'connecting') 
				return;

			void appendCallLog(peerId, state.type, 'Call ended • connection recovery timeout');
			failCall(peerId, message);
		}, CALL_RECOVERY_WATCHDOG_MS);
	};

	const scheduleActiveRecoveryWatchdog = (peerId: string) => {
		clearActiveRecoveryWatchdog();
		activeRecoveryWatchdog = window.setTimeout(() => {
			const state = get();
			if (state.peerId !== peerId || state.status !== 'connecting') {
				return;
			}

			set({
				status: 'failed',
				callErrorMessage: 'Unable to recover call after refresh. Please call again.'
			});

			window.setTimeout(() => {
				if (get().peerId === peerId && get().status === 'failed') {
					get().endCall('failed');
				}
			}, 1800);
		}, ACTIVE_RECOVERY_WATCHDOG_MS);
	};

	const bindRemoteVideoState = (peerId: string, stream: MediaStream) => {
		clearRemoteVideoCleanup();

		const update = () => {
			if (get().peerId !== peerId) return;

			const hasRemoteVideo = stream
				.getVideoTracks()
				.some((track) => track.readyState === 'live');

			const state = get();
			set({
				remoteVideoEnabled: hasRemoteVideo,
				type: hasRemoteVideo || Boolean(state.isVideoEnabled) ? CallType.video : CallType.audio
			});
		};

		update();

		const onTrackMutation = () => update();
		const attachTrack = (track: MediaStreamTrack) => {
			track.addEventListener('mute', onTrackMutation);
			track.addEventListener('unmute', onTrackMutation);
			track.addEventListener('ended', onTrackMutation);
		};
		const detachTrack = (track: MediaStreamTrack) => {
			track.removeEventListener('mute', onTrackMutation);
			track.removeEventListener('unmute', onTrackMutation);
			track.removeEventListener('ended', onTrackMutation);
		};

		stream.getVideoTracks().forEach(attachTrack);
		stream.addEventListener('addtrack', onTrackMutation);
		stream.addEventListener('removetrack', onTrackMutation);

		remoteVideoCleanup = () => {
			stream.getVideoTracks().forEach(detachTrack);
			stream.removeEventListener('addtrack', onTrackMutation);
			stream.removeEventListener('removetrack', onTrackMutation);
		};
	};

	const applyLocalVideoState = (stream: MediaStream | null | undefined) => {
		const hasLocalVideo =
			stream?.getVideoTracks().some((track: MediaStreamTrack) => track.readyState === 'live') ?? false;

		set({
			localStream: stream ?? undefined,
			isVideoEnabled: hasLocalVideo,
			type: hasLocalVideo || get().remoteVideoEnabled ? CallType.video : CallType.audio
		});
	};

	return ({
		isActive: false,
		type: null,
		peerId: null,
		status: 'idle',
		isRecoveringCall: false,
		localStream: undefined,
		remoteStream: undefined,
		remoteVideoEnabled: false,
		isMuted: false,
		isVideoEnabled: false,
		incomingOffer: undefined,
		callErrorMessage: undefined,
		awaitingPeerWake: false,
		listenersInitialized: false,

		// Initialize WebRTC event listeners
		initializeListeners: () => {
			if (get().listenersInitialized) {
				return;
			}

			webRTCService.onIncomingCall = (
				senderId: string,
				offer: RTCSessionDescriptionInit,
				callType?: CallType
			) => {
				const state = get();
				const canAcceptIncoming = state.status === 'idle' || state.status === 'failed' || state.status === 'busy';
				if (!canAcceptIncoming) {
					return;
				}

				set({
					isActive: true,
					peerId: senderId,
					status: 'ringing',
					type: callType ?? CallType.audio,
					incomingOffer: offer,
					remoteVideoEnabled: false,
					isVideoEnabled: callType === CallType.video,
					awaitingPeerWake: false
				});
				connectedEventLogged = false;
				void appendCallLog(senderId, callType ?? CallType.audio, `Call • incoming • ${callType === CallType.video ? 'video' : 'audio'}`);
			};

			webRTCService.onRemoteCallType = (senderId: string, callType: CallType) => {
				if (get().peerId !== senderId) {
					return;
				}

				const remoteVideoEnabled = callType === CallType.video;
				const state = get();
				set({
					remoteVideoEnabled,
					type: remoteVideoEnabled || Boolean(state.isVideoEnabled) ? CallType.video : CallType.audio
				});
			};

			webRTCService.onRemoteHangup = (senderId: string) => {
				if (get().peerId === senderId) {
					const state = get();
					const failedLocally = state.status === 'failed' || Boolean(state.callErrorMessage);
					get().endCall(failedLocally ? 'failed' : 'remote');
				}
			};

			webRTCService.onRemoteStream = (peerId: string, stream: MediaStream) => {
				if (get().peerId === peerId) {
					clearAwaitingPeerWake();
					clearActiveRecoveryWatchdog();
					clearCallSetupWatchdog();
					clearCallRecoveryWatchdog();
					set({
						remoteStream: stream,
						status: 'connected',
						callErrorMessage: undefined
					});
					bindRemoteVideoState(peerId, stream);
				}
			};

			webRTCService.onConnectionFailed = (failedPeerId: string, message: string) => {
				if (get().peerId !== failedPeerId) return;

				if (get().awaitingPeerWake) {
					set({ status: 'connecting', callErrorMessage: undefined });
					return;
				}

				void appendCallLog(failedPeerId, get().type, 'Call ended • connection failed');
				failCall(failedPeerId, message);
			};

			webRTCService.onConnectionStateChange = (
				peerId: string,
				state: RTCPeerConnectionState
			) => {
				if (get().peerId === peerId) {
					if (state === 'connected') {
						clearAwaitingPeerWake();
						clearActiveRecoveryWatchdog();
						clearCallSetupWatchdog();
						clearCallRecoveryWatchdog();
						set({ status: 'connected', startTime: Date.now(), callErrorMessage: undefined });
						if (!connectedEventLogged) {
							connectedEventLogged = true;
							void appendCallLog(peerId, get().type, 'Call • connected');
						}
					} else if (state === 'disconnected' || state === 'failed') {
						const activeCallEstablished = Boolean(get().startTime) || get().status === 'connected';
						if (get().status !== 'failed' && !get().callErrorMessage) {
							set({ status: 'connecting' });
						}

						if (activeCallEstablished) 
							scheduleCallRecoveryWatchdog(peerId, 'Connection lost and could not be recovered. Please call again.');
					}
				}
			};

			webSocketService.on('call_busy', ({ targetId }) => {
				const state = get();
				if (!targetId || state.peerId !== targetId) {
					return;
				}

				set({ status: 'busy' });
				void appendCallLog(state.peerId, state.type, 'Call ended • user already in another call');

				setTimeout(() => {
					if (get().status === 'busy')
						get().endCall('remote');
				}, 2000);
			});

			webSocketService.on('send_failed', (sendError) => {
				if (sendError.event !== 'signal') 
					return;

				const state = get();
				if (!state.peerId || state.peerId !== sendError.data.targetId)
					return;

				if (state.awaitingPeerWake)
					return;

				void appendCallLog(state.peerId, state.type, 'Call ended • signaling unavailable');
				failCall(state.peerId, 'Signaling connection lost. Please try the call again.');
			});

			webSocketService.on('signal_failed', (signalError) => {
				const state = get();
				if (!state.peerId || state.peerId !== signalError.targetId) 
					return;

				if (signalError.retryable && signalError.signalType === 'offer') {
					markAwaitingPeerWake(state.peerId, signalError.expiresAt);
					return;
				}

				if (state.awaitingPeerWake && signalError.signalType === 'candidate')
					return;

				void appendCallLog(state.peerId, state.type, 'Call ended • signaling delivery failed');
				failCall(state.peerId, getNonEmptyStringOrFallback(signalError.reason, 'Call signaling failed. Please try again.'));
			});

			webSocketService.on('peer_offline', ({ userId }) => {
				const state = get();
				if (!userId || state.peerId !== userId) 
					return;

				if (state.status === 'connected' || state.status === 'connecting') {
					set({ status: 'connecting', callErrorMessage: undefined });
					scheduleCallRecoveryWatchdog(userId, 'Peer disconnected and did not return. Please call again.');
				}
			});

			set({ listenersInitialized: true });
		},

		// Start a call with a peer
		initiateCall: async (peerId: string, type: CallType) => {
			set({
				isActive: true,
				type,
				peerId,
				status: 'initiating',
				isVideoEnabled: type === CallType.video,
				isMuted: false,
				awaitingPeerWake: false
			});
			connectedEventLogged = false;
			void appendCallLog(peerId, type, `Call • started • ${type === CallType.video ? 'video' : 'audio'}`);

			const socketReady = await webSocketService.waitForReady(SIGNAL_READY_TIMEOUT_MS);
			if (!socketReady) {
				failCall(peerId, 'Unable to reach signaling server. Please try again.');
				return;
			}

			try {
				const localStream = await webRTCService.getLocalStream(type === CallType.video);
				set({ localStream, status: 'connecting' });

				await webRTCService.initiateCall(peerId, type === CallType.video);
				scheduleCallSetupWatchdog(peerId, 'Call setup timed out. Please try again.');
			} catch (error) {
				clientLogger.error('Failed to initiate call:', error);
				failCall(peerId, 'Unable to start call. Please try again.');
			}
		},

		// Answer an incoming call
		answerCall: async (peerId: string, offer: RTCSessionDescriptionInit) => {
			set({ status: 'connecting', incomingOffer: undefined, awaitingPeerWake: false });
			connectedEventLogged = false;
			void appendCallLog(peerId, get().type, 'Call • accepted');

			const socketReady = await webSocketService.waitForReady(SIGNAL_READY_TIMEOUT_MS);
			if (!socketReady) {
				failCall(peerId, 'Unable to reach signaling server. Please try again.');
				return;
			}

			try {
				const enableVideo = get().type === CallType.video;
				const localStream = await webRTCService.getLocalStream(enableVideo);
				set({ localStream });

				await webRTCService.answerCall(peerId, offer, get().type === CallType.video);
				scheduleCallSetupWatchdog(peerId, 'Call setup timed out. Please try again.');
			} catch (error) {
				clientLogger.error('Failed to answer call:', error);
				failCall(peerId, 'Unable to answer call. Please try again.');
			}
		},

		// Toggle microphone mute
		toggleMute: () => {
			const nextMuted = !get().isMuted;
			webRTCService.setMute(nextMuted);
			set({ isMuted: nextMuted });
		},

		// Toggle local video track and renegotiate
		toggleVideo: async () => {
			const enableVideo = !get().isVideoEnabled;
			try {
				const stream = await webRTCService.setVideoEnabled(enableVideo);
				applyLocalVideoState(stream);
			} catch (error) {
				clientLogger.error('Failed to toggle video:', error);
			}
		},

		switchCamera: async (deviceId: string) => {
			if (!deviceId) {
				return;
			}

			try {
				const stream = await webRTCService.switchCamera(deviceId);
				applyLocalVideoState(stream);
			} catch (error) {
				clientLogger.error('Failed to switch camera:', error);
			}
		},

		// End the current call
		endCall: (source = 'local') => {
			const { peerId, startTime, type, status } = get();
			const duration = startTime ? formatTimer(calculateElapsedTime(startTime)) : undefined;

			if (peerId) {
				if (status === 'connected' && duration) {
					void appendCallLog(peerId, type, `Call ended • duration ${duration}`);
				} else if (source === 'local') {
					void appendCallLog(peerId, type, 'Call ended • by you');
				} else {
					void appendCallLog(peerId, type, 'Call ended • by remote peer');
				}
			}

			if (peerId && source === 'local')
				webRTCService.endCallLocal(peerId);

			connectedEventLogged = false;

			clearRemoteVideoCleanup();
			clearActiveRecoveryWatchdog();
			clearCallSetupWatchdog();
			clearCallRecoveryWatchdog();

			webRTCService.stopLocalStream();

			set({
				isActive: false,
				type: null,
				peerId: null,
				status: 'idle',
				isRecoveringCall: false,
				callErrorMessage: undefined,
				awaitingPeerWake: false,
				localStream: undefined,
				remoteStream: undefined,
				remoteVideoEnabled: false,
				startTime: undefined,
				incomingOffer: undefined,
				isMuted: false,
				isVideoEnabled: false
			});
		},

		// Update call status
		setStatus: (status: CallStatus) => {
			set({ status });
		},

		recoverCallState: async (peerId: string) => {
			if (!peerId)
				return false;

			const current = get();
			if (
				current.peerId === peerId &&
				(current.status === 'ringing' || current.status === 'connecting' || current.status === 'connected')
			) {
				return true;
			}

			set({ isRecoveringCall: true });


			try {
				if (!webSocketService.isConnected()) {
					void webSocketService.resume().catch((error: unknown) => {
						clientLogger.warn('Failed to resume signaling before call recovery:', error);
					});
				}

				for (let attempt = 0; attempt < RECOVERY_MAX_ATTEMPTS; attempt++) {
					try {
						const response = await signedFetch(`/api/call/recover/${encodeURIComponent(peerId)}`);
						if (!response.ok) {
							const retryDelay = RECOVERY_RETRY_DELAYS_MS[attempt];
							if (retryDelay !== undefined)
								await wait(retryDelay);
							continue;
						}

						const recovery = await parseJsonResponse(response, parseCallRecoveryResponse, 'call recovery');

						if (recovery.state === 'pending') {
							set({
								isActive: true,
								peerId: recovery.senderId,
								status: 'ringing',
								type: recovery.callType,
								incomingOffer: recovery.offer,
								remoteVideoEnabled: false,
								isVideoEnabled: recovery.callType === CallType.video,
								callErrorMessage: undefined,
								awaitingPeerWake: false
							});
							return true;
						}

						if (recovery.state === 'active') {
							set({
								isActive: true,
								peerId: recovery.peerId,
								type: recovery.callType,
								status: 'connecting',
								incomingOffer: undefined,
								remoteVideoEnabled: false,
								isVideoEnabled: recovery.callType === CallType.video,
								callErrorMessage: undefined,
								awaitingPeerWake: false
							});

							try {
								const localStream = await webRTCService.getLocalStream(recovery.callType === CallType.video);
								set({ localStream });
								await webRTCService.initiateCall(recovery.peerId, recovery.callType === CallType.video);
								scheduleCallSetupWatchdog(recovery.peerId, 'Call recovery timed out. Please try again.');
								scheduleActiveRecoveryWatchdog(recovery.peerId);
								return true;
							} catch {
								set({ status: 'failed', callErrorMessage: 'Unable to recover call after refresh. Please call again.' });
								window.setTimeout(() => {
									if (get().peerId === recovery.peerId && get().status === 'failed') {
										get().endCall('failed');
									}
								}, 1800);
								return false;
							}
						}

						return false;
					} catch {
						const retryDelay = RECOVERY_RETRY_DELAYS_MS[attempt];
						if (retryDelay !== undefined)
							await wait(retryDelay);
					}
				}

				return false;
			} finally {
				set({ isRecoveringCall: false });
			}
		}
	});
});

export { useCallStore };
