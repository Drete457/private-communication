type PeerRefreshHandler = () => Promise<void> | void;

let peerRefreshHandler: PeerRefreshHandler | null = null;

const setPeerRefreshHandler = (handler: PeerRefreshHandler): void => {
	peerRefreshHandler = handler;
};

const notifyPeerKeysChanged = async (): Promise<void> => {
	await peerRefreshHandler?.();
};

export {
	notifyPeerKeysChanged,
	setPeerRefreshHandler
};