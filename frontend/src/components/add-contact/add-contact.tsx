import { Suspense, lazy, useState } from "react";

import { UserPlus } from '@/assets';
import { GenericButton, SmallGenericButton } from '@/components/common/buttons/generic';
import { GenericLoader } from '@/components/common/loaders';
import { OverlayShell } from '@/components/common/modal';
import { getOffsetOverlayClassNames } from '@/helpers/modal';
import { RenderIf } from "@/helpers/render-conditional/render-conditional";

import type { FC} from "react";

const AddContactForm = lazy(() => import('./add-contact-form'));

interface AddContactProps {
  smallButton?: boolean;
  offsetFromMobileHeader?: boolean;
}

const AddContact: FC<AddContactProps> = ({ smallButton = false, offsetFromMobileHeader = false }) => {
	const [isAddContactOpen, setIsAddContactOpen] = useState<boolean>(false);
	const { backdropClassName, surfaceClassName } = getOffsetOverlayClassNames(offsetFromMobileHeader, 'max-w-xl');

	return (
		<section>
			<RenderIf condition={smallButton}
				then={
					<SmallGenericButton
						onClick={() => setIsAddContactOpen(value => !value)}
						className='h-11 w-11 cursor-pointer justify-center px-0'
					>
						<UserPlus className="h-5 w-5" />
					</SmallGenericButton>
				}
				otherwise={
					<GenericButton
						onClick={() => setIsAddContactOpen(value => !value)}
						className='p-3 bg-primary-700 enabled:hover:bg-primary-600 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
					>
            Add Contact
					</GenericButton>
				}
			/>
			<RenderIf condition={isAddContactOpen}
				then={
					<OverlayShell active={isAddContactOpen} onClose={() => setIsAddContactOpen(false)} mode="sheet" backdropClassName={backdropClassName} surfaceClassName={surfaceClassName}>
						<Suspense fallback={<div className="flex min-h-64 items-center justify-center"><GenericLoader /></div>}>
							<AddContactForm setActionMenu={setIsAddContactOpen} />
						</Suspense>
					</OverlayShell>
				}
				otherwise={null}
			/>
		</section>
	)
}

export default AddContact;