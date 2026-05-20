import { AlertCircle } from '@/assets';

import type { FC } from 'react';


interface ErrorMessageProps {
  message: string;
}

const ErrorMessage: FC<ErrorMessageProps> = ({ message }) => (
	<div className="rounded-2xl border border-red-400/20 bg-[linear-gradient(180deg,rgba(239,68,68,0.16),rgba(12,18,32,0.82))] px-4 py-3 text-white shadow-[0_14px_34px_rgba(127,29,29,0.16)]" role="alert">
		<div className="flex items-start gap-3">
			<span className="inline-flex h-8 w-8 shrink-0 self-center items-center justify-center rounded-xl border border-red-300/22 bg-red-500/14 text-red-100">
				<AlertCircle className="h-4 w-4" />
			</span>
			<div className="min-w-0">
				<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-red-100/76">Error</p>
				<p className="mt-1 text-sm font-medium leading-6 text-red-50/96">{message}</p>
			</div>
		</div>
	</div>
);

export default ErrorMessage;