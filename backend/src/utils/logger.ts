/**
 * Simple logger utility
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const configuredLogLevel = process.env['LOG_LEVEL'];
const LOG_LEVEL: LogLevel = configuredLogLevel === 'debug' || configuredLogLevel === 'info' || configuredLogLevel === 'warn' || configuredLogLevel === 'error'
  ? configuredLogLevel
  : 'info';

const getLogLevelPriority = (level: LogLevel): number => {
  switch (level) {
    case 'debug':
      return 0;
    case 'info':
      return 1;
    case 'warn':
      return 2;
    case 'error':
      return 3;
  }
};

const shouldLog = (level: LogLevel): boolean => {
  return getLogLevelPriority(level) >= getLogLevelPriority(LOG_LEVEL);
}

const formatMessage = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) 
      console.log(formatMessage('debug', message, meta));
  },

  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) 
      console.log(formatMessage('info', message, meta));
  },

  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) 
      console.warn(formatMessage('warn', message, meta));
  },

  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) 
      console.error(formatMessage('error', message, meta));
  }
};
