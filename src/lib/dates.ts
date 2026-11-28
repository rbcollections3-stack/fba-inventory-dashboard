/**
 * The business's time zone, used for "today" on counts. Amazon's US reports
 * use Pacific time. Set BUSINESS_TIME_ZONE (for example America/New_York) to change it.
 */
export function businessTimeZone(): string {
  return process.env.BUSINESS_TIME_ZONE || "America/Los_Angeles";
}

/** Today's date (YYYY-MM-DD) in the business's time zone. */
export function businessToday(now = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: businessTimeZone() });
}
