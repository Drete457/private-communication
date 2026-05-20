import { useState } from "react";


import { RenderIf } from "@/helpers/render-conditional";
import type { User } from "@/types";

import { DeleteButton } from "@components/common/buttons/delete";
import { SmallGenericButton } from "@components/common/buttons/generic";
import { RedButton } from "@components/common/buttons/red";
import { Modal, OverlayShell } from "@components/common/modal";
import { Input } from "@components/common/text/input";

import type { Dispatch, FC, SetStateAction} from "react";

interface ContactSettingsProps {
  setActionMenu: Dispatch<SetStateAction<boolean>>;
  peerSelected: User | null;
  handleSaveDisplayName: (editedName: string) => Promise<void>;
  handleDeletingContact: () => Promise<void>;
}

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const ContactSettings: FC<ContactSettingsProps> = ({ setActionMenu, peerSelected, handleSaveDisplayName, handleDeletingContact }) => {
	const [isEditingName, setIsEditingName] = useState<boolean>(false);
	const [originalName] = useState<string>(peerSelected ? getNonEmptyStringOrFallback(peerSelected.displayName, `User ${peerSelected.userId.slice(0, 8)}`) : 'Contact');
	const [editedName, setEditedName] = useState<string>(originalName);
	const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
	const [deleteCountdown, setDeleteCountdown] = useState<number>(5);
	const [countdownInterval, setCountdownInterval] = useState<NodeJS.Timeout | null>(null);
	const [isDeleting, setIsDeleting] = useState<boolean>(false);

	const handleSaveName = async () => {
		await handleSaveDisplayName(editedName);
		setIsEditingName(false);
	};

	const startDeleteCountdown = () => {
		const interval = setInterval(() => {
			setDeleteCountdown((prev) => {
				if (prev <= 1)
					clearInterval(interval);

				return prev - 1;
			});
		}, 1000);
		setCountdownInterval(interval);
	};

	const handleShowDeleteModal = () => {
		setShowDeleteModal(true);
		startDeleteCountdown();
	}

	const handleCancelDelete = () => {
		setShowDeleteModal(false);
		setDeleteCountdown(5);

		if (countdownInterval)
			clearInterval(countdownInterval);
	}

	const handleDeleteData = async () => {
		if (deleteCountdown === 0 && peerSelected) {
			setIsDeleting(true);
			await handleDeletingContact();
			setIsDeleting(false);
			setShowDeleteModal(false);
		}
	}

	return (
		<>
			<OverlayShell active onClose={() => setActionMenu(false)} mode="dialog" surfaceClassName="max-w-md space-y-6 p-4 sm:p-6">
				<div className="flex items-start justify-between">
					<div>
						<h3 className="app-display-title text-lg font-semibold text-white">Contact Settings</h3>
						<p className="app-text-muted text-sm">Manage this contact</p>
					</div>
					<SmallGenericButton onClick={() => setActionMenu(false)}>
            Close
					</SmallGenericButton>
				</div>

				<div className="space-y-2">
					<label className="app-text-muted block text-xs" htmlFor="contact-settings-display-name">Display name</label>
					<RenderIf condition={isEditingName}
						then={
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<Input
									id="contact-settings-display-name"
									value={editedName}
									onChange={(e) => setEditedName(e.target.value)}
									placeholder={originalName}
								/>
								<SmallGenericButton
									onClick={() => void handleSaveName()}
									className="w-full sm:w-auto"
								>
                  Save
								</SmallGenericButton>
								<SmallGenericButton
									onClick={() => setIsEditingName(false)}
									className="w-full sm:w-auto"
								>
                  Cancel
								</SmallGenericButton>
							</div>
						}
						otherwise={
							<div className="app-panel-muted flex items-center justify-between px-3 py-2">
								<span className="text-sm text-white truncate">{editedName}</span>
								<button
									onClick={() => setIsEditingName(true)}
									className="app-text-muted text-xs hover:text-gray-300"
									title="Edit contact name"
								>
                  Edit
								</button>
							</div>
						}
					/>
				</div>

				<div className="flex flex-col gap-3 border-t border-dark-300/80 pt-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm text-white">Remove contact</p>
						<p className="text-xs text-gray-500">Deletes local chat history</p>
					</div>
					<RenderIf condition={peerSelected?.userId !== undefined}
						then={peerSelected ?
							<DeleteButton
								onClick={handleShowDeleteModal}
								disabled={isDeleting}
								aria-label={`Remove ${getNonEmptyStringOrFallback(peerSelected.displayName, peerSelected.userId)}`}
							/>
							: null}
						otherwise={null}
					/>
				</div>
			</OverlayShell>

			<RenderIf condition={showDeleteModal}
				then={<Modal
					active={showDeleteModal}
					setActive={handleCancelDelete}
					title="Are you sure?"
					message="This action is irreversible. All chat history with this contact will be deleted from this device."
					AcceptButton={
						<RedButton
							onClick={() => void handleDeleteData()}
							disabled={deleteCountdown > 0 || isDeleting}
						>
							{deleteCountdown > 0 ? `Delete (${deleteCountdown})` : 'Delete'}
						</RedButton>
					}
				/>}
				otherwise={null}
			/>
		</>
	)
}

export default ContactSettings;