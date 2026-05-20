import { useEffect, useMemo, useState } from 'react';

import { AlertCircle } from '@/assets';
import { RenderIf } from '@/helpers/render-conditional';
import type { Notification as NotificationProps } from '@/types';

import type { FC} from 'react';

const DISPLAY_DURATION_MS = 3000;
const FADE_DURATION_MS = 700;

const Notification: FC<NotificationProps> = ({ message, type }) => {
	const [messageToShow, setMessageToShow] = useState<string | null>(null);
	const [isVisible, setIsVisible] = useState<boolean>(false);
	const [typeToShow, setTypeToShow] = useState<NotificationProps['type']>('info');

	const notificationTone = useMemo(() => {
		switch (typeToShow) {
			case 'success':
				return {
					label: 'Success',
					containerClassName: 'border-emerald-400/20 bg-[linear-gradient(180deg,rgba(16,185,129,0.18),rgba(8,13,24,0.96))] text-emerald-50 shadow-[0_18px_40px_rgba(5,150,105,0.18)]',
					accentClassName: 'bg-emerald-300 shadow-[0_0_0_5px_rgba(110,231,183,0.12)]'
				};
			case 'error':
				return {
					label: 'Error',
					containerClassName: 'border-red-400/22 bg-[linear-gradient(180deg,rgba(239,68,68,0.18),rgba(8,13,24,0.96))] text-red-50 shadow-[0_18px_40px_rgba(127,29,29,0.2)]',
					accentClassName: 'text-red-100'
				};
			case 'info':
			case 'undefined':
			default:
				return {
					label: 'Info',
					containerClassName: 'border-primary-300/20 bg-[linear-gradient(180deg,rgba(56,189,248,0.16),rgba(8,13,24,0.96))] text-primary-50 shadow-[0_18px_40px_rgba(14,116,144,0.18)]',
					accentClassName: 'text-primary-100'
				};
		}
	}, [typeToShow]);

	useEffect(() => {
		if (message) {
			const showTimer = window.setTimeout(() => {
				setMessageToShow(message);
				setTypeToShow(type);
				setIsVisible(true);
			}, 0);

			const hideTimer = window.setTimeout(() => {
				setIsVisible(false);
			}, DISPLAY_DURATION_MS);

			return () => {
				window.clearTimeout(showTimer);
				window.clearTimeout(hideTimer);
			};
		}

		return undefined;
	}, [message, type]);

	useEffect(() => {
		if (!isVisible && messageToShow) {
			const removeTimer = window.setTimeout(() => {
				setMessageToShow(null);
			}, FADE_DURATION_MS);

			return () => window.clearTimeout(removeTimer);
		}

		return undefined;
	}, [isVisible, messageToShow]);

	return (
		<RenderIf
			condition={messageToShow !== null}
			then={
				<div
					className={`pointer-events-none fixed left-1/2 top-[calc(var(--safe-area-top)+0.85rem)] z-50 w-[calc(100%-1rem)] max-w-md -translate-x-1/2 rounded-3xl border px-4 py-3 backdrop-blur-xl transition-[opacity,transform] duration-700 sm:left-auto sm:right-4 sm:w-[min(26rem,calc(100%-2rem))] sm:translate-x-0 ${notificationTone.containerClassName} ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
					style={{ transitionDuration: `${FADE_DURATION_MS}ms` }}
					role={typeToShow === 'error' ? 'alert' : 'status'}
				>
					<div className="flex items-start gap-3">
						<RenderIf
							condition={typeToShow === 'success'}
							then={<span className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${notificationTone.accentClassName}`} aria-hidden="true" />}
							otherwise={
								<span className={`inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-xl border border-white/10 bg-white/6 ${notificationTone.accentClassName}`}>
									<AlertCircle className="h-4 w-4" />
								</span>
							}
						/>
						<div className="min-w-0">
							<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/65">{notificationTone.label}</p>
							<p className="mt-1 text-sm font-medium leading-6 text-white/96">{messageToShow}</p>
						</div>
					</div>
				</div>
			}
			otherwise={null}
		/>
	);
};

export default Notification;