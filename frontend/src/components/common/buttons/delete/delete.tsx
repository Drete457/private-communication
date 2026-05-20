import { TrashBin } from '@/assets';

import type { FC } from 'react';


interface DeleteButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}

const getDeleteButtonLabel = (ariaLabel: string | undefined): string => (
	ariaLabel && ariaLabel.length > 0 ? ariaLabel : 'Delete'
);

const DeleteButton: FC<DeleteButtonProps> = ({ onClick, ariaLabel, disabled }) => {
	const accessibleLabel = getDeleteButtonLabel(ariaLabel);

	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-[transform,background-color,border-color,box-shadow] ${disabled
				? 'cursor-not-allowed border-white/6 bg-white/6 text-white/35'
				: 'border-red-400/18 bg-red-500/12 text-red-100 shadow-[0_10px_24px_rgba(127,29,29,0.18)] hover:-translate-y-px hover:border-red-300/28 hover:bg-red-500/18 hover:shadow-[0_14px_28px_rgba(127,29,29,0.24)]'
			}`}
			aria-label={accessibleLabel}
			title={accessibleLabel}
		>
			<TrashBin className="h-[1.05rem] w-[1.05rem]" />
		</button>
	);
};

export default DeleteButton;