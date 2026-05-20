// WebRTCService - Peer-to-Peer communication for calls and file transfers

/* Handles:
 * - WebRTC connection establishment via signaling
 * - Audio/Video calls
 * - Data channels for file transfers
 * - ICE negotiation with STUN/TURN fallback
 */

import { isMobileDevice } from '@/helpers/navigation';
import { clientLogger } from '@/services/logger';
import { CallType } from '@/types';
import type { SignalEventData } from '@/types/events';

import { getTurnIceServers } from './turn-service';
import { webSocketService } from './web-socket-service';

type RTCStatsRecord = Record<string, unknown> & Partial<Record<'selected' | 'type', unknown>>;

const isRecord = (value: unknown): value is RTCStatsRecord =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const getStringStat = (report: Record<string, unknown> | null, key: string): string | undefined => {
	const value = report?.[key];
	return typeof value === 'string' ? value : undefined;
};

const getNumberStat = (report: Record<string, unknown> | null, key: string): number | undefined => {
	const value = report?.[key];
	return typeof value === 'number' ? value : undefined;
};

const getNonEmptyStringOrUndefined = (value: string | null | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const getStatsReportById = (stats: RTCStatsReport, id: string | undefined): unknown => {
	const reportId = getNonEmptyStringOrUndefined(id);
	const report: unknown = reportId ? stats.get(reportId) : null;
	return report;
};

const getSelectedCandidatePair = (stats: RTCStatsReport): Record<string, unknown> | null => {
	for (const report of stats.values()) {
		const candidateReport: unknown = report;
		if (isRecord(candidateReport) && candidateReport.type === 'candidate-pair' && candidateReport.selected === true)
			return candidateReport;
	}

	return null;
};

interface RTCConfig extends RTCConfiguration {
	iceServers: RTCIceServer[];
	iceTransportPolicy?: RTCIceTransportPolicy;
}

interface CallMetrics {
	direction: 'outgoing' | 'incoming';
	callType: CallType;
	startedAt: number;
	offerSentAt?: number;
	offerReceivedAt?: number;
	answerSentAt?: number;
	answerReceivedAt?: number;
	firstLocalCandidateAt?: number;
	firstRemoteCandidateAt?: number;
	firstRemoteTrackAt?: number;
	connectedAt?: number;
	iceRestarts: number;
	icePolicyInitial: RTCIceTransportPolicy;
	icePolicyCurrent: RTCIceTransportPolicy;
}

type SignalType = 'offer' | 'answer' | 'candidate' | 'hangup';
type SignalPayload = RTCSessionDescriptionInit | RTCIceCandidateInit | undefined;
type SignalExtra = Pick<SignalEventData, 'callType' | 'renegotiate' | 'iceRestart' | 'forceRelay' | 'reason'>;

const ICE_RESTART_MAX_ATTEMPTS = 2;
const ICE_RESTART_BACKOFF_DESKTOP_MS = 700;
const ICE_RESTART_BACKOFF_MOBILE_MS = 250;
const ICE_CHECKING_TIMEOUT_DESKTOP_MS = 12000;
const ICE_CHECKING_TIMEOUT_MOBILE_MS = 9000;
const ICE_DISCONNECTED_GRACE_DESKTOP_MS = 4000;
const ICE_DISCONNECTED_GRACE_MOBILE_MS = 6000;
const stunUrl = import.meta.env.VITE_STUN_SERVER_URL || 'stun:localhost:3478';

class WebRTCService {
	private peerConnections = new Map<string, RTCPeerConnection>();
	private dataChannels = new Map<string, RTCDataChannel>();
	private remoteStreams = new Map<string, MediaStream>();
	private localVideoSenders = new Map<string, RTCRtpSender>();
	private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
	private pendingRenegotiation = new Set<string>();
	private localStream: MediaStream | null = null;
	private currentVideoDeviceId: string | null = null;
	private config: RTCConfig;
	private iceRestartAttempts = new Map<string, number>();
	private iceRestartInFlight = new Set<string>();
	private pendingIceRestartReasons = new Map<string, string>();
	private pendingRemoteRelayReasons = new Map<string, string>();
	private restartWatchdogs = new Map<string, number>();
	private connectionFailuresHandled = new Set<string>();
	private relayFallbackApplied = new Set<string>();
	private callMetrics = new Map<string, CallMetrics>();
	private checkingTimeouts = new Map<string, number>();
	private disconnectedTimeouts = new Map<string, number>();

	// Event callbacks
	public onRemoteStream: ((peerId: string, stream: MediaStream) => void) | null = null;
	public onDataChannelMessage: ((peerId: string, data: unknown) => void) | null = null;
	public onConnectionStateChange: ((peerId: string, state: RTCPeerConnectionState) => void) | null = null;
	public onConnectionFailed: ((peerId: string, message: string) => void) | null = null;
	public onIncomingCall:
		| ((peerId: string, offer: RTCSessionDescriptionInit, callType?: CallType) => void)
		| null = null;
	public onRemoteCallType: ((peerId: string, callType: CallType) => void) | null = null;
	public onRemoteHangup: ((peerId: string) => void) | null = null;

	constructor() {
		this.config = this.generateBaseConfig([]);
		void this.refreshIceServers();

		webSocketService.on('signal', (data) => {
			void this.handleSignalingMessage(data);
		});
	}

	private generateBaseConfig(turnServers: RTCIceServer[]): RTCConfig {
		const isMobile = isMobileDevice();

		return {
			iceServers: [{ urls: stunUrl }, ...turnServers],
			iceTransportPolicy: 'all',
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
			iceCandidatePoolSize: isMobile ? 10 : 5,
		};
	}

	private getIceRestartBackoffMs(): number {
		return isMobileDevice() ? ICE_RESTART_BACKOFF_MOBILE_MS : ICE_RESTART_BACKOFF_DESKTOP_MS;
	}

	private getIceCheckingTimeoutMs(): number {
		return isMobileDevice() ? ICE_CHECKING_TIMEOUT_MOBILE_MS : ICE_CHECKING_TIMEOUT_DESKTOP_MS;
	}

	private getIceDisconnectedGraceMs(): number {
		return isMobileDevice() ? ICE_DISCONNECTED_GRACE_MOBILE_MS : ICE_DISCONNECTED_GRACE_DESKTOP_MS;
	}

	// Telemetry logging for call events and metrics - To be in the final version
	private logTelemetry(peerId: string, event: string, details: Record<string, unknown> = {}): void {
		clientLogger.info('[CallTelemetry]', {
			peerId,
			event,
			ts: Date.now(),
			...details
		});
	}

	private ensureMetrics(peerId: string, defaults?: { direction: 'outgoing' | 'incoming'; callType: CallType }): CallMetrics {
		const existing = this.callMetrics.get(peerId);
		if (existing) return existing;

		const metrics: CallMetrics = {
			direction: defaults?.direction ?? 'outgoing',
			callType: defaults?.callType ?? this.getCallType(),
			startedAt: Date.now(),
			iceRestarts: 0,
			icePolicyInitial: this.config.iceTransportPolicy ?? 'all',
			icePolicyCurrent: this.config.iceTransportPolicy ?? 'all'
		};

		this.callMetrics.set(peerId, metrics);
		return metrics;
	}

	private clearCheckingTimeout(peerId: string): void {
		const timeoutId = this.checkingTimeouts.get(peerId);
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
			this.checkingTimeouts.delete(peerId);
		}
	}

	private clearRestartWatchdog(peerId: string): void {
		const timeoutId = this.restartWatchdogs.get(peerId);
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
			this.restartWatchdogs.delete(peerId);
		}
	}

	private clearDisconnectedTimeout(peerId: string): void {
		const timeoutId = this.disconnectedTimeouts.get(peerId);
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
			this.disconnectedTimeouts.delete(peerId);
		}
	}

	private scheduleDisconnectedRecovery(peerId: string, pc: RTCPeerConnection): void {
		this.clearDisconnectedTimeout(peerId);
		const timeoutMs = this.getIceDisconnectedGraceMs();

		const timeoutId = window.setTimeout(() => {
			if (pc.signalingState === 'closed') return;
			if (pc.iceConnectionState !== 'disconnected') return;

			this.logTelemetry(peerId, 'ice_disconnected_grace_elapsed', { timeoutMs });
			void this.requestIceRestart(peerId, 'ice_disconnected');
		}, timeoutMs);

		this.disconnectedTimeouts.set(peerId, timeoutId);
	}

	private scheduleRestartWatchdog(peerId: string, pc: RTCPeerConnection): void {
		this.clearRestartWatchdog(peerId);
		const timeoutMs = this.getIceCheckingTimeoutMs() + 1000;

		const timeoutId = window.setTimeout(() => {
			if (pc.signalingState === 'closed') return;
			if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return;

			this.logTelemetry(peerId, 'ice_restart_watchdog_timeout', {
				timeoutMs,
				state: pc.iceConnectionState
			});
			void this.requestIceRestart(peerId, 'restart_watchdog_timeout');
		}, timeoutMs);

		this.restartWatchdogs.set(peerId, timeoutId);
	}

	private handleConnectionFailure(peerId: string, reason: string): void {
		if (this.connectionFailuresHandled.has(peerId)) return;
		this.connectionFailuresHandled.add(peerId);

		const message = 'Unable to establish connection. Please try again later.';
		this.logTelemetry(peerId, 'connection_failed_terminal', { reason });
		this.onConnectionFailed?.(peerId, message);
		this.endCallLocal(peerId);
	}

	private scheduleCheckingTimeout(peerId: string, pc: RTCPeerConnection): void {
		this.clearCheckingTimeout(peerId);
		const timeoutMs = this.getIceCheckingTimeoutMs();

		const timeoutId = window.setTimeout(() => {
			if (pc.iceConnectionState === 'checking') {
				this.logTelemetry(peerId, 'ice_checking_timeout', { timeoutMs });
				// If timeout hits on mobile, we trigger an ICE restart forcing Relay mode
				void this.requestIceRestart(peerId, 'checking_timeout');
			}
		}, timeoutMs);

		this.checkingTimeouts.set(peerId, timeoutId);
	}

	private async logSelectedCandidatePair(peerId: string, pc: RTCPeerConnection): Promise<void> {
		try {
			const stats = await pc.getStats();
			const selectedPair = getSelectedCandidatePair(stats);

			if (!selectedPair) return;

			const localCandidateId = getStringStat(selectedPair, 'localCandidateId');
			const remoteCandidateId = getStringStat(selectedPair, 'remoteCandidateId');
			const localCandidate = getStatsReportById(stats, localCandidateId);
			const remoteCandidate = getStatsReportById(stats, remoteCandidateId);
			const localCandidateRecord = isRecord(localCandidate) ? localCandidate : null;
			const remoteCandidateRecord = isRecord(remoteCandidate) ? remoteCandidate : null;

			this.logTelemetry(peerId, 'selected_candidate_pair', {
				localCandidateType: getStringStat(localCandidateRecord, 'candidateType'),
				remoteCandidateType: getStringStat(remoteCandidateRecord, 'candidateType'),
				localProtocol: getStringStat(localCandidateRecord, 'protocol'),
				rtt: getNumberStat(selectedPair, 'currentRoundTripTime')
			});
		} catch (error) {
			this.logTelemetry(peerId, 'candidate_pair_stats_failed', {
				error: error instanceof Error ? error.message : 'unknown'
			});
		}
	}

	private logConnectionSummary(peerId: string): void {
		const metrics = this.callMetrics.get(peerId);
		if (!metrics?.connectedAt) return;

		const baseline = metrics.offerSentAt ?? metrics.offerReceivedAt ?? metrics.startedAt;
		this.logTelemetry(peerId, 'setup_summary', {
			direction: metrics.direction,
			callType: metrics.callType,
			iceRestarts: metrics.iceRestarts,
			tOfferToConnectedMs: metrics.connectedAt - baseline,
			policyFinal: metrics.icePolicyCurrent
		});
	}

	private async refreshIceServers(): Promise<void> {
		const turnServers = await getTurnIceServers();
		this.config = this.generateBaseConfig(turnServers);

		this.logTelemetry('global', 'ice_servers_refreshed', {
			turnServersCount: turnServers.length
		});

		for (const pc of this.peerConnections.values()) {
			pc.setConfiguration(this.config);
		}
	}

	private hasVideoTrack(): boolean {
		return this.localStream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
	}

	private createVideoConstraints(deviceId?: string): MediaTrackConstraints {
		if (deviceId) {
			return {
				deviceId: { exact: deviceId },
				width: 1280,
				height: 720
			};
		}

		return {
			width: 1280,
			height: 720
		};
	}

	private async ensureLocalStream(): Promise<MediaStream> {
		this.localStream ??= await navigator.mediaDevices.getUserMedia({
			audio: true,
			video: false
		});
		return this.localStream;
	}

	private getVideoSender(peerId: string, pc: RTCPeerConnection): RTCRtpSender | undefined {
		const mappedSender = this.localVideoSenders.get(peerId);
		if (mappedSender && pc.getSenders().includes(mappedSender)) {
			return mappedSender;
		}
		return pc.getSenders().find((sender) => sender.track?.kind === 'video');
	}

	private attachLocalTracks(peerId: string, pc: RTCPeerConnection, stream: MediaStream): void {
		for (const track of stream.getTracks()) {
			const sender = pc.addTrack(track, stream);
			if (track.kind === 'video')
				this.localVideoSenders.set(peerId, sender);
		}
	}

	private async applyVideoTrackToPeerConnections(videoTrack: MediaStreamTrack): Promise<boolean> {
		if (!this.localStream) {
			return false;
		}

		let topologyChanged = false;
		for (const [peerId, pc] of this.peerConnections.entries()) {
			const sender = this.getVideoSender(peerId, pc);
			if (sender) {
				await sender.replaceTrack(videoTrack);
			} else {
				const newSender = pc.addTrack(videoTrack, this.localStream);
				this.localVideoSenders.set(peerId, newSender);
				topologyChanged = true;
			}
		}

		return topologyChanged;
	}

	private async syncLocalVideoTrack(enabled: boolean, preferredDeviceId?: string): Promise<boolean> {
		if (!this.localStream) return false;

		if (enabled) {
			const targetDeviceId = getNonEmptyStringOrUndefined(preferredDeviceId)
				?? getNonEmptyStringOrUndefined(this.currentVideoDeviceId);
			const activeTrack = this.localStream
				.getVideoTracks()
				.find((track) => track.readyState === 'live');

			const activeDeviceId = activeTrack?.getSettings().deviceId;
			const shouldSwitchDevice =
				typeof targetDeviceId === 'string' &&
				targetDeviceId.length > 0 &&
				targetDeviceId !== activeDeviceId;

			if (activeTrack && !shouldSwitchDevice) {
				activeTrack.enabled = true;
				this.currentVideoDeviceId = getNonEmptyStringOrUndefined(activeDeviceId) ?? this.currentVideoDeviceId;
				return false;
			}

			await this.removeVideoTracks();

			const videoStream = await navigator.mediaDevices.getUserMedia({
				video: this.createVideoConstraints(targetDeviceId),
				audio: false
			});
			const videoTrack = videoStream.getVideoTracks().at(0);

			if (!videoTrack) return false;
			videoTrack.enabled = true;
			this.currentVideoDeviceId = getNonEmptyStringOrUndefined(videoTrack.getSettings().deviceId) ?? targetDeviceId ?? null;

			this.localStream.addTrack(videoTrack);
			const topologyChanged = await this.applyVideoTrackToPeerConnections(videoTrack);
			return topologyChanged;
		}
		await this.removeVideoTracks();
		// Preserve selected camera so off->on reuses the same device
		return true;
	}

	private async removeVideoTracks(): Promise<void> {
		if (!this.localStream) return;

		const tracks = this.localStream.getVideoTracks();
		for (const track of tracks) {
			for (const [peerId, pc] of this.peerConnections.entries()) {
				const sender = this.getVideoSender(peerId, pc);

				if (sender) await sender.replaceTrack(null);
			}
			track.stop();
			this.localStream.removeTrack(track);
		}
	}

	private getCallType(): CallType {
		return this.hasVideoTrack() ? CallType.video : CallType.audio;
	}

	private async requestIceRestart(peerId: string, reason: string): Promise<boolean> {
		const pc = this.peerConnections.get(peerId);
		if (!pc || pc.signalingState === 'closed') return false;
		if (this.iceRestartInFlight.has(peerId)) return true;
		if (pc.signalingState !== 'stable') {
			this.pendingIceRestartReasons.set(peerId, reason);
			this.logTelemetry(peerId, 'ice_restart_deferred', {
				reason,
				signalingState: pc.signalingState
			});
			return true;
		}

		const attempts = this.iceRestartAttempts.get(peerId) ?? 0;
		if (attempts >= ICE_RESTART_MAX_ATTEMPTS) {
			this.logTelemetry(peerId, 'ice_restart_exhausted', { attempts });
			this.handleConnectionFailure(peerId, 'ice_restart_exhausted');
			return false;
		}

		this.iceRestartInFlight.add(peerId);
		this.iceRestartAttempts.set(peerId, attempts + 1);

		const metrics = this.ensureMetrics(peerId);
		metrics.iceRestarts += 1;

		const shouldForceRelay = attempts > 0 || reason === 'checking_timeout';

		if (shouldForceRelay && !this.relayFallbackApplied.has(peerId)) {
			pc.setConfiguration({ ...this.config, iceTransportPolicy: 'relay' });
			this.relayFallbackApplied.add(peerId);
			metrics.icePolicyCurrent = 'relay';
			this.logTelemetry(peerId, 'relay_fallback_applied', { reason, attempt: attempts + 1 });
		}

		const backoffMs = this.getIceRestartBackoffMs();
		await new Promise((resolve) => setTimeout(resolve, backoffMs));

		const currentPc = this.peerConnections.get(peerId);
		if (!currentPc || currentPc.signalingState === 'closed') {
			this.logTelemetry(peerId, 'ice_restart_aborted_closed', { reason });
			return false;
		}

		if (currentPc.signalingState !== 'stable') {
			this.pendingIceRestartReasons.set(peerId, reason);
			this.logTelemetry(peerId, 'ice_restart_redeferred', {
				reason,
				signalingState: currentPc.signalingState
			});
			return true;
		}

		try {
			this.logTelemetry(peerId, 'ice_restart_executing', { reason, attempt: metrics.iceRestarts });

			// In modern browsers, restartIce() updates the ICE credentials for the next offer
			if (typeof currentPc.restartIce === 'function')
				currentPc.restartIce();

			const offer = await currentPc.createOffer({ iceRestart: true });
			await currentPc.setLocalDescription(offer);

			this.sendSignal(peerId, 'offer', offer, {
				callType: this.getCallType(),
				iceRestart: true,
				forceRelay: this.relayFallbackApplied.has(peerId),
				reason
			});
			this.scheduleRestartWatchdog(peerId, currentPc);
			return true;
		} catch (err) {
			this.logTelemetry(peerId, 'ice_restart_failed', { error: String(err) });
			if ((this.iceRestartAttempts.get(peerId) ?? 0) >= ICE_RESTART_MAX_ATTEMPTS) {
				this.handleConnectionFailure(peerId, 'ice_restart_failed');
			}
			return false;
		} finally {
			this.iceRestartInFlight.delete(peerId);
		}
	}

	public async handleIceFailure(peerId: string, reason: string): Promise<boolean> {
		return this.requestIceRestart(peerId, reason);
	}

	private async renegotiateAll(): Promise<void> {
		for (const [peerId, pc] of this.peerConnections.entries()) {
			if (pc.signalingState !== 'stable') {
				this.pendingRenegotiation.add(peerId);
				continue;
			}

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			this.pendingRenegotiation.delete(peerId);

			this.sendSignal(peerId, 'offer', offer, {
				callType: this.getCallType(),
				renegotiate: true
			});
		}
	}

	private async flushPendingCandidates(peerId: string): Promise<void> {
		const pc = this.peerConnections.get(peerId);
		if (!pc) return;

		const pending = this.pendingCandidates.get(peerId);
		if (!pending) return;

		this.pendingCandidates.delete(peerId);
		for (const candidate of pending) {
			try {
				await pc.addIceCandidate(new RTCIceCandidate(candidate));
			} catch (e) {
				this.logTelemetry(peerId, 'pending_candidate_failed', { error: String(e) });
			}
		}
	}

	setMute(muted: boolean): void {
		this.localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
	}

	async setVideoEnabled(enabled: boolean): Promise<MediaStream | null> {
		await this.ensureLocalStream();
		const hadLocalVideo = this.hasVideoTrack();
		const topologyChanged = await this.syncLocalVideoTrack(enabled);
		const hasLocalVideo = this.hasVideoTrack();
		const reenabledVideo = enabled && !hadLocalVideo && hasLocalVideo;

		if (this.peerConnections.size > 0 && (topologyChanged || reenabledVideo))
			await this.renegotiateAll();

		return this.localStream;
	}

	async switchCamera(deviceId: string): Promise<MediaStream | null> {
		if (!deviceId) {
			return this.localStream;
		}

		await this.ensureLocalStream();
		const hadLocalVideo = this.hasVideoTrack();
		const topologyChanged = await this.syncLocalVideoTrack(true, deviceId);
		const hasLocalVideo = this.hasVideoTrack();
		const reenabledVideo = !hadLocalVideo && hasLocalVideo;

		if (this.peerConnections.size > 0 && (topologyChanged || reenabledVideo))
			await this.renegotiateAll();

		return this.localStream;
	}

	async getLocalStream(video = true): Promise<MediaStream> {
		const stream = await this.ensureLocalStream();
		await this.syncLocalVideoTrack(video);
		return this.localStream ?? stream;
	}

	stopLocalStream(): void {
		if (this.localStream) {
			this.localStream.getTracks().forEach(t => t.stop());
			this.localStream = null;
			this.localVideoSenders.clear();
			this.currentVideoDeviceId = null;
		}
	}

	async initiateCall(peerId: string, video = true): Promise<void> {
		await this.refreshIceServers();
		const pc = this.createPeerConnection(peerId);
		const metrics = this.ensureMetrics(peerId, {
			direction: 'outgoing',
			callType: video ? CallType.video : CallType.audio
		});

		const stream = await this.getLocalStream(video);
		this.attachLocalTracks(peerId, pc, stream);

		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		metrics.offerSentAt = Date.now();
		this.sendSignal(peerId, 'offer', offer, { callType: video ? CallType.video : CallType.audio });
	}

	async answerCall(peerId: string, offer: RTCSessionDescriptionInit, video = true): Promise<void> {
		await this.refreshIceServers();
		this.ensureMetrics(peerId, { direction: 'incoming', callType: video ? CallType.video : CallType.audio });

		const pc = this.createPeerConnection(peerId);
		await pc.setRemoteDescription(new RTCSessionDescription(offer));
		await this.flushPendingCandidates(peerId);
		const stream = await this.getLocalStream(video);
		this.attachLocalTracks(peerId, pc, stream);
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);
		this.sendSignal(peerId, 'answer', answer, {
			callType: video ? CallType.video : CallType.audio
		});
	}

	private closePeerConnection(peerId: string): void {
		this.clearCheckingTimeout(peerId);
		this.clearRestartWatchdog(peerId);
		this.clearDisconnectedTimeout(peerId);
		const pc = this.peerConnections.get(peerId);
		if (pc) {
			pc.close();
			this.peerConnections.delete(peerId);
		}
		this.localVideoSenders.delete(peerId);
		this.iceRestartAttempts.delete(peerId);
		this.relayFallbackApplied.delete(peerId);
		this.iceRestartInFlight.delete(peerId);
		this.pendingIceRestartReasons.delete(peerId);
		this.pendingRemoteRelayReasons.delete(peerId);
		this.connectionFailuresHandled.delete(peerId);
		this.pendingCandidates.delete(peerId);
		this.remoteStreams.delete(peerId);
		this.callMetrics.delete(peerId);
		const dc = this.dataChannels.get(peerId);
		if (dc) {
			dc.close();
			this.dataChannels.delete(peerId);
		}
	}

	endCallLocal(peerId: string): void {
		this.sendSignal(peerId, 'hangup', undefined, { callType: this.getCallType() });
		this.closePeerConnection(peerId);
	}

	endCallRemote(peerId: string): void {
		this.closePeerConnection(peerId);
	}

	createDataChannel(peerId: string): RTCDataChannel {
		const pc = this.getPeerConnection(peerId);
		const channel = pc.createDataChannel('files', { ordered: true });
		this.setupDataChannel(peerId, channel);
		return channel;
	}

	private getPeerConnection(peerId: string): RTCPeerConnection {
		return this.peerConnections.get(peerId) ?? this.createPeerConnection(peerId);
	}

	private createPeerConnection(peerId: string): RTCPeerConnection {
		const pc = new RTCPeerConnection(this.config);

		const pendingRemoteRelayReason = this.pendingRemoteRelayReasons.get(peerId);
		if (pendingRemoteRelayReason) {
			pc.setConfiguration({ ...this.config, iceTransportPolicy: 'relay' });
			this.relayFallbackApplied.add(peerId);
			this.ensureMetrics(peerId).icePolicyCurrent = 'relay';
			this.logTelemetry(peerId, 'relay_fallback_applied', {
				reason: pendingRemoteRelayReason,
				origin: 'pending_incoming_offer'
			});
			this.pendingRemoteRelayReasons.delete(peerId);
		}

		pc.onicecandidate = (event) => {
			if (event.candidate) {
				const metrics = this.ensureMetrics(peerId);
				metrics.firstLocalCandidateAt ??= Date.now();
				this.sendSignal(peerId, 'candidate', event.candidate.toJSON());
			}
		};

		pc.ontrack = (event) => {
			const metrics = this.ensureMetrics(peerId);
			metrics.firstRemoteTrackAt ??= Date.now();

			if (!this.onRemoteStream)
				return;

			if (event.streams[0]) {
				this.remoteStreams.set(peerId, event.streams[0]);
				this.onRemoteStream(peerId, event.streams[0]);
				return;
			}

			const existingStream = this.remoteStreams.get(peerId);
			if (existingStream) {
				existingStream.addTrack(event.track);
				this.onRemoteStream(peerId, existingStream);
				return;
			}

			const fallbackStream = new MediaStream([event.track]);
			this.remoteStreams.set(peerId, fallbackStream);
			this.onRemoteStream(peerId, fallbackStream);
		};

		pc.onconnectionstatechange = () => {
			this.logTelemetry(peerId, 'connection_state_changed', { state: pc.connectionState });
			if (pc.connectionState === 'connected') {
				const metrics = this.ensureMetrics(peerId);
				metrics.connectedAt = Date.now();
				this.logConnectionSummary(peerId);
				void this.logSelectedCandidatePair(peerId, pc);
			}
			if (this.onConnectionStateChange) this.onConnectionStateChange(peerId, pc.connectionState);
		};

		pc.oniceconnectionstatechange = () => {
			const state = pc.iceConnectionState;
			this.logTelemetry(peerId, 'ice_state', { state });

			if (state === 'checking') {
				this.scheduleCheckingTimeout(peerId, pc);
			} else if (state === 'connected' || state === 'completed') {
				this.clearCheckingTimeout(peerId);
				this.clearRestartWatchdog(peerId);
				this.clearDisconnectedTimeout(peerId);
			} else if (state === 'disconnected') {
				this.clearCheckingTimeout(peerId);
				this.scheduleDisconnectedRecovery(peerId, pc);
			} else if (state === 'failed') {
				this.clearCheckingTimeout(peerId);
				this.clearDisconnectedTimeout(peerId);
				void this.requestIceRestart(peerId, `ice_${state}`);
			} else if (state === 'closed') {
				this.clearCheckingTimeout(peerId);
				this.clearRestartWatchdog(peerId);
				this.clearDisconnectedTimeout(peerId);
			}
		};

		pc.onsignalingstatechange = () => {
			if (pc.signalingState !== 'stable') return;

			const pendingIceRestartReason = this.pendingIceRestartReasons.get(peerId);
			if (pendingIceRestartReason) {
				this.pendingIceRestartReasons.delete(peerId);
				void this.requestIceRestart(peerId, pendingIceRestartReason);
				return;
			}

			if (this.pendingRenegotiation.has(peerId)) void this.renegotiateAll();
		};

		pc.ondatachannel = (event) => this.setupDataChannel(peerId, event.channel);

		this.peerConnections.set(peerId, pc);
		return pc;
	}

	private setupDataChannel(peerId: string, channel: RTCDataChannel): void {
		channel.binaryType = 'arraybuffer';
		channel.onmessage = (e) => this.onDataChannelMessage?.(peerId, e.data);
		channel.onopen = () => this.logTelemetry(peerId, 'data_channel_open');
		channel.onclose = () => this.dataChannels.delete(peerId);
		this.dataChannels.set(peerId, channel);
	}

	private async handleSignalingMessage(data: SignalEventData): Promise<void> {
		const { type, senderId, payload, callType, forceRelay, reason } = data;
		switch (type) {
			case 'offer': {
				this.ensureMetrics(senderId, { direction: 'incoming', callType: callType ?? CallType.audio });
				if (callType && this.onRemoteCallType) this.onRemoteCallType(senderId, callType);

				const pc = this.peerConnections.get(senderId);
				if (pc) {
					if (forceRelay) {
						pc.setConfiguration({ ...this.config, iceTransportPolicy: 'relay' });
						this.relayFallbackApplied.add(senderId);
						this.ensureMetrics(senderId).icePolicyCurrent = 'relay';
						this.logTelemetry(senderId, 'relay_fallback_applied', {
							reason: getNonEmptyStringOrFallback(reason, 'remote_offer'),
							origin: 'remote'
						});
					}
					if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
					await pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit));
					await this.flushPendingCandidates(senderId);
					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);
					this.sendSignal(senderId, 'answer', answer, { callType: this.getCallType() });
				} else if (this.onIncomingCall) {
					if (forceRelay) {
						const relayReason = getNonEmptyStringOrFallback(reason, 'remote_offer');
						this.pendingRemoteRelayReasons.set(senderId, relayReason);
						this.logTelemetry(senderId, 'relay_fallback_pending', {
							reason: relayReason,
							origin: 'remote'
						});
					}
					this.onIncomingCall(senderId, payload as RTCSessionDescriptionInit, callType);
				}
				break;
			}

			case 'answer': {
				const pcA = this.peerConnections.get(senderId);
				if (pcA) {
					await pcA.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit));
					this.ensureMetrics(senderId).answerReceivedAt = Date.now();
					await this.flushPendingCandidates(senderId);
				}
				break;
			}

			case 'candidate': {
				const pcC = this.peerConnections.get(senderId);
				if (pcC?.remoteDescription) {
					try { await pcC.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit)); }
					catch { this.queueCandidate(senderId, payload as RTCIceCandidateInit); }
				} else {
					this.queueCandidate(senderId, payload as RTCIceCandidateInit);
				}
				break;
			}

			case 'hangup':
				this.endCallRemote(senderId);
				this.onRemoteHangup?.(senderId);
				break;
		}
	}

	private queueCandidate(peerId: string, candidate: RTCIceCandidateInit) {
		const pending = this.pendingCandidates.get(peerId) ?? [];
		pending.push(candidate);
		this.pendingCandidates.set(peerId, pending);
	}

	private sendSignal(targetId: string, type: SignalType, payload: SignalPayload, extra?: Partial<SignalExtra>): void {
		webSocketService.send('signal', { type, targetId, payload, ...extra });
	}
}

const webRTCService = new WebRTCService();

export { webRTCService };
