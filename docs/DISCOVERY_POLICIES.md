# Discovery policies

The default remains **Personalized random**. Admin → Operations can select MMR or contextual exploration for future Daily sets. Every change requires an audit reason. Existing assignments, strict exclusions, and sponsored campaigns are unaffected. Billing does not enter any policy's feature vector or relevance score.

## Three selectable policies

| Policy     | Behavior                                                                                                        | Cold-start behavior                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `baseline` | Original percentile pool, exposure-weighted random draws, bounded similarity rejection                          | Uses explicit taste and available behavioral tag weights            |
| `mmr`      | Stochastic MMR utility balances relevance against maximum similarity to an already chosen game                  | Works from content/taste without a trained model                    |
| `linucb`   | Blends content relevance with a per-player linear prediction and uncertainty bonus, then applies stochastic MMR | Falls back to MMR unless that player has enough valid live feedback |

All policies retain no ordinary repeats, Hard No genre exclusions, unique studios/publishers/families, a bounded catalog, and percentile relaxation only when necessary to fill the set. A recorded shortage does not weaken those constraints.

The MMR utility is `lambda * relevance - (1 - lambda) * redundancy`. Redundancy is maximum pairwise tag cosine similarity to the games already selected. The administrator can tune `lambda` from 0.5 to 1. Utilities are converted to positive softmax weights at temperature 0.2, then multiplied by `1 / sqrt(1 + qualified organic exposures)`. This is a stochastic adaptation of [Carbonell and Goldstein's MMR principle](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf), not deterministic argmax MMR. It preserves the product's random-discovery premise.

## Contextual exploration

Each game decision stores eight bounded features: intercept, overall positive tag affinity, genre/subgenre affinity, mechanic affinity, mood affinity, visual affinity, player-mode affinity, and explicit/inferred negative affinity. The features are frozen before the reveal. Later taste edits do not reconstruct or rewrite them.

The linear model uses `A = I + sum(x xᵀ)`, `b = sum(reward * x)`, and `theta = A⁻¹ b`. Sherman–Morrison updates avoid repeated matrix inversion. A candidate's bonus is `alpha * sqrt(xᵀ A⁻¹ x)`. Its clipped prediction-plus-bonus contributes 35% of relevance; content similarity contributes 65%. The administrator can tune `alpha` from 0 to 1.

This shared-feature, per-player linear-UCB adaptation draws on [Li et al.'s contextual-bandit formulation](https://arxiv.org/abs/1003.0146). It uses stochastic sampling and MMR constraints rather than reproducing their disjoint-arm argmax algorithm. Their empirical lift and regret guarantees are not claimed for this app.

Training eligibility is deliberately conservative:

- The account and game are not demos; the assignment belongs to a live catalog and a qualified first impression.
- Owners, team testers, and repeats are excluded by qualification. Account deletion removes the training source.
- There is at most one observation per distinct game, using its latest eligible explicit outcome.
- Would Play, Save, Follow, or a Steam click is positive. An active Not For Me is negative and takes precedence for that assignment. Missing feedback supplies no observation. Quiz score, accuracy, and paid activity are never rewards.
- Only the last 90 days and at most 200 valid observations are read. Malformed, unknown-version, missing, and future contexts are excluded.
- Activation requires 20 observations, including at least three positive and three negative outcomes. These are engineering readiness gates, not claims of statistical sufficiency or human verification.

The model is rebuilt on demand, without a persistent cross-request or cross-user cache. Unmarking an action, deleting an account, or retroactively excluding a tester therefore changes the next eligible training set. During a single selection, context/prediction calculations are reused for the three slots; those maps are then released.

## Rollout, observation, and rollback

Keep baseline for the initial live-catalog and instrumentation check. Record a measurement plan before selecting MMR. Inspect completion, explicit relevance, similarity, coverage, and exposure inequality. Contextual exploration becomes usable only as new real outcomes accumulate; samples and old sets without compatible frozen contexts cannot unlock it.

Admin reports the policy actually applied, set/start/completion/rating counts, positive relevance, mean similarity, and cold-start fallback counts over 30 days of live sets. These groups differ in users, maturity, and time. Treat the reports as observational; a lower similarity value or higher percentage does not prove causal benefit.

Each optional-policy decision records its conditional selection probability after the eligible pool and previous slots are known. These records support auditing and future evaluation design; by themselves they do not establish an unbiased offline evaluation. Baseline probabilities are intentionally null because the existing rejection step is not the same distribution.

Rollback by selecting Personalized random and recording why. New sets use baseline; existing sets and their analysis remain tied to their original policies. Do not rewrite history to make a rollout look better.

## Verification and limits

Run `npm test` and `npm run benchmark:discovery`. The benchmark has no network or database mutations, uses a labeled synthetic 3,000-candidate catalog, and records timing/memory without asserting production capacity. Source tests cover model math, invalid/bounded data, novelty and Hard No invariants, small/one-sided feedback, attribution, user isolation, undo, and configuration audit behavior.

The shipped private Site still uses baseline and sample mode. No live policy experiment, uplift claim, or human trial has been performed. The original plan's optional collaborative/hybrid Phase 5 remains dependent on sufficient real history; no neural model, cross-user training, or paid organic boost was added.
