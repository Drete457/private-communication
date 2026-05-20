const isIosDevice = () => {
	const ua = navigator.userAgent.toLowerCase();

	return /iphone|ipad|ipod/.test(ua) ||
		(ua.includes('macintosh') && navigator.maxTouchPoints > 1);
};

type NavigatorWithUserAgentData = Navigator & {
	userAgentData?: {
		mobile?: boolean;
	};
};

const isMobileDevice = () => {
	const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;
	if (userAgentData?.mobile === true) return true;

	const ua = navigator.userAgent;
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
};

export { isIosDevice, isMobileDevice };