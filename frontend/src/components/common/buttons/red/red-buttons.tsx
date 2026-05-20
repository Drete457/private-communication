import type { ButtonHTMLAttributes, FC, ReactNode } from 'react';

interface RedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}

const RedButton: FC<RedButtonProps> = ({ onClick, disabled, children, className, ...rest }) => (
	<button
		onClick={onClick}
		disabled={disabled}
		className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold tracking-[0.01em] transition-[transform,background-color,border-color,box-shadow] ${disabled
			? 'cursor-not-allowed border-white/6 bg-white/6 text-white/35'
			: 'border-red-400/18 bg-red-500/12 text-red-50 shadow-[0_12px_28px_rgba(127,29,29,0.18)] hover:-translate-y-px hover:border-red-300/28 hover:bg-red-500/18 hover:shadow-[0_16px_34px_rgba(127,29,29,0.24)] active:translate-y-0'
		} ${className ?? ''}`.trim()}
		{...rest}
	>
		{children}
	</button>
);

const SmallRedButton: FC<RedButtonProps> = ({ onClick, disabled, children, className, ...rest }) => (
	<button
		onClick={onClick}
		disabled={disabled}
		className={`absolute bottom-3 left-1/2 inline-flex min-h-9 -translate-x-1/2 items-center justify-center rounded-full border px-4 py-1.5 text-[0.8rem] font-semibold transition-[transform,background-color,border-color,box-shadow] ${disabled
			? 'cursor-not-allowed border-white/6 bg-white/8 text-white/35'
			: 'border-red-400/18 bg-red-500/14 text-red-50 shadow-[0_10px_24px_rgba(127,29,29,0.18)] hover:-translate-x-1/2 hover:-translate-y-px hover:border-red-300/28 hover:bg-red-500/20 hover:shadow-[0_14px_28px_rgba(127,29,29,0.24)]'
		} ${className ?? ''}`.trim()}
		{...rest}
	>
		{children}
	</button>
);

export default RedButton;
export { SmallRedButton };