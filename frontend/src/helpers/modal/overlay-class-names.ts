interface OverlayShellClassNames {
	backdropClassName: string;
	surfaceClassName: string;
}

const getOffsetOverlayClassNames = (
	offsetFromMobileHeader: boolean,
	maxWidthClassName: string
): OverlayShellClassNames => ({
	backdropClassName: offsetFromMobileHeader ? 'pt-[calc(var(--safe-area-top)+5.75rem)]' : '',
	surfaceClassName: `${offsetFromMobileHeader
		? 'max-h-[calc(var(--app-height,100dvh)-var(--safe-area-top)-var(--safe-area-bottom)-6.75rem)]'
		: ''} ${maxWidthClassName} p-0 animate-fade-in`.trim()
});

export { getOffsetOverlayClassNames };
export type { OverlayShellClassNames };