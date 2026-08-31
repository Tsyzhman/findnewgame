import additions from '../data/additional_tag_categories.json' with { type: 'json' };

// Steam owns the canonical IDs/names. These are FindNewGame's curated roles for
// quiz selection and weighting, following the Steamworks tag-wizard categories.
// Only the generic fallback is refined, preserving existing presentation roles.
const classified = new Map();
for (const [category, names] of Object.entries(additions)) {
  for (const name of names) {
    if (classified.has(name))
      throw new Error(`Duplicate category entry: ${name}`);
    classified.set(name, category);
  }
}

export function refineTagCategories(tags) {
  let changed = 0;
  for (const tag of tags) {
    const category = classified.get(tag.steam_name.trim());
    if (tag.category !== 'metadata' || !category) continue;
    Object.assign(tag, {
      category,
      subcategory: category,
      importance_class: category === 'subgenre' ? 'specific' : category,
      is_onboarding_primary: category === 'genre' || category === 'subgenre',
      is_quiz_primary: ['genre', 'subgenre', 'mechanic', 'mood'].includes(
        category,
      ),
      updated_at: new Date().toISOString(),
    });
    changed++;
  }
  return changed;
}
