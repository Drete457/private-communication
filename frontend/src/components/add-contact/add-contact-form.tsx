import { useEffect, useRef, useState } from 'react';


import { GenericButton, RoundGenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { SmallRedButton } from '@/components/common/buttons/red';
import { GenericLoader } from '@/components/common/loaders';
import { ErrorMessage } from '@/components/common/messages/error';
import { StatusMessage } from '@/components/common/messages/status';
import { TextArea } from '@/components/common/text/text-area';
import { importPublicKey, generateFingerprint, hashPublicKey } from '@/crypto/crypto-service';
import { markPeerKeyVerified, storePeerKey } from '@/crypto/key-manager';
import { useVideoInputDevices } from '@/helpers/media';
import { RenderIf } from '@/helpers/render-conditional/render-conditional';
import { clientLogger } from '@/services/logger';
import { usePeersStore } from '@/store/peers-store';

import { Select } from '@components/common/select';
import { Input } from '@components/common/text/input';

import type { Dispatch, FC, SetStateAction} from 'react';

interface AddContactFormProps {
  setActionMenu: Dispatch<SetStateAction<boolean>>;
}

type ContactPayload = {
	userId?: string | undefined;
	encryptionPublicKey: string;
	signingPublicKey: string;
	fingerprint?: string | undefined;
};

type ContactPayloadRecord = Record<string, unknown> & Partial<Record<'encryptionPublicKey' | 'signingPublicKey' | 'userId' | 'fingerprint', unknown>>;

const isRecord = (value: unknown): value is ContactPayloadRecord => (
	typeof value === 'object' && value !== null && !Array.isArray(value)
);

const getNonEmptyStringOrUndefined = (value: string | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const parseContactPayload = (value: unknown): ContactPayload | null => {
	if (!isRecord(value) || typeof value.encryptionPublicKey !== 'string' || typeof value.signingPublicKey !== 'string')
		return null;

	return {
		encryptionPublicKey: value.encryptionPublicKey,
		signingPublicKey: value.signingPublicKey,
		userId: typeof value.userId === 'string' ? value.userId : undefined,
		fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : undefined
	};
};

const hasCameraDevices = (count: number): boolean => count > 0;
const hasMultipleCameraDevices = (count: number): boolean => count > 1;

const AddContactForm: FC<AddContactFormProps> = ({ setActionMenu }) => {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [isScanning, setIsScanning] = useState<boolean>(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [peerKeyInput, setPeerKeyInput] = useState<string>('');
	const [peerDisplayName, setPeerDisplayName] = useState<string>('');
	const [addStatus, setAddStatus] = useState<string | null>(null);
	const [addError, setAddError] = useState<string | null>(null);
	const [isAdding, setIsAdding] = useState<boolean>(false);
	const {
		cameras,
		selectedCameraId,
		setSelectedCameraId,
		isLoading: discoveringCameras
	} = useVideoInputDevices();
	const cameraCount = cameras.length;

	const addContact = async () => {
		setAddError(null);
		setAddStatus(null);
		setIsAdding(true);

		try {
			const trimmedKey = peerKeyInput.trim();
			if (!trimmedKey) 
				throw new Error('Peer public key is required');

			let encryptionPublicKey: string | null = null;
			let signingKey: string | null = null;
			let peerId: string | null = null;
			let peerFingerprint: string | null = null;

			try {
				const parsed = parseContactPayload(JSON.parse(trimmedKey));

				if (parsed) {
					encryptionPublicKey = parsed.encryptionPublicKey;
					signingKey = parsed.signingPublicKey;
					peerId = getNonEmptyStringOrUndefined(parsed.userId) ?? null;
					peerFingerprint = getNonEmptyStringOrUndefined(parsed.fingerprint) ?? null;
				}
			} catch (err) {
				setAddError(err instanceof Error ? err.message : 'Invalid contact payload JSON');
			}

			if (!encryptionPublicKey || !signingKey) {
				throw new Error('Please paste the full contact payload (JSON) that includes both public keys');
			}

			let imported: CryptoKey;

			try {
				imported = await importPublicKey(encryptionPublicKey, 'ECDH');
			} catch (err) {
				clientLogger.error('Public key import failed:', err);
				throw new Error('Invalid public key. Ensure you pasted the full contact payload');
			}

			const derivedPeerId = await hashPublicKey(imported);
			const derivedFingerprint = await generateFingerprint(imported);

			const finalPeerId = getNonEmptyStringOrFallback(peerId ?? undefined, derivedPeerId);
			await storePeerKey(
				finalPeerId,
				encryptionPublicKey,
				signingKey,
				getNonEmptyStringOrFallback(peerFingerprint ?? undefined, derivedFingerprint),
				getNonEmptyStringOrUndefined(peerDisplayName.trim())
			);

			await markPeerKeyVerified(finalPeerId);
			void usePeersStore.getState().loadPeers();
			setAddStatus('Contact added');
			setPeerKeyInput('');
			setPeerDisplayName('');
		} catch (err) {
			setAddError(err instanceof Error ? err.message : 'Failed to add contact');
		} finally {
			setIsAdding(false);
		}
	};

	useEffect(() => {
		if (!isScanning || !videoRef.current) 
			return;

		let cancelled = false;
		let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
		setScanError(null);

		const startScanner = async () => {
			try {
				const { default: QrScanner } = await import('qr-scanner');
				if (cancelled || !videoRef.current) 
					return;

				scanner = new QrScanner(
					videoRef.current,
					(result: { data?: string }) => {
						const resultData = getNonEmptyStringOrUndefined(result.data);
						if (resultData) {
							setPeerKeyInput(resultData.trim());
							setAddStatus('QR scanned');
							setIsScanning(false);
						}
					},
					{
						returnDetailedScanResult: true,
						highlightScanRegion: true,
						preferredCamera: getNonEmptyStringOrFallback(selectedCameraId, 'environment')
					}
				);

				await scanner.start();
			} catch {
				if (cancelled) 
					return;

				setScanError('Camera access failed');
				setIsScanning(false);
			}
		};

		void startScanner();

		return () => {
			cancelled = true;
			scanner?.stop();
			scanner?.destroy();
		};
	}, [isScanning, selectedCameraId]);

	return (
		<section className="space-y-5 rounded-[1.75rem] border border-white/10 bg-dark-200/95 p-4 text-left shadow-[0_16px_40px_rgba(0,0,0,0.32)] sm:p-6">
			<header className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<h2 className="text-xl font-semibold text-white">Add Contact</h2>
					<p className="text-sm text-white/65">Paste a trusted contact payload or scan a QR code, then save a recognizable name.</p>
				</div>
				<SmallGenericButton onClick={() => setActionMenu(false)} className="shrink-0">
          Close
				</SmallGenericButton>
			</header>

			<div className="space-y-4">
				<div className="app-panel-muted space-y-3 px-4 py-4">
					<div>
						<p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary-100">Contact Payload</p>
						<p className="mt-1 text-xs text-white/60">Use the full JSON payload shared by the other device.</p>
					</div>
					<RenderIf condition={isScanning}
						then={
							<div className="space-y-3">
								<RenderIf
									condition={hasMultipleCameraDevices(cameraCount)}
									then={
										<Select
											title="Select Camera"
											value={selectedCameraId}
											onChange={(e) => setSelectedCameraId(e.target.value)}
											list={cameras.map((cam) => ({ id: cam.id, label: getNonEmptyStringOrFallback(cam.label, 'Unnamed Camera') }))}
										/>
									}
									otherwise={null}
								/>
								<div className="relative aspect-video overflow-hidden rounded-[1.35rem] border border-primary-500/35 bg-black shadow-2xl">
									<video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
									<div className="absolute inset-0 pointer-events-none flex items-center justify-center">
										<div className="relative h-40 w-40 rounded border border-primary-500/30">
											<div className="absolute top-0 left-0 h-0.5 w-full animate-scan bg-primary-500 shadow-[0_0_10px_#3b82f6]" />
										</div>
									</div>
									<div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-linear-to-t from-black/80 to-transparent px-3 pb-3 pt-8">
										<p className="text-xs text-white/75">Center the QR code inside the frame.</p>
										<SmallRedButton onClick={() => setIsScanning(false)}>
                  Cancel
										</SmallRedButton>
									</div>
								</div>
							</div>
						}
						otherwise={
							<div className="space-y-3">
								<TextArea
									value={peerKeyInput}
									onChange={(e) => setPeerKeyInput(e.target.value)}
									placeholder="Paste the peer's contact payload here...."
								/>
								<p className="text-xs text-gray-400">Accepts contact payload JSON or scan QR.</p>
								<div className="app-panel flex flex-col gap-3 px-4 py-4 animate-fade-in">
									<div>
										<p className="text-sm font-semibold text-white">Need to scan instead?</p>
										<p className="mt-1 text-xs text-white/60">Use your camera when the other device is showing the contact QR.</p>
									</div>
									<RenderIf condition={!discoveringCameras && hasCameraDevices(cameraCount)}
										then={
											<>
												<RenderIf condition={hasMultipleCameraDevices(cameraCount)}
													then={
														<Select
															title="Select Camera"
															value={selectedCameraId}
															onChange={(e) => setSelectedCameraId(e.target.value)}
															list={cameras.map((cam) => ({ id: cam.id, label: getNonEmptyStringOrFallback(cam.label, 'Unnamed Camera') }))}
														/>
													}
													otherwise={null}
												/>
												<RoundGenericButton
													onClick={() => setIsScanning(true)}
													disabled={!hasCameraDevices(cameraCount)}
													className="self-center"
												>
                          📸 Scan QR Code
												</RoundGenericButton>
											</>
										}
										otherwise={
											<RenderIf
												condition={discoveringCameras}
												then={<GenericLoader />}
												otherwise={<p className="text-xs text-white/55">No camera detected on this device.</p>}
											/>
										}
									/>
								</div>
							</div>
						}
					/>
					<RenderIf condition={isScanning ? scanError !== null : false}
						then={scanError ? <ErrorMessage message={scanError} /> : null}
						otherwise={null}
					/>
				</div>

				<div className="app-panel-muted px-4 py-4">
					<label className="mb-2 block text-sm font-semibold text-white" htmlFor="contact-display-name">Display Name</label>
					<p className="mb-3 text-xs text-white/60">Optional, but useful so this contact is easy to recognize later.</p>
					<Input
						id="contact-display-name"
						value={peerDisplayName}
						onChange={(e) => setPeerDisplayName(e.target.value)}
						placeholder="Write the name you want to identify this contact with: ex: Alice"
					/>
				</div>

				<RenderIf condition={addError !== null}
					then={addError ? <ErrorMessage message={addError} /> : null}
					otherwise={null}
				/>
				<RenderIf condition={addStatus !== null}
					then={addStatus ? <StatusMessage message={addStatus} /> : null}
					otherwise={null}
				/>

				<GenericButton onClick={() => void addContact()} disabled={isAdding || isScanning} className="w-full">
					<RenderIf condition={isAdding}
						then={<span className="flex items-center justify-center gap-2">
							<span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden="true" />
              Saving...
						</span>}
						otherwise="Save Contact"
					/>
				</GenericButton>
			</div>
		</section>
	);
};

export default AddContactForm;