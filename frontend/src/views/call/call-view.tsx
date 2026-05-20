import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';


import { AlertCircle, Microphone, MicrophoneOff, PhoneCall, PhoneOff, VideoCamera, VideoCameraOff } from '@/assets';
import { useScreenWakeLock } from '@/helpers/media/use-screen-wake-lock';
import { useVideoInputDevices } from '@/helpers/media/use-video-input-devices';
import { navigation } from '@/helpers/navigation';
import { RenderIf, RenderSwitch } from '@/helpers/render-conditional';
import { calculateElapsedTime, formatTimer } from '@/helpers/timer';
import { clientLogger } from '@/services/logger';
import { useCallStore } from '@/store/call-store';
import { usePeersStore } from '@/store/peers-store';
import { CallType } from '@/types';

import { Select } from '@components/common/select';

import type { FC, ReactNode} from 'react';

type GlobalAudioContextApis = typeof globalThis & {
	AudioContext?: typeof AudioContext;
	webkitAudioContext?: typeof AudioContext;
};

const getNonEmptyStringOrFallback = (value: string | null | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const getAudioContextConstructor = (): typeof AudioContext | undefined => (
	(globalThis as GlobalAudioContextApis).AudioContext
	?? (globalThis as GlobalAudioContextApis).webkitAudioContext
);

const CallView: FC = () => {
	const navigate = useNavigate();
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const remoteVideoRef = useRef<HTMLVideoElement>(null);
	const remoteAudioRef = useRef<HTMLAudioElement>(null);
	const recoveryAttemptedRef = useRef<boolean>(false);
	const ringtoneRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode; intervalId: number } | null>(null);
	const [_elapsedTick, setElapsedTick] = useState<number>(0);
	const [isSwitchingCamera, setIsSwitchingCamera] = useState<boolean>(false);
	const { peerId } = useParams<{ peerId: string }>();
	const { cameras, selectedCameraId, setSelectedCameraId } = useVideoInputDevices();
	const { peers } = usePeersStore();
	const {
		status,
		isRecoveringCall,
		type,
		localStream,
		remoteStream,
		remoteVideoEnabled,
		callErrorMessage,
		endCall,
		incomingOffer,
		answerCall,
		isMuted,
		isVideoEnabled,
		startTime,
		recoverCallState,
		toggleMute,
		toggleVideo,
		switchCamera
	} = useCallStore();
	const hasLocalVideo = Boolean(isVideoEnabled);
	const canSwitchCamera = type === CallType.video && status !== 'idle' && status !== 'ringing' && hasLocalVideo && cameras.length > 1;
	const shouldKeepScreenAwake = status === 'initiating' || status === 'ringing' || status === 'connecting' || status === 'connected';
	const elapsedLabel = status === 'connected' && startTime ? formatTimer(calculateElapsedTime(startTime)) : '00:00';
	useScreenWakeLock({ isActive: shouldKeepScreenAwake });
	const statusTextByState: Partial<Record<typeof status, string>> = {
		initiating: 'Starting call...',
		ringing: 'Ringing...',
		connecting: 'Connecting...',
		connected: 'Connected',
		busy: 'User is already in a call',
		failed: getNonEmptyStringOrFallback(callErrorMessage, 'Unable to establish connection. Please try again later.')
	};
	
	const getPeerDisplayName = () => {
		const matchedPeer = peers.find((peer) => peer.userId === peerId);

		if (matchedPeer?.displayName)
			return matchedPeer.displayName;

		if (peerId)
			return `User ${peerId.slice(0, 8)}`;

		return 'Unknown contact';
	};

	const getPeerInitial = () => getNonEmptyStringOrFallback(getPeerDisplayName().slice(0, 1).toUpperCase(), '?');
	const isConnected = () => status === 'connected';
	const isIncomingCall = () => status === 'ringing' && Boolean(incomingOffer);
	const isTerminalState = () => status === 'busy' || status === 'failed';
	const shouldShowActiveControls = () => status !== 'idle' && !isIncomingCall() && !isTerminalState();
	const hasRemoteVideo = () => Boolean(remoteStream) && Boolean(remoteVideoEnabled);
	const getStatusText = () => {
		if (isRecoveringCall)
			return 'Restoring call...';

		return statusTextByState[status] ?? '';
	};

	const getStatusBadgeClassName = () => {
		if (isConnected())
			return 'border-emerald-400/25 bg-emerald-500/14 text-emerald-100';

		if (isTerminalState())
			return 'border-red-400/25 bg-red-500/14 text-red-100';

		return 'border-white/10 bg-white/7 text-white/80';
	};

	const handleEndCall = () => {
		endCall();
		void navigate(navigation.Chat);
	};

	const handleAcceptCall = async () => {
		if (!peerId || !incomingOffer) return;
		await answerCall(peerId, incomingOffer);
	};

	const handleSwitchCamera = async (deviceId: string) => {
		if (!deviceId || isSwitchingCamera)
			return;

		setIsSwitchingCamera(true);
		setSelectedCameraId(deviceId);
		try {
			await switchCamera(deviceId);
		} finally {
			setIsSwitchingCamera(false);
		}
	};

	const getMuteControlConfig = () => {
		if (isMuted) {
			return {
				title: 'Unmute',
				label: 'Unmute',
				icon: <MicrophoneOff className="h-[1.35rem] w-[1.35rem]" />,
				tone: 'neutral' as const
			};
		}

		return {
			title: 'Mute',
			label: 'Mute',
			icon: <Microphone className="h-[1.35rem] w-[1.35rem]" />,
			tone: 'neutral' as const
		};
	};

	const getVideoControlConfig = () => {
		if (isVideoEnabled) {
			return {
				title: 'Disable camera',
				label: 'Camera off',
				icon: <VideoCameraOff className="h-[1.35rem] w-[1.35rem]" />,
				tone: 'accent' as const
			};
		}

		return {
			title: 'Enable camera',
			label: 'Camera on',
			icon: <VideoCamera className="h-[1.35rem] w-[1.35rem]" />,
			tone: 'accent' as const
		};
	};

	const getCallStatusOverlayConfig = () => {
		if (isTerminalState()) {
			return {
				badgeClassName: 'bg-red-500/16 text-red-100',
				icon: <AlertCircle className="h-9 w-9" />,
				message: 'This call could not continue. You can go back and try again.'
			};
		}

		return {
			badgeClassName: 'bg-primary-500/16 text-white animate-pulse',
			icon: <PhoneCall className="h-9 w-9" />,
			message: 'Hold on while the encrypted call is being prepared.'
		};
	};

	const renderControlButton = ({
		title,
		label,
		icon,
		onClick,
		tone = 'neutral',
		disabled = false
	}: {
		title: string;
		label: string;
		icon: ReactNode;
		onClick: () => void;
		tone?: 'neutral' | 'accent' | 'danger';
		disabled?: boolean;
	}) => {
		const getToneClassName = () => {
			if (tone === 'danger')
				return 'border-red-400/25 bg-red-500/14 text-red-50 hover:border-red-300/35 hover:bg-red-500/18';

			if (tone === 'accent')
				return 'border-primary-400/30 bg-primary-500/14 text-primary-50 hover:border-primary-300/40 hover:bg-primary-500/20';

			return 'border-white/10 bg-dark-300/88 text-white hover:border-white/16 hover:bg-dark-200';
		};

		const toneClassName = getToneClassName();

		return (
			<button
				type="button"
				title={title}
				onClick={onClick}
				disabled={disabled}
				className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-[1.25rem] border px-3 py-3 text-center shadow-[0_16px_30px_rgba(0,0,0,0.22)] transition-[transform,background-color,border-color] enabled:hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName}`}
			>
				<span className="flex h-6 w-6 items-center justify-center" aria-hidden="true">{icon}</span>
				<span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em]">{label}</span>
			</button>
		);
	};

	useEffect(() => {
		if (status !== 'connected' || !startTime)
			return;

		const interval = window.setInterval(() => {
			setElapsedTick((currentTick) => currentTick + 1);
		}, 1000);

		return () => {
			window.clearInterval(interval);
		};
	}, [status, startTime]);

	// Attach streams to video elements
	useEffect(() => {
		if (!localVideoRef.current)
			return;

		if (!localStream || !hasLocalVideo) {
			localVideoRef.current.srcObject = null;
			return;
		}

		localVideoRef.current.srcObject = localStream;
		void localVideoRef.current.play().catch((error: unknown) => {
			clientLogger.debug('Local call video autoplay failed:', error);
		});
	}, [localStream, hasLocalVideo]);

	useEffect(() => {
		if (!remoteVideoRef.current || !remoteStream || !remoteVideoEnabled)
			return;

		remoteVideoRef.current.srcObject = remoteStream;
		void remoteVideoRef.current.play().catch((error: unknown) => {
			clientLogger.debug('Remote call video autoplay failed:', error);
		});
	}, [remoteStream, remoteVideoEnabled]);

	useEffect(() => {
		if (remoteAudioRef.current && remoteStream)
			remoteAudioRef.current.srcObject = remoteStream;
	}, [remoteStream]);

	useEffect(() => {
		const stopRingtone = () => {
			if (!ringtoneRef.current) return;
			const { ctx, osc, intervalId } = ringtoneRef.current;

			window.clearInterval(intervalId);

			try {
				osc.stop();
				void ctx.close();
			} catch (error) {
				clientLogger.debug('Failed to stop call ringtone audio context:', error);
			}
			ringtoneRef.current = null;
		};

		if (status !== 'ringing') {
			stopRingtone();
			return;
		}

		const AudioContextConstructor = getAudioContextConstructor();
		if (!AudioContextConstructor) return;

		const ctx = new AudioContextConstructor();
		const gain = ctx.createGain();
		gain.gain.value = 0;
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.value = 440;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		const intervalId = window.setInterval(() => {
			const next = gain.gain.value === 0 ? 0.05 : 0;
			gain.gain.setValueAtTime(next, ctx.currentTime);
		}, 400);
		ringtoneRef.current = { ctx, osc, gain, intervalId };

		return stopRingtone;
	}, [status]);

	useEffect(() => {
		if (!peerId || recoveryAttemptedRef.current) return;
		recoveryAttemptedRef.current = true;

		if (type || incomingOffer || status === 'ringing' || status === 'connecting' || status === 'connected') return;

		void recoverCallState(peerId);
	}, [peerId, type, incomingOffer, status, recoverCallState]);

	useEffect(() => {
		if (isRecoveringCall) return;
		if (!recoveryAttemptedRef.current) return;
		if (status !== 'idle') return;
		if (type || incomingOffer) return;
		void navigate(navigation.Chat);
	}, [type, incomingOffer, status, isRecoveringCall, navigate]);

	return (
		<div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.18),transparent_34%),linear-gradient(180deg,rgba(11,15,29,0.98),rgba(4,7,16,1))] px-3 pt-[calc(var(--safe-area-top)+0.75rem)] pb-[calc(var(--safe-area-bottom)+0.75rem)] sm:px-4 sm:pt-[calc(var(--safe-area-top)+1rem)] sm:pb-[calc(var(--safe-area-bottom)+1rem)]">
			<audio ref={remoteAudioRef} autoPlay className="hidden" />
			<div className="relative flex min-h-0 flex-1 overflow-hidden rounded-4xl border border-white/8 bg-dark-200/40 shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
				<RenderSwitch
					value={type ?? 'none'}
					cases={{
						[CallType.audio]: (
							<div className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
								<div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.12),transparent_35%)]" />
								<div className="relative flex w-full max-w-md flex-col items-center gap-5 text-center">
									<div className="flex h-28 w-28 items-center justify-center rounded-full border border-primary-400/25 bg-primary-500/18 text-4xl font-semibold text-white shadow-[0_18px_40px_rgba(6,182,212,0.18)] sm:h-32 sm:w-32 sm:text-5xl">
										{getPeerInitial()}
									</div>
									<div className="space-y-2">
										<p className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em] ${getStatusBadgeClassName()}`}>
											{getStatusText()}
										</p>
										<h2 className="text-2xl font-semibold text-white sm:text-3xl">{getPeerDisplayName()}</h2>
										<p className="text-sm text-white/60">Secure audio call</p>
									</div>
									<div className="app-panel w-full px-5 py-4">
										<p className="text-sm text-white/75">{isConnected() ? 'Call connected and encrypted.' : getStatusText()}</p>
										<RenderIf
											condition={isConnected()}
											then={<p className="mt-2 text-xl font-semibold text-white">{elapsedLabel}</p>}
											otherwise={<p className="mt-2 text-xs uppercase tracking-[0.18em] text-white/45">Keep this screen active while the call is ongoing.</p>}
										/>
									</div>
									<RenderIf
										condition={isTerminalState()}
										then={
											<button
												type="button"
												onClick={handleEndCall}
												className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/10 bg-dark-300/88 px-5 py-3 text-sm font-semibold text-white transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-white/16 hover:bg-dark-200"
											>
												Return to chat
											</button>
										}
										otherwise={null}
									/>
								</div>
							</div>
						),
						[CallType.video]: (
							<div className="relative flex-1 overflow-hidden">
								<RenderIf
									condition={hasRemoteVideo()}
									then={
										<video
											ref={remoteVideoRef}
											autoPlay
											playsInline
											className="absolute inset-0 h-full w-full object-cover"
										/>
									}
									otherwise={
										<div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_32%),linear-gradient(180deg,rgba(11,15,29,0.94),rgba(4,7,16,1))] px-6">
											<div className="text-center text-white/75">
												<div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-dark-300/88 text-4xl text-white shadow-[0_14px_30px_rgba(0,0,0,0.24)]">
													{getPeerInitial()}
												</div>
												<p className="text-base font-semibold text-white">{getPeerDisplayName()}</p>
												<p className="mt-2 text-sm text-white/55">Remote camera is off</p>
											</div>
										</div>
									}
								/>

								<div className="pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b from-black/55 via-black/20 to-transparent px-3 pt-3 pb-14 sm:px-4 sm:pt-4">
									<div className="pointer-events-auto flex items-start justify-between gap-3">
										<div className="app-panel max-w-md px-4 py-3">
											<div className="flex items-center gap-3">
												<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-500/16 text-sm font-semibold text-white">
													{getPeerInitial()}
												</div>
												<div className="min-w-0">
													<p className="truncate text-base font-semibold text-white">{getPeerDisplayName()}</p>
													<div className="mt-1 flex flex-wrap items-center gap-2">
														<span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${getStatusBadgeClassName()}`}>
															{getStatusText()}
														</span>
														<RenderIf
															condition={isConnected()}
															then={<span className="text-xs font-medium text-white/70">{elapsedLabel}</span>}
															otherwise={null}
														/>
													</div>
												</div>
											</div>
										</div>
									</div>
								</div>

								<RenderIf
									condition={localStream !== undefined && hasLocalVideo}
									then={
										<section className="absolute right-3 top-[calc(var(--safe-area-top)+4.75rem)] w-[clamp(7rem,24vw,12rem)] max-w-[38vw] overflow-hidden rounded-[1.35rem] border border-white/10 bg-dark-300/85 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur sm:right-4 sm:top-[calc(var(--safe-area-top)+5.5rem)]">
											<video
												ref={localVideoRef}
												autoPlay
												playsInline
												muted
												className="aspect-3/4 h-full w-full object-cover md:aspect-video"
											/>
											<div className="border-t border-white/8 bg-dark-300/92 px-2 py-2">
												<p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-white/60">You</p>
												<RenderIf
													condition={canSwitchCamera}
													then={
														<Select
															title={isSwitchingCamera ? 'Switching camera...' : 'Camera'}
															value={selectedCameraId}
															onChange={(event) => void handleSwitchCamera(event.target.value)}
															list={cameras.map((camera) => ({ id: camera.id, label: camera.label }))}
														/>
													}
													otherwise={<p className="text-[0.7rem] text-white/55">Local preview</p>}
												/>
											</div>
										</section>
									}
									otherwise={null}
								/>

								<RenderIf
									condition={!isConnected()}
									then={
										<div className="absolute inset-0 flex items-center justify-center px-4">
											<div className="app-panel flex max-w-sm flex-col items-center gap-3 px-6 py-6 text-center">
												<div className={`flex h-20 w-20 items-center justify-center rounded-full shadow-[0_16px_36px_rgba(0,0,0,0.24)] ${getCallStatusOverlayConfig().badgeClassName}`}>
													{getCallStatusOverlayConfig().icon}
												</div>
												<p className="text-lg font-semibold text-white">{getStatusText()}</p>
												<p className="text-sm text-white/60">{getCallStatusOverlayConfig().message}</p>
												<RenderIf
													condition={isTerminalState()}
													then={
														<button
															type="button"
															onClick={handleEndCall}
															className="mt-2 inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-dark-300/88 px-4 py-2 text-sm font-semibold text-white transition-[transform,background-color,border-color] hover:-translate-y-px hover:border-white/16 hover:bg-dark-200"
														>
															Return to chat
														</button>
													}
													otherwise={null}
												/>
											</div>
										</div>
									}
									otherwise={null}
								/>
							</div>
						),
						none: (
							<div className="flex flex-1 items-center justify-center px-4">
								<RenderIf
									condition={isRecoveringCall}
									then={
										<div className="app-panel max-w-sm px-6 py-6 text-center">
											<p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-100">Recovering call</p>
											<p className="mt-3 text-base text-white">Restoring the call state for this conversation.</p>
										</div>
									}
									otherwise={<div />}
								/>
							</div>
						)
					}}
					defaultCase={null}
				/>
			</div>

			<RenderIf
				condition={shouldShowActiveControls()}
				then={
					<div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[calc(var(--safe-area-bottom)+0.875rem)] pt-4 sm:px-4">
						<div className="pointer-events-auto app-panel flex w-full max-w-md items-stretch gap-3 px-3 py-3 sm:max-w-lg">
							{renderControlButton({
								...getMuteControlConfig(),
								onClick: toggleMute
							})}
							{renderControlButton({
								title: 'End call',
								label: 'End',
								icon: <PhoneOff className="h-[1.35rem] w-[1.35rem]" />,
								onClick: handleEndCall,
								tone: 'danger'
							})}
							{renderControlButton({
								...getVideoControlConfig(),
								onClick: () => { void toggleVideo(); }
							})}
						</div>
					</div>
				}
				otherwise={null}
			/>

			<RenderIf
				condition={isIncomingCall()}
				then={
					<div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[calc(var(--safe-area-bottom)+0.875rem)] pt-4 sm:px-4">
						<div className="pointer-events-auto app-panel flex w-full max-w-md flex-col gap-3 px-3 py-3 sm:max-w-lg">
							<div className="px-1 text-center">
								<p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-primary-100">Incoming {type === CallType.video ? 'video' : 'audio'} call</p>
								<p className="mt-1 text-sm text-white/65">Answer now or decline and return to chat.</p>
							</div>
							<div className="flex items-stretch gap-3">
								{renderControlButton({
									title: 'Accept call',
									label: 'Accept',
									icon: <PhoneCall className="h-[1.35rem] w-[1.35rem]" />,
									onClick: () => { void handleAcceptCall(); },
									tone: 'accent'
								})}
								{renderControlButton({
									title: 'Decline call',
									label: 'Decline',
									icon: <PhoneOff className="h-[1.35rem] w-[1.35rem]" />,
									onClick: handleEndCall,
									tone: 'danger'
								})}
							</div>
						</div>
					</div>
				}
				otherwise={null}
			/>
		</div>
	);
}

export default CallView;