type RuntimeRecord = Record<string, unknown>;

type RuntimeParser<T> = (value: unknown) => T | null;

const isRecord = (value: unknown): value is RuntimeRecord => (
	typeof value === 'object'
	&& value !== null
	&& !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === 'string';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const isFiniteNumber = (value: unknown): value is number => (
	typeof value === 'number'
	&& Number.isFinite(value)
);

const isSafeInteger = (value: unknown): value is number => (
	typeof value === 'number'
	&& Number.isSafeInteger(value)
);

const isPositiveSafeInteger = (value: unknown): value is number => (
	isSafeInteger(value)
	&& value > 0
);

const isNonNegativeSafeInteger = (value: unknown): value is number => (
	isSafeInteger(value)
	&& value >= 0
);

const isStringArray = (value: unknown): value is string[] => (
	Array.isArray(value)
	&& value.every(isString)
);

const readJsonResponse = async (response: Response): Promise<unknown> => {
	try {
		const payload: unknown = await response.json();
		return payload;
	} catch {
		return undefined;
	}
};

const parseJsonResponse = async <T>(
	response: Response,
	parser: RuntimeParser<T>,
	label: string
): Promise<T> => {
	const payload: unknown = await response.json();
	const parsed = parser(payload);
	if (parsed === null)
		throw new Error(`Invalid ${label} response`);

	return parsed;
};

export {
	isBoolean,
	isFiniteNumber,
	isNonNegativeSafeInteger,
	isPositiveSafeInteger,
	isRecord,
	isString,
	isStringArray,
	parseJsonResponse,
	readJsonResponse
};
export type { RuntimeParser, RuntimeRecord };
