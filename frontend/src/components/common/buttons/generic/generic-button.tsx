import type { ButtonHTMLAttributes, FC, ReactNode } from "react"

interface GenericButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}

const GenericButton: FC<GenericButtonProps> = ({ onClick, disabled, children, className, ...rest }) => (
	<button
		onClick={onClick}
		disabled={disabled}
		className={`w-full rounded-xl border border-primary-400/20 bg-linear-to-b from-primary-600 to-primary-700 px-4 py-3 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_12px_30px_rgba(6,182,212,0.18)] transition-[transform,background-color,box-shadow,border-color] enabled:hover:-translate-y-px enabled:hover:from-primary-500 enabled:hover:to-primary-600 enabled:hover:shadow-[0_14px_36px_rgba(34,211,238,0.2)] enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`.trim()}
		{...rest}
	>
		{children}
	</button>
)

const RoundGenericButton: FC<GenericButtonProps> = ({ onClick, disabled, children, className, ...rest }) => (
	<button
		onClick={onClick}
		disabled={disabled}
		className={`rounded-full border border-primary-300/25 bg-linear-to-br from-primary-500 to-primary-700 p-3 text-white shadow-[0_16px_36px_rgba(6,182,212,0.2)] transition-[transform,background-color,box-shadow] enabled:hover:-translate-y-px enabled:hover:from-primary-400 enabled:hover:to-primary-600 enabled:hover:shadow-[0_18px_40px_rgba(34,211,238,0.24)] enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`.trim()}
		{...rest}
	>
		{children}
	</button>
)

const SmallGenericButton: FC<GenericButtonProps> = ({ onClick, disabled, children, className, ...rest }) => (
	<button
		onClick={onClick}
		disabled={disabled}
		className={`rounded-xl border border-white/10 bg-dark-300/92 px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition-[transform,background-color,border-color,box-shadow] enabled:hover:-translate-y-px enabled:hover:border-primary-400/30 enabled:hover:bg-dark-200 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`.trim()}
		{...rest}
	>
		{children}
	</button>
)

export default GenericButton;
export { RoundGenericButton, SmallGenericButton };