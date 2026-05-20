import type { AttachmentKind, MessageAttachment } from './attachments';
import type { CallType } from "./communication";

interface EncryptedMessage {
  id: string;                    // UUID v4 message identifier
  senderId: string;              // Sender's userId (public key hash)
  recipientId: string;         
  timestamp: number;             // Unix timestamp
  senderKeys?: {
    encryptionPublicKey: string; // Base64 sender ECDH public key
    signingPublicKey: string;    // Base64 sender ECDSA public key
    fingerprint?: string | undefined;        // Optional fingerprint for verification
  } | undefined;
  payload: {
    iv: string;                  // Base64 initialization vector for AES-GCM
    cipherText: string;          // Base64 encrypted content
    ephemeralPublicKey?: string | undefined; // For ECDH key exchange
  };
  signature: string;             // ECDSA signature for integrity verification
}

// Decrypted message for local storage and display
interface DecryptedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  content: string;               // Decrypted message content
  replyTo?: ReplyReference | undefined;
  type: MessageType;
  status: MessageStatus;
  attachments?: MessageAttachment[] | undefined;
}

// Message content types
type MessageType = 'text' | 'file' | 'image' | CallType.audio | CallType.video;

// Message delivery status
type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// Reply reference metadata
interface ReplyReference {
  id: string;
  senderId: string;
  content: string;
  timestamp?: number | undefined;
  attachment?: ReplyAttachmentReference | undefined;
}

interface ReplyAttachmentReference {
  name: string;
  kind?: AttachmentKind | undefined;
  count: number;
}

// Link preview metadata
interface LinkPreviewRecord {
  readonly url: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly image?: string | undefined;
  readonly siteName?: string | undefined;
  readonly fetchedAt: number;
}

interface RemoteMediaRecord {
  readonly url: string;
  readonly blob: Blob;
  readonly mimeType: string;
  readonly extension: string;
  readonly isFavorite: boolean;
  readonly sourceHost: string;
  readonly peerId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAccessedAt: number;
  readonly expiresAt: number;
}

// Attachment download state for UI feedback
type AttachmentDownloadState = {
  status: 'idle' | 'downloading' | 'failed';
  progress: number;
  error?: string | undefined;
};

export type { EncryptedMessage, DecryptedMessage, MessageType, MessageStatus, LinkPreviewRecord, RemoteMediaRecord, ReplyReference, ReplyAttachmentReference, AttachmentDownloadState };