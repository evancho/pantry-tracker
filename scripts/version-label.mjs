/** Calendar date in Asia/Taipei as YYYYMMDD, used as the build datecode. */
export function taipeiDatecode(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}${value('month')}${value('day')}`;
}

/** Display label: semver from package.json plus the build datecode. */
export function formatVersionLabel(version, datecode) {
  return `${version}-${datecode}`;
}
