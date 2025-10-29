import dayjs from 'dayjs';
import type { ConfigType } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DISPLAY_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

export function formatDisplayTime(value: ConfigType, format = DEFAULT_FORMAT, withTimezone = false): string {
  const formatted = dayjs(value).tz(DISPLAY_TIMEZONE).format(format);
  return withTimezone ? `${formatted} (UTC+8)` : formatted;
}

export { DISPLAY_TIMEZONE, DEFAULT_FORMAT };
