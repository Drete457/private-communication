
import { RenderIf } from '@/helpers/render-conditional';
import type { User } from '@/types';

import type { FC } from 'react';

interface PeerListProps {
	peers: ReadonlyArray<User>;
	selectedPeerId: string | null;
	onSelectPeer: (peerId: string) => void;
	unreadCounts: Readonly<Record<string, number>>;
}

const getNonEmptyStringOrUndefined = (value: string | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	getNonEmptyStringOrUndefined(value) ?? fallback
);

const getPeerAvatarLabel = (peer: User): string => (
	getNonEmptyStringOrUndefined(peer.displayName?.[0]) ?? peer.userId.slice(0, 2).toUpperCase()
);

const getUnreadCount = (unreadCounts: Readonly<Record<string, number>>, peerId: string): number => unreadCounts[peerId] ?? 0;

const PeerList: FC<PeerListProps> = ({ peers, selectedPeerId, onSelectPeer, unreadCounts }) => (
	<RenderIf condition={peers.length > 0} then={
		<div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
			<div className="space-y-2">
				{peers.map(peer => (
					<button
						type="button"
						key={peer.userId}
						onClick={() => onSelectPeer(peer.userId)}
						className={`group flex w-full items-center gap-3 rounded-[1.35rem] border px-3 py-3 text-left transition-[transform,background-color,border-color,box-shadow] sm:px-4 ${selectedPeerId === peer.userId
							? 'border-primary-400/30 bg-primary-500/12 shadow-[0_18px_40px_rgba(6,182,212,0.12)]'
							: 'border-white/6 bg-dark-300/24 hover:-translate-y-px hover:border-white/10 hover:bg-dark-300/48'
						}`}
					>
						<div className="relative shrink-0">
							<div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 sm:h-12 sm:w-12">
								<span className="text-white font-medium">
									{getPeerAvatarLabel(peer)}
								</span>
							</div>
							<div
								className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-dark-200 ${peer.isOnline ? 'bg-green-500' : 'bg-gray-500'}`}
							/>
						</div>

						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold text-white sm:text-base">
								{getNonEmptyStringOrFallback(peer.displayName, `User ${peer.userId.slice(0, 8)}`)}
							</p>
							<p className="app-text-muted mt-1 text-xs sm:text-sm md:overflow-visible md:text-clip md:whitespace-normal">
								{peer.isOnline ? 'Available for messages and calls' : 'Offline'}
							</p>
						</div>

						<div className="flex shrink-0 flex-col items-end gap-2">
							<RenderIf condition={getUnreadCount(unreadCounts, peer.userId) > 0}
								then={
									<div className="flex min-h-6 min-w-6 items-center justify-center rounded-full bg-primary-500 px-2 text-xs font-semibold text-white shadow-[0_10px_20px_rgba(6,182,212,0.18)]">
										{getUnreadCount(unreadCounts, peer.userId) > 99 ? '99+' : getUnreadCount(unreadCounts, peer.userId)}
									</div>
								}
								otherwise={<span className="app-text-muted text-[0.7rem] uppercase tracking-[0.16em]">Open</span>}
							/>
						</div>
					</button>
				))}
			</div>
		</div>
	}
	otherwise={
		<div className="flex flex-1 items-center justify-center p-4 text-center text-gray-500">
			<div className="app-panel-muted max-w-sm px-5 py-6">
				<p className="app-display-title text-base text-white">No contacts yet</p>
				<p className="app-text-muted mt-2 text-sm">Add a peer to start a secure conversation.</p>
			</div>
		</div>}
	/>
);

export default PeerList;