/**
 * Type definitions for server-side operations
 */

/**
 * Encrypted message as received from client
 */
export interface EncryptedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  payload: {
    iv: string;
    cipherText: string;
    ephemeralPublicKey?: string;
  };
  signature: string;
}

/**
 * User registration data
 */
export interface UserRegistration {
  userId: string;
  publicKey: string;
  registeredAt: number;
}

/**
 * WebSocket message envelope
 */
export interface SocketMessage<T = unknown> {
  event: string;
  data: T;
  timestamp: number;
}

/**
 * Authentication challenge
 */
export interface AuthChallenge {
  nonce: string;
  timestamp: number;
}

/**
 * Authentication response from client
 */
export interface AuthResponse {
  userId: string;
  signature: string;
  publicKey: string;
}

/**
 * WebRTC signaling data
 */

// Minimal browser-independent definitions for WebRTC payloads (server only forwards them)
export interface RTCSessionDescriptionInit {
  type?: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SignalData {
  type: 'offer' | 'answer' | 'candidate';
  targetId: string;
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export type * from './attachments';
export type * from './websocket';
