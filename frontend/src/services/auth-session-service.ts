type AuthSessionSnapshot = {
	userId: string | null;
	publicKey: string | null;
	signingPublicKey: string | null;
	fingerprint: string | null;
};

const emptyAuthSession: AuthSessionSnapshot = {
	userId: null,
	publicKey: null,
	signingPublicKey: null,
	fingerprint: null
};

let authSessionSnapshot: AuthSessionSnapshot = emptyAuthSession;

const getAuthSession = (): AuthSessionSnapshot => authSessionSnapshot;

const setAuthSession = (snapshot: AuthSessionSnapshot): void => {
	authSessionSnapshot = snapshot;
};

const clearAuthSession = (): void => {
	authSessionSnapshot = emptyAuthSession;
};

export {
	clearAuthSession,
	getAuthSession,
	setAuthSession,
	type AuthSessionSnapshot
};