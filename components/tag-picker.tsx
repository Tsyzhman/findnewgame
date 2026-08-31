'use client';
import { useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import type { QuizGroup, SteamTag } from '@/lib/types';
import { belongsToGroup } from '@/lib/tag-groups';

const featured = [
  'Action Roguelike',
  'Adventure',
  'Automation',
  'City Builder',
  'Co-op',
  'Colony Sim',
  'Crafting',
  'Deckbuilding',
  'Exploration',
  'Fantasy',
  'FPS',
  'Horror',
  'Immersive Sim',
  'Management',
  'Metroidvania',
  'Puzzle',
  'Relaxing',
  'Resource Management',
  'Roguelike Deckbuilder',
  'RPG',
  'Sci-fi',
  'Simulation',
  'Strategy',
  'Survival',
  'Atmospheric',
  'Fishing',
  'Building',
  'Inventory Management',
];
export function TagPicker({
  tags,
  value,
  onChange,
  max = 15,
  group,
  label = 'Steam tags',
  compact = false,
  exclude = [],
  disabled = false,
}: {
  tags: SteamTag[];
  value: number[];
  onChange: (value: number[]) => void;
  max?: number;
  group?: QuizGroup;
  label?: string;
  compact?: boolean;
  exclude?: number[];
  disabled?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [expanded, setExpanded] = useState(false);
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tags
      .filter(
        (tag) =>
          (!group || belongsToGroup(tag, group)) &&
          !exclude.includes(tag.id) &&
          (query ? tag.steam_name.toLowerCase().includes(query) : true),
      )
      .sort(
        (a, b) =>
          (featured.includes(b.steam_name) ? 1 : 0) -
            (featured.includes(a.steam_name) ? 1 : 0) ||
          a.steam_name.localeCompare(b.steam_name),
      )
      .slice(0, query ? 60 : expanded ? 80 : compact ? 12 : 24);
  }, [tags, group, search, expanded, compact, exclude]);
  const toggle = (id: number) => {
    if (disabled) return;
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (value.length < max) onChange([...value, id]);
  };
  return (
    <div className={`tag-picker ${compact ? 'compact' : ''}`}>
      <div className="picker-heading">
        <span>{label}</span>
        <span>
          {value.length} / {max} selected
        </span>
      </div>
      {value.length > 0 && (
        <div
          className="selected-tags"
          aria-label={`Selected ${label.toLowerCase()}`}
        >
          {value.map((id) => (
            <Button
              key={id}
              variant="ghost"
              disabled={disabled}
              className="selected-chip"
              onClick={() => toggle(id)}
              aria-label={`Remove ${byId.get(id)?.steam_name ?? 'tag'}`}
            >
              {byId.get(id)?.steam_name ?? `Tag ${id}`}
              <X size={12} />
            </Button>
          ))}
        </div>
      )}
      <Command
        shouldFilter={false}
        className="picker-command"
        label={`Choose ${label.toLowerCase()}`}
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={`Search ${group === 'core' ? 'gameplay' : (group ?? 'Steam')} tags…`}
          aria-label={`Search ${label.toLowerCase()}`}
          disabled={disabled}
        />
        <CommandList className="picker-list" aria-label={label}>
          <CommandEmpty>
            No matching Steam tags. Try a shorter search.
          </CommandEmpty>
          <div className="picker-options">
            {visible.map((tag) => (
              <CommandItem
                key={tag.id}
                value={tag.steam_name}
                disabled={
                  disabled || (!value.includes(tag.id) && value.length >= max)
                }
                onSelect={() => toggle(tag.id)}
                className="tag-option"
                data-checked={value.includes(tag.id)}
                aria-label={`${tag.steam_name}${value.includes(tag.id) ? ', selected' : ''}`}
              >
                <span>{tag.steam_name}</span>
                {value.includes(tag.id) ? (
                  <Check size={13} />
                ) : (
                  <Plus size={13} />
                )}
              </CommandItem>
            ))}
          </div>
        </CommandList>
      </Command>
      {!search && (
        <Button
          variant="ghost"
          className="picker-more"
          onClick={() => setExpanded(!expanded)}
          disabled={disabled}
        >
          {expanded ? 'Show fewer suggestions' : 'Browse more tags'}
        </Button>
      )}
      <span className="sr-only" aria-live="polite">
        {value.length} of {max} selected
      </span>
    </div>
  );
}
export function TagChips({ ids, tags }: { ids: number[]; tags: SteamTag[] }) {
  const map = new Map(tags.map((t) => [t.id, t.steam_name]));
  return (
    <div className="tag-chips">
      {ids.map((id) => (
        <span key={id}>{map.get(id) ?? `Tag ${id}`}</span>
      ))}
    </div>
  );
}
