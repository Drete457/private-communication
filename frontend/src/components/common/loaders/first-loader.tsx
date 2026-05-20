import Loading from "./loading";

import type { FC } from "react";


const FirstLoader: FC = () => (
	<div className="flex min-h-dvh w-full flex-col items-center justify-center bg-dark-100 px-4 text-center">
		<Loading />
		<p className="mt-4 text-gray-400">Loading...</p>
	</div>
);

export default FirstLoader;