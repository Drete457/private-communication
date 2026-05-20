import { registerSW } from 'virtual:pwa-register';

const UPDATE_RELOAD_MARKER = 'pc-pwa-update-reload';
const UPDATE_RELOAD_TIMEOUT_MS = 4000;

let registerCalled = false;

const activateWaitingWorkerOnLaunch = async (): Promise<boolean> => {
	if (!('serviceWorker' in navigator)) {
		return false;
	}

	const registration = await navigator.serviceWorker.getRegistration();
	const waitingWorker = registration?.waiting;
	if (!waitingWorker) {
		sessionStorage.removeItem(UPDATE_RELOAD_MARKER);
		return false;
	}

	if (sessionStorage.getItem(UPDATE_RELOAD_MARKER) === '1') {
		sessionStorage.removeItem(UPDATE_RELOAD_MARKER);
		return false;
	}

	sessionStorage.setItem(UPDATE_RELOAD_MARKER, '1');

	return new Promise((resolve) => {
		const handleControllerChange = () => {
			window.clearTimeout(timeoutId);
			sessionStorage.removeItem(UPDATE_RELOAD_MARKER);
			window.location.reload();
			resolve(true);
		};

		const timeoutId = window.setTimeout(() => {
			navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
			sessionStorage.removeItem(UPDATE_RELOAD_MARKER);
			resolve(false);
		}, UPDATE_RELOAD_TIMEOUT_MS);

		navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, { once: true });
		waitingWorker.postMessage({ type: 'SKIP_WAITING' });
	});
};

const registerPwaUpdateService = async (): Promise<boolean> => {
	const appliedWaitingUpdate = await activateWaitingWorkerOnLaunch();
	if (appliedWaitingUpdate || registerCalled) 
		return appliedWaitingUpdate;

	registerCalled = true;
	registerSW({
		immediate: true
	});

	return false;
};

export { registerPwaUpdateService };