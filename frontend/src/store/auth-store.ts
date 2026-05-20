// AuthStore - Global authentication and identity state

/* 
 * Manages:
 * - User's cryptographic identity
 * - Key initialization status
 * - Connection and authentication state
 */

import { create } from 'zustand';

import {
	exportPublicKey,
	hashPublicKey,
	generateFingerprint
} from '@/crypto';
import { getKeyPair, hasKeys, clearAllKeys } from '@/crypto/key-manager';
import { clearAuthSession, setAuthSession } from '@/services/auth-session-service';
import { createNewIdentity } from '@/services/identity-provision-service';
import { clientLogger } from '@/services/logger';
import { clearMessageDatabase } from '@/services/message-service';
import { removePushSubscription } from '@/services/push-service';
import { webSocketService } from '@/services/web-socket-service';

interface AuthState {
  // Identity
  userId: string | null;
  publicKey: string | null;
	signingPublicKey: string | null;
  fingerprint: string | null;
  isInitialized: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  generateIdentity: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  deleteIdentity: () => Promise<void>;

	// Full loading state (including async init)
	fullLoaded: boolean;
}

const useAuthStore = create<AuthState>((set, get) => ({
	userId: null,
	publicKey: null,
	signingPublicKey: null,
	fingerprint: null,
	isInitialized: false,
	fullLoaded: false,

	// Initialize from stored keys or mark as needing setup
	initialize: async () => {
		const keysExist = await hasKeys();
    
		if (keysExist) {
			const encryptionKeyPair = await getKeyPair('encryption');
			const signingKeyPair = await getKeyPair('signing');
			if (encryptionKeyPair) {
				const publicKey = await exportPublicKey(encryptionKeyPair.publicKey);
				const userId = await hashPublicKey(encryptionKeyPair.publicKey);
				const fingerprint = await generateFingerprint(encryptionKeyPair.publicKey);
				const signingPublicKey = signingKeyPair
					? await exportPublicKey(signingKeyPair.publicKey)
					: null;
        
				const authSession = {
					userId,
					publicKey,
					signingPublicKey,
					fingerprint,
				};
				setAuthSession(authSession);
				set({
					...authSession,
					isInitialized: true,
					fullLoaded: true
				});

				// Auto-connect to signaling server
				webSocketService.setUserId(userId);
				await get().connect();
			}
		} else {
			clearAuthSession();
			set({ isInitialized: false, fullLoaded: true });
		}
	},

	// Generate new cryptographic identity
	generateIdentity: async () => {
		const {
			encryptionPublicKey,
			signingPublicKey,
			userId,
			fingerprint
		} = await createNewIdentity();

		const authSession = {
			userId,
			publicKey: encryptionPublicKey,
			signingPublicKey,
			fingerprint
		};
		setAuthSession(authSession);
		set({
			...authSession,
			isInitialized: true
		});

		// Connect and register with server
		webSocketService.setUserId(userId);
		await get().connect();
    
		// Register public key on first connect
		webSocketService.send('register_key', { 
			encryptionPublicKey,
			signingPublicKey
		});
	},

	// Connect to signaling server
	connect: async () => {
		try {
			await webSocketService.connect();
		} catch (error) {
			clientLogger.error('Failed to connect:', error);
		}
	},

	// Disconnect from signaling server/
	disconnect: () => {
		webSocketService.disconnect();
	},

	// Delete all locally stored identity and disconnect
	deleteIdentity: async () => {
		const currentUserId = get().userId;
		try {
			await removePushSubscription(currentUserId);
		} catch (error) {
			clientLogger.warn('Failed to remove push subscription', error);
		}
		try {
			localStorage.removeItem('pwa-install-dismissed');
		} catch (error) {
			clientLogger.debug('Failed to clear PWA install flag:', error);
		}
		await clearAllKeys();
		await clearMessageDatabase();
		clearAuthSession();
		webSocketService.setUserId(null);
		webSocketService.disconnect();
		set({
			userId: null,
			publicKey: null,
			signingPublicKey: null,
			fingerprint: null,
			isInitialized: false
		});

		if (typeof window !== 'undefined') {
			try {
				if ('caches' in window) {
					const keys = await caches.keys();
					await Promise.all(keys.map(key => caches.delete(key)));
				}
			} catch (error) {
				clientLogger.warn('Failed to clear browser caches during identity delete:', error);
			}

			try {
				if ('serviceWorker' in navigator) {
					const registrations = await navigator.serviceWorker.getRegistrations();
					await Promise.all(registrations.map(reg => reg.unregister()));
				}
			} catch (error) {
				clientLogger.warn('Failed to unregister service workers during identity delete:', error);
			}
		}
	}
}));

export { useAuthStore };
