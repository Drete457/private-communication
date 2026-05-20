import { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { SmallGenericButton } from '@/components/common/buttons/generic';
import { InstallPrompt } from '@/components/common/install';
import { GenericLoader } from '@/components/common/loaders';
import { useAttachmentTransferScreenWakeLock } from '@/helpers/attachments';
import { isMobileDevice, navigation, navItems } from '@/helpers/navigation';
import { RenderIf } from '@/helpers/render-conditional';
import { useCallStore } from '@/store/call-store';
import { useMessagesStore } from '@/store/messages-store';
import type { CallStatus } from '@/types';

import { AddContact } from '../add-contact';
import { ShareWebSiteButton } from '../share-website';

import GlobalTransferBanner from './global-transfer-banner';
import NavigationItemLink from './navigation-item-link';
import OfflineIndicator from './offline-indicator';

import type { FC, ReactNode} from 'react';

interface LayoutProps {
	children: ReactNode;
}

type ShellRailSide = 'left' | 'right';

type ShellRouteMeta = {
	eyebrow: string;
	title: string;
	description: string;
};

interface ShellState {
	eyebrow: string;
	title: string;
	description: string;
	isCallRoute: boolean;
	showDesktopRail: boolean;
	showDesktopHeader: boolean;
	showMobileHeader: boolean;
	showMobileAddContact: boolean;
	showMobileShare: boolean;
	showMobileBottomNav: boolean;
}

const SHELL_RAIL_SIDE_STORAGE_KEY = 'shell-rail-side';

const getInitialShellRailSide = (): ShellRailSide => {
	if (typeof window === 'undefined')
		return 'right';

	const storedValue = window.localStorage.getItem(SHELL_RAIL_SIDE_STORAGE_KEY);
	return storedValue === 'left' ? 'left' : 'right';
};

const getRouteMeta = (isLibraryRoute: boolean, isSettingsRoute: boolean, isChatDetailRoute: boolean): ShellRouteMeta => {
	if (isLibraryRoute) {
		return {
			eyebrow: 'Library workspace',
			title: 'Library',
			description: 'Review cached media, inspect context faster, and keep local storage under control.'
		};
	}

	if (isSettingsRoute) {
		return {
			eyebrow: 'System preferences',
			title: 'Settings',
			description: 'Identity, recovery, transport, and install controls stay grouped in one surface.'
		};
	}

	return {
		eyebrow: 'Conversation space',
		title: 'Chat',
		description: isChatDetailRoute
			? 'Stay inside the active conversation while the shell keeps navigation and actions within reach.'
			: 'Move between conversations quickly and keep the app state visible from a single shell.'
	};
};

const Layout: FC<LayoutProps> = ({ children }) => {
	const location = useLocation();
	const navigate = useNavigate();
	const { initializeListeners } = useMessagesStore();
	const { status: callStatus, peerId: callPeerId, initializeListeners: initializeCallListeners } = useCallStore();
	useAttachmentTransferScreenWakeLock();
	const [shellRailSide, setShellRailSide] = useState<ShellRailSide>(getInitialShellRailSide);
	const isMobile = isMobileDevice();

	const getShellState = (): ShellState => {
		const callPath: string = navigation.Call;
		const chatPath: string = navigation.Chat;
		const libraryPath: string = navigation.Library;
		const settingsPath: string = navigation.Settings;
		const isCallRoute = location.pathname.startsWith(callPath);
		const isChatDetailRoute = location.pathname.startsWith(`${chatPath}/`);
		const isChatListRoute = location.pathname === chatPath;
		const isLibraryRoute = location.pathname === libraryPath;
		const isSettingsRoute = location.pathname === settingsPath;
		const isChatRoute = location.pathname.startsWith(chatPath);

		const routeMeta = getRouteMeta(isLibraryRoute, isSettingsRoute, isChatDetailRoute);

		return {
			eyebrow: routeMeta.eyebrow,
			title: routeMeta.title,
			description: routeMeta.description,
			isCallRoute,
			showDesktopRail: !isCallRoute,
			showDesktopHeader: !isCallRoute && !isChatDetailRoute,
			showMobileHeader: !isCallRoute && !isChatDetailRoute,
			showMobileAddContact: isChatListRoute,
			showMobileShare: isChatRoute || isSettingsRoute,
			showMobileBottomNav: isMobile && !isCallRoute
		};
	};

	const renderNavigationItems = (mobile = false) => navItems.map(item => (
		<NavigationItemLink key={item.path} item={item} isMobile={mobile} />
	));

	const shellState = getShellState();

	const getRouteTransitionKey = () => {
		if (location.pathname.startsWith(navigation.Chat))
			return navigation.Chat;

		const [_, section = 'root'] = location.pathname.split('/');
		return `/${section}`;
	};

	const renderRouteLoadingFallback = () => (
		<div className="flex h-full min-h-0 items-center justify-center px-6 text-center animate-fade-in">
			<GenericLoader />
		</div>
	);

	const routeTransitionKey = getRouteTransitionKey();

	const hasOngoingCall = (callStatus: CallStatus): boolean => {
		if (callStatus === 'initiating' || callStatus === 'ringing' || callStatus === 'connecting' || callStatus === 'connected')
			return true;

		return false;
	};
	
	const toggleShellRailSide = () => {
		setShellRailSide((current) => current === 'right' ? 'left' : 'right');
	};

	useEffect(() => {
		initializeListeners();
		initializeCallListeners();
	}, [initializeListeners, initializeCallListeners]);

	// Navigate to call view whenever a call is ongoing
	useEffect(() => {
		if (!hasOngoingCall(callStatus) || !callPeerId)
			return;

		const expectedPath = `${navigation.Call}/${callPeerId}`;
		if (location.pathname !== expectedPath)
			void navigate(expectedPath);
	}, [callStatus, callPeerId, navigate, location.pathname]);

	useEffect(() => {
		if (!hasOngoingCall(callStatus))
			return;

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};

		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		};
	}, [callStatus]);

	useEffect(() => {
		const root = document.documentElement;

		const updateAppHeight = () => {
			const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
			root.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
		};

		updateAppHeight();
		window.visualViewport?.addEventListener('resize', updateAppHeight);
		window.visualViewport?.addEventListener('scroll', updateAppHeight);
		window.addEventListener('resize', updateAppHeight);

		return () => {
			window.visualViewport?.removeEventListener('resize', updateAppHeight);
			window.visualViewport?.removeEventListener('scroll', updateAppHeight);
			window.removeEventListener('resize', updateAppHeight);
		};
	}, []);

	useEffect(() => {
		window.localStorage.setItem(SHELL_RAIL_SIDE_STORAGE_KEY, shellRailSide);
	}, [shellRailSide]);

	useEffect(() => {
		const pageTitle = shellState.isCallRoute ? 'Call' : shellState.title;
		document.title = `Private Communication | ${pageTitle}`;
	}, [shellState.isCallRoute, shellState.title]);

	return (
		<div className="app-shell-shell flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: 'var(--app-height, 100dvh)' }}>
			<a className="app-skip-link" href="#app-main-content">Skip to main content</a>
			<OfflineIndicator />
			<GlobalTransferBanner />

			<div className={`flex min-h-0 flex-1 overflow-hidden ${shellRailSide === 'right' ? 'md:flex-row-reverse' : ''}`.trim()}>
				<RenderIf
					condition={shellState.showDesktopRail}
					then={
						<aside data-side={shellRailSide} className="app-shell-rail hidden min-h-0 w-75 shrink-0 flex-col px-4 py-4 md:flex xl:w-82 xl:px-5 xl:py-5">
							<div className="app-shell-rail-panel flex min-h-0 flex-1 flex-col gap-5 p-4 xl:p-5">
								<div className="space-y-3">
									<div>
										<p className="app-text-muted text-[0.7rem] font-semibold uppercase tracking-[0.26em]">Private communication</p>
										<h1 className="app-display-title mt-2 text-[1.75rem] font-semibold leading-none text-white">Control shell</h1>
									</div>
									<p className="text-sm leading-relaxed text-white/62">A single frame for navigation, local state, and route context without breaking the encrypted flow.</p>
								</div>

								<nav className="flex flex-col gap-2" aria-label="Primary navigation">
									{renderNavigationItems()}
								</nav>

								<div className="mt-auto flex flex-col gap-3">
									<div className="flex flex-col gap-2 xl:flex-row">
										<AddContact smallButton />
										<ShareWebSiteButton />
									</div>
									<div className="app-shell-side-card space-y-3">
										<div>
											<p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-primary-100/76">Current route</p>
											<p className="mt-2 text-base font-semibold text-white">{shellState.title}</p>
											<p className="mt-2 text-sm leading-relaxed text-white/58">{shellState.description}</p>
										</div>
										<SmallGenericButton onClick={toggleShellRailSide} className="w-full justify-center border-white/10 bg-white/5 text-white/72 enabled:hover:border-white/20 enabled:hover:bg-white/8">
											<RenderIf condition={shellRailSide === 'right'} then="Move rail to left" otherwise="Move rail to right" />
										</SmallGenericButton>
									</div>
								</div>
							</div>
						</aside>
					}
					otherwise={null}
				/>

				<div className={`flex min-h-0 flex-1 flex-col overflow-hidden md:p-4 xl:p-5 ${shellRailSide === 'right' ? 'md:pr-0 xl:pr-0' : 'md:pl-0 xl:pl-0'}`.trim()}>
					<RenderIf
						condition={shellState.showMobileHeader}
						then={
							<header className="app-mobile-top-bar relative flex items-start justify-between gap-3 px-4 pb-3 pt-[calc(var(--safe-area-top)+0.9rem)] md:hidden">
								<div className="min-w-0">
									<p className="app-text-muted text-[0.7rem] font-semibold uppercase tracking-[0.24em]">{shellState.eyebrow}</p>
									<h1 className="app-display-title mt-1 text-sm font-semibold text-white">{shellState.title}</h1>
									<p className="mt-1 max-w-76 text-sm leading-relaxed text-white/58">{shellState.description}</p>
								</div>
								<section className="flex items-center gap-2">
									<RenderIf condition={shellState.showMobileAddContact} then={<AddContact smallButton offsetFromMobileHeader />} otherwise={null} />
									<RenderIf condition={shellState.showMobileShare} then={<ShareWebSiteButton offsetFromMobileHeader />} otherwise={null} />
								</section>
							</header>
						}
						otherwise={null}
					/>

					<RenderIf
						condition={shellState.showDesktopHeader}
						then={
							<header className="app-shell-header mb-3 hidden px-5 py-4 md:flex xl:mb-4 xl:px-6 xl:py-4">
								<div className="min-w-0">
									<p className="app-text-muted text-[0.72rem] font-semibold uppercase tracking-[0.24em]">{shellState.eyebrow}</p>
									<h2 className="app-display-title mt-1.5 text-[1.65rem] font-semibold leading-none text-white">{shellState.title}</h2>
									<p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/58">{shellState.description}</p>
								</div>
							</header>
						}
						otherwise={null}
					/>

					<main id="app-main-content" tabIndex={-1} className={`relative flex-1 min-h-0 overflow-hidden ${shellState.isCallRoute
						? ''
						: 'app-shell-frame md:rounded-4xl'} `.trim()}>
						<InstallPrompt />
						<Suspense
							key={routeTransitionKey}
							fallback={renderRouteLoadingFallback()}
						>
							<div key={routeTransitionKey} className="h-full animate-fade-in">
								{children}
							</div>
						</Suspense>
					</main>
				</div>
			</div>

			<RenderIf
				condition={shellState.showMobileBottomNav}
				then={
					<nav className="app-mobile-bottom-nav px-3 pb-[calc(var(--safe-area-bottom)+0.75rem)] pt-3 md:hidden">
						<div className="rounded-[1.7rem] border border-white/6 bg-[linear-gradient(180deg,rgba(11,23,38,0.9),rgba(7,16,27,0.98))] p-2 shadow-[0_22px_52px_rgba(0,0,0,0.34)]">
							<div className="flex items-center gap-2 rounded-[1.35rem] border border-white/6 bg-dark-200/58 p-1.5">
								{renderNavigationItems(true)}
							</div>
						</div>
					</nav>
				}
				otherwise={null}
			/>
		</div>
	);
}

export default Layout;