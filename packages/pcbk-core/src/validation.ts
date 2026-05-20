type CborRecord = Record<string, unknown>;

const isCborRecord = (value: unknown): value is CborRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return false;

	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isNonNegativeSafeInteger = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
};

const isPositiveSafeInteger = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
};

export {
	isCborRecord,
	isNonNegativeSafeInteger,
	isPositiveSafeInteger
};

export type { CborRecord };