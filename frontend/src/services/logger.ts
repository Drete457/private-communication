type LogMethod = 'debug' | 'error' | 'info' | 'warn';

const shouldLog = import.meta.env.DEV;

const writeLog = (method: LogMethod, message: string, ...context: ReadonlyArray<unknown>): void => {
	if (!shouldLog)
		return;

	console[method](message, ...context);
};

export const clientLogger = {
	debug: (message: string, ...context: ReadonlyArray<unknown>): void => {
		writeLog('debug', message, ...context);
	},
	error: (message: string, ...context: ReadonlyArray<unknown>): void => {
		writeLog('error', message, ...context);
	},
	info: (message: string, ...context: ReadonlyArray<unknown>): void => {
		writeLog('info', message, ...context);
	},
	warn: (message: string, ...context: ReadonlyArray<unknown>): void => {
		writeLog('warn', message, ...context);
	}
};