
import { RenderIf } from "@/helpers/render-conditional";

import { GenericButton, SmallGenericButton } from "../buttons/generic";
import { Select } from "../select";

import OverlayShell from "./overlay-shell";

import type { FC } from "react";

interface ForwardModalProps {
	peers: Array<{ userId: string; displayName?: string | undefined }>;
	selectedPeerId: string | null;
	forwardTargetId: string;
	setForwardTargetId: (id: string) => void;
	setForwardOpen: (open: boolean) => void;
	handleForward: () => void;
	isForwarding: boolean;
	forwardStatusMessage: string;
	forwardProgress: number;
	forwardError: string;
}

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const ForwardModal: FC<ForwardModalProps> = ({
	peers,
	selectedPeerId,
	forwardTargetId,
	setForwardTargetId,
	setForwardOpen,
	handleForward,
	isForwarding,
	forwardStatusMessage,
	forwardProgress,
	forwardError
}) => (
	<OverlayShell active onClose={() => setForwardOpen(false)} mode="sheet" surfaceClassName="w-full max-w-lg p-4 sm:p-6">
		<header className="mb-4 space-y-1">
			<h3 className="text-xl font-semibold text-white">Forward Message</h3>
			<p className="text-sm text-white/60">Pick a trusted contact and confirm the forward action.</p>
		</header>

		<RenderIf
			condition={peers.filter(peer => peer.userId !== selectedPeerId).length > 0}
			then={
				<>
					<div className="app-panel-muted space-y-3 px-4 py-4">
						<div>
							<p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary-100">Destination</p>
							<p className="mt-1 text-xs text-white/60">Only contacts other than the current conversation are shown here.</p>
						</div>
						<Select
							title="Destination User"
							value={forwardTargetId}
							onChange={(e) => setForwardTargetId(e.target.value)}
							disabled={isForwarding}
							list={peers
								.filter(peer => peer.userId !== selectedPeerId)
								.map(peer => ({
									id: peer.userId,
									label: getNonEmptyStringOrFallback(peer.displayName, `User ${peer.userId.slice(0, 8)}`)
								}))}
						/>
					</div>
					<RenderIf
						condition={forwardStatusMessage.length > 0}
						then={
							<div className="mt-4 app-panel space-y-3 px-4 py-4">
								<p className="text-sm text-white">{forwardStatusMessage}</p>
								<RenderIf
									condition={isForwarding}
									then={
										<div>
											<div className="h-2 w-full overflow-hidden rounded-full bg-dark-300">
												<div
													className="h-full rounded-full bg-primary-500 transition-[width] duration-200"
													style={{ width: `${Math.max(8, Math.round(forwardProgress * 100))}%` }}
												/>
											</div>
										</div>
									}
									otherwise={null}
								/>
								<RenderIf
									condition={forwardError.length > 0}
									then={<p className="text-sm text-red-400">{forwardError}</p>}
									otherwise={null}
								/>
							</div>
						}
						otherwise={null}
					/>
				</>
			}
			otherwise={<div className="app-panel-muted px-4 py-4"><p className="text-sm text-gray-300">No other users available.</p></div>}
		/>
		<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<SmallGenericButton onClick={() => setForwardOpen(false)} disabled={isForwarding} className="w-full sm:w-auto">
					Cancel
			</SmallGenericButton>
			<GenericButton
				onClick={handleForward}
				disabled={!forwardTargetId || isForwarding}
				className="w-full sm:w-auto"
			>
				{isForwarding ? 'Forwarding...' : 'Forward'}
			</GenericButton>
		</div>
	</OverlayShell>
);

export default ForwardModal;