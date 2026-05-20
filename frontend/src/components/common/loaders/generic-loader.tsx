import Loading from "./loading";

const GenericLoader = () => (
	<div className="flex flex-col items-center gap-4">
		<Loading />
		<p className="text-gray-400">Loading...</p>
	</div>
)

export default GenericLoader;