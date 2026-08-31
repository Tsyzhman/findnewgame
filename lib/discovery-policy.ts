export type DiscoveryPolicy = 'baseline' | 'mmr' | 'linucb';
export interface DiscoverySettings {
  policy: DiscoveryPolicy;
  relevanceWeight: number;
  exploration: number;
}
export const DEFAULT_DISCOVERY: Readonly<DiscoverySettings> = {
  policy: 'baseline',
  relevanceWeight: 0.75,
  exploration: 0.35,
};
export const BANDIT = {
  featureVersion: 'affinity-v1',
  dimensions: 8,
  minimumSamples: 20,
  minimumPerOutcome: 3,
  maximumSamples: 200,
  historyDays: 90,
  temperature: 0.2,
} as const;

export function parseDiscoverySettings(
  value: unknown,
): DiscoverySettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const settings = value as Record<string, unknown>;
  if (
    !['baseline', 'mmr', 'linucb'].includes(String(settings.policy)) ||
    typeof settings.relevanceWeight !== 'number' ||
    !Number.isFinite(settings.relevanceWeight) ||
    settings.relevanceWeight < 0.5 ||
    settings.relevanceWeight > 1 ||
    typeof settings.exploration !== 'number' ||
    !Number.isFinite(settings.exploration) ||
    settings.exploration < 0 ||
    settings.exploration > 1
  )
    return null;
  return {
    policy: settings.policy as DiscoveryPolicy,
    relevanceWeight: settings.relevanceWeight,
    exploration: settings.exploration,
  };
}

export interface BanditObservation {
  features: readonly number[];
  reward: 0 | 1;
}
export interface LinearModel {
  inverse: number[][];
  theta: number[];
  samples: number;
  positives: number;
  negatives: number;
}
export function validFeatures(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === BANDIT.dimensions &&
    value[0] === 1 &&
    value.every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
    )
  );
}
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, n, i) => sum + n * b[i], 0);

/** Per-player ridge model with a unit prior; no global or cross-user model cache. */
export function fitLinearBandit(
  observations: readonly BanditObservation[],
): LinearModel {
  const inverse = Array.from({ length: BANDIT.dimensions }, (_, i) =>
    Array.from({ length: BANDIT.dimensions }, (_, j) => (i === j ? 1 : 0)),
  );
  const b: number[] = Array(BANDIT.dimensions).fill(0);
  let samples = 0,
    positives = 0;
  for (const observation of observations) {
    if (
      !validFeatures(observation.features) ||
      ![0, 1].includes(observation.reward)
    )
      continue;
    if (samples >= BANDIT.maximumSamples) break;
    const x = observation.features,
      projected = inverse.map((row) => dot(row, x));
    const denominator = 1 + dot(x, projected);
    // Sherman–Morrison updates (I + sum xxᵀ)⁻¹ without an unstable matrix inversion.
    for (let i = 0; i < BANDIT.dimensions; i++) {
      b[i] += observation.reward * x[i];
      for (let j = 0; j < BANDIT.dimensions; j++)
        inverse[i][j] -= (projected[i] * projected[j]) / denominator;
    }
    samples++;
    positives += observation.reward;
  }
  return {
    inverse,
    theta: inverse.map((row) => dot(row, b)),
    samples,
    positives,
    negatives: samples - positives,
  };
}
export function linearPrediction(
  model: LinearModel,
  features: readonly number[],
) {
  if (!validFeatures(features)) throw new Error('Invalid discovery context.');
  return {
    mean: dot(model.theta, features),
    uncertainty: Math.sqrt(
      Math.max(
        0,
        dot(
          features,
          model.inverse.map((row) => dot(row, features)),
        ),
      ),
    ),
  };
}

/** Stochastic MMR keeps every eligible item possible and retains exposure fairness. */
export function discoveryProbabilities(
  candidates: readonly {
    relevance: number;
    redundancy: number;
    impressions: number;
  }[],
  relevanceWeight: number,
): number[] {
  if (!candidates.length) return [];
  const utility = candidates.map(
    (c) => relevanceWeight * c.relevance - (1 - relevanceWeight) * c.redundancy,
  );
  const maximum = Math.max(...utility);
  const weights = candidates.map(
    (candidate, i) =>
      Math.exp(Math.max(-20, (utility[i] - maximum) / BANDIT.temperature)) /
      Math.sqrt(1 + Math.max(0, candidate.impressions)),
  );
  const sum = weights.reduce((total, n) => total + n, 0);
  return weights.map((weight) => weight / sum);
}
