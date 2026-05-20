import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { ChatBubble, LibraryShelf, SettingsSliders } from '@/assets';
import { navigation  } from '@/helpers/navigation/navigation-items';
import type {NavigationItem} from '@/helpers/navigation/navigation-items';
import { RenderIf } from '@/helpers/render-conditional';
import { useAuthStore } from '@/store/auth-store';
import { useMessagesStore } from '@/store/messages-store';

import type { FC} from 'react';

interface NavigationItemLinkProps {
	item: NavigationItem;
	isMobile?: boolean;
}

const NavigationItemLink: FC<NavigationItemLinkProps> = ({ item, isMobile = false }) => {
	const location = useLocation();
	const { userId } = useAuthStore();
	const { messages } = useMessagesStore();

	const activeChatPeerId = useMemo(() => {
		if (!location.pathname.startsWith(navigation.Chat)) 
			return null;

		const chatPath = `${navigation.Chat}/`;
		if (!location.pathname.startsWith(chatPath)) 
			return null;

		const peerId = location.pathname.slice(chatPath.length).split('/')[0];
		return peerId && peerId.length > 0 ? peerId : null;
	}, [location.pathname]);

	const unreadChatCount = useMemo(() => {
		if (!item.showUnreadCount || !userId) 
			return 0;

		let total = 0;
		messages.forEach((peerMessages, peerKey) => {
			if (peerKey === activeChatPeerId) 
				return;

			total += peerMessages.filter(
				(message) => message.senderId !== userId && message.status !== 'read'
			).length;
		});

		return total;
	}, [activeChatPeerId, item.showUnreadCount, messages, userId]);

	const getNavigationItemClassName = (isActive: boolean) => {
		if (isMobile) {
			return `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[0.68rem] font-semibold transition-all ${isActive
				? 'border border-primary-400/20 bg-primary-500/12 text-white shadow-[0_12px_24px_rgba(6,182,212,0.12)]'
				: 'text-gray-400 hover:bg-dark-300/70 hover:text-white'
			}`;
		}

		return `group relative flex min-h-14 w-full items-center gap-3 rounded-[1.2rem] border px-3 py-3 text-left transition-[transform,background-color,border-color,box-shadow] ${isActive
			? 'border-primary-300/24 bg-primary-500/12 text-white shadow-[0_14px_34px_rgba(6,182,212,0.12)]'
			: 'border-white/6 bg-white/[0.03] text-white/68 hover:-translate-y-px hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
		}`;
	};

	const getUnreadBadgeClassName = () => {
		if (isMobile)
			return 'left-1/2 top-1 ml-3';

		return 'right-3 top-1/2 -translate-y-1/2';
	};

	const renderIcon = () => {
		const className = isMobile ? 'h-5 w-5' : 'h-[1.35rem] w-[1.35rem]';

		if (item.icon === navigation.Chat)
			return <ChatBubble className={className} />;

		if (item.icon === navigation.Library)
			return <LibraryShelf className={className} />;

		return <SettingsSliders className={className} />;
	};

	return (
		<NavLink
			to={item.path}
			className={({ isActive }) => getNavigationItemClassName(isActive)}
			title={item.label}
		>
			<span className={`flex items-center justify-center ${isMobile ? '' : 'h-11 w-11 rounded-2xl border border-white/8 bg-dark-300/72 text-white/88 group-hover:border-white/14 group-hover:bg-dark-300'}`} aria-hidden="true">{renderIcon()}</span>
			<RenderIf
				condition={isMobile}
				then={<span>{item.label}</span>}
				otherwise={
					<div className="min-w-0 flex-1 pr-10">
						<p className="text-sm font-semibold">{item.label}</p>
						<p className="mt-0.5 text-xs text-white/42">{item.path === navigation.Chat ? 'Messages and peers' : item.path === navigation.Library ? 'Media and files' : 'Security and setup'}</p>
					</div>
				}
			/>
			{item.showUnreadCount ? (unreadChatCount > 0 ? (
				<span className={`absolute flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary-500 px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none text-white shadow-sm ${getUnreadBadgeClassName()}`}>
					{unreadChatCount > 99 ? '99+' : String(unreadChatCount)}
				</span>
			) : null) : null}
		</NavLink>
	);
};

export default NavigationItemLink;