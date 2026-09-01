export type TagCategory =
  | 'subgenre'
  | 'genre'
  | 'mechanic'
  | 'mood'
  | 'visual'
  | 'player'
  | 'metadata';
export type QuizGroup = 'genre' | 'core' | 'mood';
export type DiscoveryMode = 'safe' | 'balanced' | 'curious';
export interface SteamTag {
  id: number;
  steam_name: string;
  slug: string;
  category: TagCategory;
  subcategory: string;
  importance_class: string;
  is_onboarding_primary: boolean;
  is_quiz_primary: boolean;
  is_active: boolean;
  localizations_json: Record<string, string>;
  updated_at: string;
}
export interface TasteProfile {
  genres: number[];
  mechanics: number[];
  moods: number[];
  hardNo: number[];
  discoveryMode: DiscoveryMode;
}
export interface TargetTags {
  genre: number[];
  core: number[];
  mood: number[];
}
export interface GameContent {
  title: string;
  developer: string;
  publisher: string;
  steamUrl: string;
  steamAppId: number;
  officialUrl?: string | null;
  releaseState: 'released' | 'coming_soon' | 'early_access';
  description: string;
  capsule: string;
  header?: string;
  screenshots: string[];
  youtubeId: string | null;
  tagIds: number[];
  targets: TargetTags;
}
export interface CandidateGame {
  id: string;
  developerId: string;
  publisherKey: string;
  familyKey: string;
  content: GameContent;
  versionId: string;
  status: string;
  qualifiedImpressions: number;
  isDemo: boolean;
  retest?: {
    experimentId: string;
    changedPresentation: boolean;
    previousExposureAt: number;
  };
}
export interface GuessSnapshot {
  genre: number[];
  core: number[];
  mood: number[];
  wouldClick: 'yes' | 'maybe' | 'no' | null;
}
export interface PublicUser {
  id: string;
  displayName: string;
  email: string | null;
  role: string;
  timezone: string;
  onboarded: boolean;
  isDemo: boolean;
  isLocal: boolean;
  taste: TasteProfile | null;
}
export interface DailySlot {
  id: string;
  slot: number;
  status: 'pending' | 'playing' | 'complete';
  stage: number;
  score: number | null;
  title: string | null;
  accuracy: number | null;
}
export type DailyRelevance = 'yes' | 'mixed' | 'no';
export interface DailyView {
  id: string;
  date: string;
  timezone: string;
  resetAt: number;
  slots: DailySlot[];
  totalScore: number;
  complete: boolean;
  shortage: boolean;
  isDemo: boolean;
  currentStreak: number;
  bestStreak: number;
  catalogMode: 'demo' | 'live';
  relevance: DailyRelevance | null;
}
export interface RoundView {
  id: string;
  stage: number;
  slot: number;
  status: string;
  availableStages: number[];
  maxScore: number;
  guesses: GuessSnapshot;
  capsule: string;
  screenshots: string[];
  youtubeId: string | null;
  minStageDurationMs: number;
  isDemo: boolean;
  repeatExposure: boolean;
  result: null | {
    game: GameContent;
    score: number;
    accuracy: number;
    stage: number;
    correct: number[];
    missed: number[];
    wrong: number[];
    isIllustrative: boolean;
    saved: boolean;
    followed: boolean;
    percentile: number | null;
    community: { tagId: number; count: number }[];
    sampleSize: number;
  };
}
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
