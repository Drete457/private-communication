import { forwardRef } from "react";

import type { ChangeEvent, TextareaHTMLAttributes } from "react";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

const defaultTextAreaClass = "h-20 w-full resize-none rounded-xl border border-white/10 bg-dark-300/88 p-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-gray-500 focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20";
const getTextAreaClassName = (className: string | undefined): string => (
	className && className.length > 0 ? className : defaultTextAreaClass
);

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
	({ value, onChange, placeholder, readOnly, className, ...props }, ref) => (
		<textarea
			ref={ref}
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			readOnly={readOnly}
			className={getTextAreaClassName(className)}
			{...props}
		/>
	)
);

TextArea.displayName = 'TextArea';

export default TextArea;