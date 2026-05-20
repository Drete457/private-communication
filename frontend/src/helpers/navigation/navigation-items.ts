enum navigation {
	Chat = '/chat',
	Call = '/call',
	Library = '/library',
	Settings = '/settings',
}

type NavigationIcon = navigation.Chat | navigation.Library | navigation.Settings;

type NavigationItem = {
	path: navigation;
	icon: NavigationIcon;
	label: string;
	showUnreadCount: boolean;
};

const navItems: ReadonlyArray<NavigationItem> = [
	{ path: navigation.Chat, icon: navigation.Chat, label: 'Chat', showUnreadCount: true },
	{ path: navigation.Library, icon: navigation.Library, label: 'Library', showUnreadCount: false },
	{ path: navigation.Settings, icon: navigation.Settings, label: 'Settings', showUnreadCount: false },
];

export { navItems, navigation };
export type { NavigationItem };