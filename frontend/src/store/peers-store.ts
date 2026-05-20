
// PeersStore - Manages peer connections and online status
import { create } from 'zustand';

import { getAllPeerKeys, deletePeerKey, markPeerKeyVerified, updatePeerDisplayName } from '@/crypto/key-manager';
import { deleteConversation } from '@/services/message-service';
import { setPeerRefreshHandler } from '@/services/peer-refresh-service';
import { webSocketService } from '@/services/web-socket-service';
import type { User } from '@/types';

interface PeersState {
  peers: User[];
  onlinePeers: Set<string>;
  selectedPeerId: string | null;
	listenersInitialized?: boolean;
	isLoading: boolean;
  
  // Actions
  loadPeers: () => Promise<void>;
  removePeer: (userId: string) => Promise<void>;
  selectPeer: (userId: string | null) => void;
  setOnline: (userId: string, isOnline: boolean) => void;
	markPeerVerified: (userId: string) => Promise<void>;
	updateDisplayName: (userId: string, displayName: string) => Promise<void>;
}

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const sortPeersByOnline = (peers: User[]): User[] => {
	return [...peers].sort((a, b) => {
		const aOnline = a.isOnline ? 1 : 0;
		const bOnline = b.isOnline ? 1 : 0;
		if (aOnline !== bOnline) 
			return bOnline - aOnline;
		
		const aName = getNonEmptyStringOrFallback(a.displayName, a.userId).toLowerCase();
		const bName = getNonEmptyStringOrFallback(b.displayName, b.userId).toLowerCase();
		return aName.localeCompare(bName);
	});
};

const usePeersStore = create<PeersState>((set, get) => ({
	peers: [],
	onlinePeers: new Set(),
	selectedPeerId: null,
	listenersInitialized: false,
	isLoading: false,

	// Load all stored peers from IndexedDB
	loadPeers: async () => {
		setPeerRefreshHandler(() => get().loadPeers());
		set({ isLoading: true });
		const storedPeers = await getAllPeerKeys();
		const peers: User[] = storedPeers.map(p => ({
			userId: p.peerId,
			publicKey: p.encryptionPublicKey ?? '',
			displayName: p.displayName,
			isOnline: get().onlinePeers.has(p.peerId),
			lastSeen: p.lastVerified
		}));
    
		set({ peers: sortPeersByOnline(peers), isLoading: false });

		if (!get().listenersInitialized) {
			// Listen for peer status updates
			webSocketService.on('peer_online', ({ userId }) => {
				get().setOnline(userId, true);
			});

			webSocketService.on('peer_offline', ({ userId }) => {
				get().setOnline(userId, false);
			});

			webSocketService.on('peers_list', ({ onlinePeers }) => {
				const onlineSet = new Set(onlinePeers);
				set({ onlinePeers: onlineSet });
      
				// Update peer online status
				const updatedPeers = get().peers.map(p => ({
					...p,
					isOnline: onlineSet.has(p.userId)
				}));
				set({ peers: sortPeersByOnline(updatedPeers) });
			});

			set({ listenersInitialized: true });
		}

		// Request current online peers list
		webSocketService.send('get_peers', {});
	},

	// Remove a peer
	removePeer: async (userId: string) => {
		await deletePeerKey(userId);
		await deleteConversation(userId);
    
		set(state => ({
			peers: state.peers.filter(p => p.userId !== userId),
			selectedPeerId: state.selectedPeerId === userId ? null : state.selectedPeerId
		}));
	},

	markPeerVerified: async (userId: string) => {
		await markPeerKeyVerified(userId);
		set(state => ({
			peers: state.peers.map(p =>
				p.userId === userId ? { ...p, lastSeen: Date.now() } : p
			)
		}));
	},

	updateDisplayName: async (userId: string, displayName: string) => {
		await updatePeerDisplayName(userId, displayName);
		set(state => ({
			peers: state.peers.map(p =>
				p.userId === userId ? { ...p, displayName } : p
			)
		}));
	},

	// Select a peer for messaging
	selectPeer: (userId: string | null) => {
		set({ selectedPeerId: userId });
	},

	// Update peer online status
	setOnline: (userId: string, isOnline: boolean) => {
		set(state => {
			const onlinePeers = new Set(state.onlinePeers);
			if (isOnline) {
				onlinePeers.add(userId);
			} else {
				onlinePeers.delete(userId);
			}

			const peers = state.peers.map(p => 
				p.userId === userId ? { ...p, isOnline } : p
			);

			return { onlinePeers, peers: sortPeersByOnline(peers) };
		});
	}
}));

export { usePeersStore };