import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { RenderIf } from '@/helpers/render-conditional';

import type { FC, ReactNode} from 'react';

type OverlayMode = 'dialog' | 'sheet' | 'fullscreen';

interface OverlayShellProps {
	active: boolean;
	onClose?: () => void;
	children: ReactNode;
	mode?: OverlayMode;
	surfaceClassName?: string;
	backdropClassName?: string;
	closeOnBackdrop?: boolean;
	ariaLabel?: string;
	labelledBy?: string;
	describedBy?: string;
}

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(', ');

const getFocusableElements = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
	.filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);

const overlayModeClassMap: Record<OverlayMode, string> = {
	dialog: 'max-w-md',
	sheet: 'max-w-3xl',
	fullscreen: 'app-overlay-fullscreen max-w-5xl'
};

const OverlayShell: FC<OverlayShellProps> = ({
	active,
	onClose,
	children,
	mode = 'dialog',
	surfaceClassName,
	backdropClassName,
	closeOnBackdrop = true,
	ariaLabel,
	labelledBy,
	describedBy
}) => {
	const overlayId = useId().replaceAll(':', '');
	const surfaceRef = useRef<HTMLDivElement | null>(null);
	const previousFocusedElementRef = useRef<HTMLElement | null>(null);
	const [generatedLabelledBy, setGeneratedLabelledBy] = useState<string | undefined>(undefined);
	const [generatedDescribedBy, setGeneratedDescribedBy] = useState<string | undefined>(undefined);

	useEffect(() => {
		if (!active)
			return;

		previousFocusedElementRef.current = document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;

		const frameId = window.requestAnimationFrame(() => {
			const surface = surfaceRef.current;
			if (!surface)
				return;

			const heading = surface.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
			if (heading) {
				if (!heading.id)
					heading.id = `overlay-title-${overlayId}`;

				setGeneratedLabelledBy(heading.id);
			} else {
				setGeneratedLabelledBy(undefined);
			}

			const description = surface.querySelector<HTMLElement>('p');
			if (description) {
				if (!description.id)
					description.id = `overlay-description-${overlayId}`;

				setGeneratedDescribedBy(description.id);
			} else {
				setGeneratedDescribedBy(undefined);
			}

			const focusableElements = getFocusableElements(surface);
			(focusableElements[0] ?? surface).focus();
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [active, overlayId]);

	useEffect(() => {
		if (active || !onClose)
			return;

		previousFocusedElementRef.current?.focus();
		previousFocusedElementRef.current = null;
	}, [active, onClose]);

	useEffect(() => {
		if (!active || !onClose)
			return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
				return;
			}

			if (event.key !== 'Tab')
				return;

			const surface = surfaceRef.current;
			if (!surface)
				return;

			const focusableElements = getFocusableElements(surface);
			if (focusableElements.length === 0) {
				event.preventDefault();
				surface.focus();
				return;
			}

			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];
			if (!firstElement || !lastElement) {
				event.preventDefault();
				surface.focus();
				return;
			}

			const activeElement = document.activeElement;

			if (!surface.contains(activeElement)) {
				event.preventDefault();
				firstElement.focus();
				return;
			}

			if (event.shiftKey && activeElement === firstElement) {
				event.preventDefault();
				lastElement.focus();
			}

			if (!event.shiftKey && activeElement === lastElement) {
				event.preventDefault();
				firstElement.focus();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [active, onClose]);

	const resolvedLabelledBy = labelledBy ?? generatedLabelledBy;
	const resolvedDescribedBy = describedBy ?? generatedDescribedBy;

	return (
		<RenderIf
			condition={active}
			then={createPortal(
				<div
					role="presentation"
					tabIndex={-1}
					className={`app-overlay-backdrop fixed inset-0 z-50 flex items-end justify-center px-3 pb-[calc(var(--safe-area-bottom)+0.75rem)] pt-[calc(var(--safe-area-top)+0.75rem)] backdrop-blur-md sm:items-center sm:px-4 sm:py-4 ${backdropClassName ?? ''}`.trim()}
					onClick={(event) => {
						if (event.target !== event.currentTarget)
							return;

						if (closeOnBackdrop)
							onClose?.();
					}}
					onKeyDown={(event) => {
						if (event.key === 'Escape' && closeOnBackdrop)
							onClose?.();
					}}
				>
					<div
						ref={surfaceRef}
						role="dialog"
						aria-modal="true"
						aria-label={ariaLabel}
						aria-labelledby={resolvedLabelledBy}
						aria-describedby={resolvedDescribedBy}
						tabIndex={-1}
						className={`app-modal-surface app-overlay-surface ${overlayModeClassMap[mode]} ${surfaceClassName ?? ''}`.trim()}
					>
						{children}
					</div>
				</div>,
				document.body
			)}
			otherwise={null}
		/>
	);
};

export default OverlayShell;
export type { OverlayMode, OverlayShellProps };