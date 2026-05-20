import { useId, useState } from "react";

import { ArrowUp } from "@/assets";

import type { ChangeEvent, FC} from "react";

interface ListProps {
	id: string;
	label: string;
}

interface SelectProps {
	id?: string;
	title: string;
	value: string;
	onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
	list: ReadonlyArray<ListProps>;
	disabled?: boolean;
	descriptionId?: string;
}


const Select: FC<SelectProps> = ({ id, title, value, onChange, list, disabled = false, descriptionId }) => {
	const [openSelect, setOpenSelect] = useState<boolean>(false);
	const generatedId = useId().replaceAll(':', '-');
	const selectId = id ?? `select-${generatedId}`;
	const labelId = `${selectId}-label`;

	const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
		if (disabled) return;
		setOpenSelect(false);
		if (onChange) onChange(e);
	}

	return (
		<div className="w-full min-w-0">
			<label id={labelId} className="mb-2 block text-sm font-medium text-gray-300" htmlFor={selectId}>{title}</label>
			<div className="relative">
				<select
					id={selectId}
					aria-describedby={descriptionId}
					aria-labelledby={labelId}
					value={value}
					disabled={disabled}
					onChange={handleChange}
					onFocus={() => !disabled && setOpenSelect(true)}
					onClick={() => !disabled && setOpenSelect(true)}
					onBlur={() => setOpenSelect(false)}
					className={`w-full appearance-none rounded-xl border border-white/10 px-3 py-2.5 pr-10 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-[border-color,box-shadow,background-color] ${disabled ? 'cursor-not-allowed bg-dark-300/70 text-gray-400' : 'bg-dark-300/92 focus-visible:border-primary-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/20'}`}
					style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
				>
					{list.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
						</option>
					))}
				</select>
				<div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
					<ArrowUp direction={openSelect ? 'down' : 'up'} />
				</div>
			</div>
		</div>
	)
}

export default Select;