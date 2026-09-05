# Documentation

The fifteen documents §53 asks for, and where each one is.

## Built and running

| | |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | how the pieces fit, and the analysis behind them |
| [`AUTH.md`](AUTH.md) | registration, sessions, roles, deletion |
| [`ENTITLEMENTS.md`](ENTITLEMENTS.md) | the three tiers, where each limit is enforced, and why |
| [`PAYMENTS.md`](PAYMENTS.md) | store verification, notifications, what is unwired |
| [`SAFETY.md`](SAFETY.md) | blocking, reporting, Scam Shield, moderation |
| [`AI_SAFETY.md`](AI_SAFETY.md) | the rules the AI itself obeys |
| [`PRIVACY.md`](PRIVACY.md) | what is not collected, and why that is the design |
| [`SECURITY.md`](SECURITY.md) | §30's controls, audited, with how each was checked |

## Shipping it

| | |
| --- | --- |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | running the server, the checks, the known gaps |
| [`BUILDS.md`](BUILDS.md) | every build target, and the last step for each |
| [`STORE_COMPLIANCE.md`](STORE_COMPLIANCE.md) | what `npm run store:check` proves, and what it cannot |
| [`mobile.md`](mobile.md) | the native shells |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | failures that actually happened here |

## Money

| | |
| --- | --- |
| [`COST_ANALYSIS.md`](COST_ANALYSIS.md) | the model at four scales — run `npm run cost-model` |

## Not built

These describe decisions nobody has made yet rather than code that exists.

| | |
| --- | --- |
| [`VR_SETUP.md`](VR_SETUP.md) | the handover: what the server already gives a headset |
| [`VOICE.md`](VOICE.md) | what the spatial voice decision costs and must satisfy |
| [`MULTIPLAYER.md`](MULTIPLAYER.md) | the same, for room synchronisation |
| [`ASSET_LICENSES.md`](ASSET_LICENSES.md) | the register — short, because nothing third-party ships yet |

---

Elsewhere: [`../README.md`](../README.md) is the product and the codebase tour;
[`../ROADMAP.md`](../ROADMAP.md) sequences the work and names the launch
blockers.
