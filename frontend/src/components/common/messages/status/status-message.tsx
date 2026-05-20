import type { FC } from 'react';

interface StatusMessageProps {
  message: string;
}

const StatusMessage: FC<StatusMessageProps> = ({ message }) => (
	<div className="rounded-2xl border border-emerald-400/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(6,10,20,0.74))] px-4 py-3 text-white shadow-[0_14px_34px_rgba(5,150,105,0.14)]">
		<div className="flex items-start gap-3">
			<span className="h-2.5 w-2.5 shrink-0 self-center rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" aria-hidden="true" />
			<div className="min-w-0">
				<p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-100/72">Status</p>
				<p className="mt-1 text-sm font-medium leading-6 text-emerald-50/96">{message}</p>
			</div>
		</div>
	</div>
);

export default StatusMessage;