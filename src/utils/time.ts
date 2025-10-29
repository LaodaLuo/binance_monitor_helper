import dayjs from 'dayjs';
import type { ConfigType } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DISPLAY_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

export function formatDisplayTime(value: ConfigType, format = DEFAULT_FORMAT): string {
  return dayjs(value).tz(DISPLAY_TIMEZONE).format(format);
}

export { DISPLAY_TIMEZONE, DEFAULT_FORMAT };
