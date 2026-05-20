import { Suspense, lazy, useState } from "react";

import { logoCompressed } from '@/assets';
import { SmallGenericButton } from '@/components/common/buttons/generic';
import { GenericLoader } from '@/components/common/loaders';
import { OverlayShell } from '@/components/common/modal';
import { getOffsetOverlayClassNames } from '@/helpers/modal';
import { RenderIf } from "@/helpers/render-conditional/render-conditional";

import type { FC} from "react";

const ShareForm = lazy(() => import('./share-form'));

interface ShareWebSiteButtonProps {
	offsetFromMobileHeader?: boolean;
}

const ShareWebSiteButton: FC<ShareWebSiteButtonProps> = ({ offsetFromMobileHeader = false }) => {
	const [isShareFormOpen, setIsShareFormOpen] = useState<boolean>(false);
	const { backdropClassName, surfaceClassName } = getOffsetOverlayClassNames(offsetFromMobileHeader, 'max-w-md');

	return (
		<section>
			<SmallGenericButton
				onClick={() => setIsShareFormOpen(value => !value)}
				className='flex h-11 w-11 items-center justify-center overflow-hidden px-0'
			>
				<img src={logoCompressed} alt="App Logo" className="rounded-full" />
			</SmallGenericButton>

			<RenderIf condition={isShareFormOpen}
				then={
					<OverlayShell active={isShareFormOpen} onClose={() => setIsShareFormOpen(false)} mode="dialog" backdropClassName={backdropClassName} surfaceClassName={surfaceClassName}>
						<Suspense fallback={<div className="flex min-h-64 items-center justify-center"><GenericLoader /></div>}>
							<ShareForm setActionMenu={setIsShareFormOpen} />
						</Suspense>
					</OverlayShell>
				}
				otherwise={null}
			/>
		</section>
	)
}

export default ShareWebSiteButton;