import { useId } from 'react';

import { RenderIf } from "@/helpers/render-conditional";

import { SmallGenericButton } from "../buttons/generic";

import OverlayShell from "./overlay-shell";

import type { FC, ReactNode, Dispatch, SetStateAction } from "react";

interface ModalProps {
  active: boolean;
  setActive: Dispatch<SetStateAction<boolean>> | (() => void);
  title: string;
  message: string;
  AcceptButton: ReactNode;
}

const Modal: FC<ModalProps> = ({
	active,
	setActive,
	title,
	message,
	AcceptButton
}) => {
	const titleId = useId().replaceAll(':', '-');
	const descriptionId = useId().replaceAll(':', '-');

	return (
		<RenderIf condition={active}
			then={
				<OverlayShell
					active={active}
					onClose={() => setActive(false)}
					mode="dialog"
					labelledBy={titleId}
					describedBy={descriptionId}
					surfaceClassName="p-4 sm:p-6"
				>
					<h3 id={titleId} className="app-display-title mb-4 text-lg font-semibold text-white">{title}</h3>
					<p id={descriptionId} className="app-text-muted mb-6 text-sm">
						{message}
					</p>
					<div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
						<SmallGenericButton
							onClick={() => setActive(false)}
							className="w-full sm:w-auto"
						>
              Cancel
						</SmallGenericButton>
						{AcceptButton}
					</div>
				</OverlayShell>
			}
			otherwise={null}
		/>
	);
};

export default Modal;