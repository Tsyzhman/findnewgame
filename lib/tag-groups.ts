import type { QuizGroup, SteamTag } from './types.ts';
const crossMechanics = new Set([
  'Exploration',
  'Puzzle',
  'Survival',
  'Strategy',
  'Building',
  'Automation',
  'Deckbuilding',
  'Investigation',
  'Logic',
]);
export function belongsToGroup(tag: SteamTag, group: QuizGroup): boolean {
  if (group === 'genre') return ['genre', 'subgenre'].includes(tag.category);
  if (group === 'core')
    return tag.category === 'mechanic' || crossMechanics.has(tag.steam_name);
  return tag.category === 'mood';
}
