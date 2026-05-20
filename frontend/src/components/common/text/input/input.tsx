import type { ChangeEvent, FC, InputHTMLAttributes } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const Input: FC<InputProps> = ({ value, onChange, placeholder, type = "text", ...props }) => (
	<input
		{...props}
		type={type}
		value={value}
		onChange={onChange}
		placeholder={placeholder}
		className="w-full rounded-xl border border-white/10 bg-dark-300/88 p-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-gray-500 focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20"
	/>
)

export default Input;