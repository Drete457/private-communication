
// WebRTC signaling data structures
interface SignalingData {
  type: 'offer' | 'answer' | 'candidate';
  senderId: string;
  recipientId: string;
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

enum CallType {
  audio = 'audio',
  video = 'video'
}

type CallStatus =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'busy'
  | 'ended'
  | 'failed';

// Call state management
interface CallState {
  isActive: boolean;
  type: CallType | null;
  peerId: string | null;
  status: CallStatus;
  isRecoveringCall: boolean;
  startTime?: number | undefined;
  localStream?: MediaStream | undefined;
  remoteStream?: MediaStream | undefined;
  remoteVideoEnabled?: boolean | undefined;
  isMuted?: boolean | undefined;
  isVideoEnabled?: boolean | undefined;
}

// Authentication challenge-response
interface AuthChallenge {
  nonce: string;
  timestamp: number;
}

// Authentication response structure
interface AuthResponse {
  userId: string;
  signature: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
}

type PendingIncomingCallResponse = {
  senderId: string;
  offer: RTCSessionDescriptionInit;
  callType: CallType;
  expiresAt: number;
};

type ActiveCallRecoveryResponse = {
  state: 'active';
  peerId: string;
  callType: CallType;
  expiresAt: number;
};

type PendingCallRecoveryResponse = {
  state: 'pending';
  senderId: string;
  offer: RTCSessionDescriptionInit;
  callType: CallType;
  expiresAt: number;
};

type NoCallRecoveryResponse = {
  state: 'none';
};

type CallRecoveryResponse =
  | ActiveCallRecoveryResponse
  | PendingCallRecoveryResponse
  | NoCallRecoveryResponse;

export type {
	SignalingData,
	CallState,
	CallStatus,
	AuthChallenge,
	AuthResponse,
	PendingIncomingCallResponse,
	CallRecoveryResponse,
	ActiveCallRecoveryResponse,
	PendingCallRecoveryResponse,
	NoCallRecoveryResponse
};
export { CallType };