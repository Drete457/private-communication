import { useEffect, useState } from 'react';

import { GenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { GenericLoader } from '@/components/common/loaders';
import { StatusMessage } from '@/components/common/messages/status';
import { RenderIf } from '@/helpers/render-conditional/render-conditional';

import type { Dispatch, FC, SetStateAction} from 'react';

interface ShareFormProps {
  setActionMenu: Dispatch<SetStateAction<boolean>>;
}

const ShareForm: FC<ShareFormProps> = ({ setActionMenu }) => {
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [copyStatus, setCopyStatus] = useState<string | null>(null);

	useEffect(() => {
		let active = true;

		const buildQr = async () => {
			const { default: QRCode } = await import('qrcode');
			const domainUrl = window.location.origin;
			const dataUrl = await QRCode.toDataURL(domainUrl, {
				errorCorrectionLevel: 'M',
				scale: 4,
				margin: 1
			});

			if (active) {
				setQrDataUrl(dataUrl);
			}
		};

		void buildQr();

		return () => {
			active = false;
		};
	}, []);

	const handleCopyLink = async () => {
		await navigator.clipboard.writeText(window.location.origin);
		setCopyStatus('Link copied');
	};

	return (
		<section className="space-y-6 rounded-2xl border border-white/10 bg-dark-200/95 p-4 text-left shadow-[0_12px_40px_rgba(0,0,0,0.35)] sm:p-6">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<h2 className="text-xl font-semibold text-white">Share Website</h2>
					<p className="text-sm text-white/60">Scan the QR code to open this site on another device.</p>
				</div>
				<SmallGenericButton onClick={() => setActionMenu(false)}>
          Close
				</SmallGenericButton>
			</header>

			<div className="flex items-center justify-center">
				<div className="relative flex aspect-square w-full max-w-56 items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3">
					<RenderIf
						condition={qrDataUrl !== null}
						then={
							<img
								src={qrDataUrl ?? ''}
								alt="QR Code for sharing domain url"
								className="w-full h-full rounded-xl bg-white p-2"
							/>
						}
						otherwise={<GenericLoader />}
					/>
				</div>
			</div>

			<div className="app-panel-muted space-y-3 px-4 py-4">
				<div>
					<p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary-100">Current link</p>
					<p className="mt-2 break-all text-sm text-white/75">{window.location.origin}</p>
				</div>
				<GenericButton onClick={() => void handleCopyLink()} className="w-full">
					Copy link
				</GenericButton>
				<RenderIf condition={copyStatus !== null} then={copyStatus ? <StatusMessage message={copyStatus} /> : null} otherwise={null} />
			</div>
		</section>
	);
};

export default ShareForm;