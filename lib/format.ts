const englishCardinalRules = new Intl.PluralRules('en-US');

export function countNoun(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return englishCardinalRules.select(count) === 'one' ? singular : plural;
}

export function formatCount(
  count: number,
  singular: string,
  plural?: string,
): string {
  return `${count.toLocaleString('en-US')} ${countNoun(count, singular, plural)}`;
}
