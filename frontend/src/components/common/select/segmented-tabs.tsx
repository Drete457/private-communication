import { useRef } from 'react';

type SegmentedTabOption<TValue extends string> = {
	value: TValue;
	label: string;
};

interface SegmentedTabsProps<TValue extends string> {
	value: TValue;
	onChange: (value: TValue) => void;
	options: ReadonlyArray<SegmentedTabOption<TValue>>;
	className?: string;
	ariaLabel?: string;
}

const SegmentedTabs = <TValue extends string>({ value, onChange, options, className, ariaLabel = 'Options' }: SegmentedTabsProps<TValue>) => {
	const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const focusOptionAt = (index: number) => {
		buttonRefs.current[index]?.focus();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
		if (!options.length)
			return;

		const moveFocus = (nextIndex: number) => {
			const nextOption = options[nextIndex];
			if (!nextOption)
				return;

			event.preventDefault();
			onChange(nextOption.value);
			focusOptionAt(nextIndex);
		};

		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				moveFocus((currentIndex + 1) % options.length);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				moveFocus((currentIndex - 1 + options.length) % options.length);
				break;
			case 'Home':
				moveFocus(0);
				break;
			case 'End':
				moveFocus(options.length - 1);
				break;
			default:
				break;
		}
	};

	return (
		<div role="radiogroup" aria-label={ariaLabel} className={`rounded-lg border border-white/10 bg-dark-100 p-1 ${className ?? ''}`.trim()}>
			{options.map((option, index) => {
				const isSelected = value === option.value;

				return (
					<button
						key={option.value}
						ref={(element) => {
							buttonRefs.current[index] = element;
						}}
						type="button"
						role="radio"
						aria-checked={isSelected}
						tabIndex={isSelected ? 0 : -1}
						onClick={() => onChange(option.value)}
						onKeyDown={(event) => handleKeyDown(event, index)}
						className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${isSelected ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-white/5'}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
};

export default SegmentedTabs;
export type { SegmentedTabOption, SegmentedTabsProps };