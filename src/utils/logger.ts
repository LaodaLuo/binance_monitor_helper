import pino from 'pino';
import { appConfig } from '../config/index.js';

export const logger = pino({
  level: appConfig.logLevel,
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime
});
