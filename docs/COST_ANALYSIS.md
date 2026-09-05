# Cost and revenue model

§47 and §48 ask for a cost model at four scales with the ratios changeable.

```bash
npm run cost-model
npm run cost-model -- --paying 0.03 --vip 0.2 --active 0.4
```

A script rather than a table, because a table goes stale silently and cannot be
re-run with different assumptions. It reads the tier prices out of
`src/lib/billing/tiers.ts`, so the model cannot disagree with what the app
charges.

---

## What it says

At the default assumptions — 5% paying, 70/30 PLUS/VIP, 25% monthly active:

| Annual | 10k | 100k | 1M | 10M |
| --- | --- | --- | --- | --- |
| Paying members | 500 | 5,000 | 50,000 | 500,000 |
| Gross revenue | $14.5k | $144.9k | $1.45M | $14.49M |
| Store fees (15%) | −$2.2k | −$21.7k | −$217.4k | −$2.17M |
| **Net revenue** | **$12.3k** | **$123.2k** | **$1.23M** | **$12.32M** |
| Total cost | $6.4k | $61.6k | $610.8k | $6.09M |
| Profit before tax | $5.9k | $61.6k | $621.3k | $6.23M |
| Tax (25%) | −$1.5k | −$15.4k | −$155.3k | −$1.56M |
| **Profit after tax** | **$4.5k** | **$46.2k** | **$466.0k** | **$4.67M** |
| Margin | 36% | 38% | 38% | 38% |

---

## The three findings that matter

**1. Margin is flat at ~38%, and that is the unusual part.** Most software gets
cheaper per user with scale. This does not, because its dominant costs are
*per-use* rather than per-tenant: translation is charged per character, voice
and multiplayer per participant-minute. Scale buys nothing on those lines. The
model is therefore not "get big and the margin arrives" — the margin at 10k is
the margin at 10M, and improving it means changing unit economics, not waiting.

**2. Translation, voice and multiplayer are about 80% of every cost column.**
Servers, database, storage, bandwidth and email together are noise at every
scale. At 1M members those three are ~$588k of a ~$611k total.

That reframes the infrastructure question. Choosing a cheaper VPS saves
hundreds; choosing a voice provider with a different per-minute rate moves
hundreds of thousands. **The hosting decision is not the expensive one.**

**3. Two of those three providers have not been chosen.** Voice and multiplayer
are placeholders in the model. See `VOICE.md` and `MULTIPLAYER.md` — the model
exists partly to say what that decision is worth: at 1M members, a 2× difference
in the voice rate is ~$180k a year.

---

## What the numbers rest on

**Verified today against primary sources — the two that dominate revenue:**

| | Rate | Source |
| --- | --- | --- |
| Apple commission | 15% under the Small Business Program, for proceeds up to $1M in the prior calendar year | developer.apple.com |
| Google Play commission | 15% on auto-renewing subscriptions, regardless of annual revenue | support.google.com |

Both are 15%, so the model blends them into one rate rather than inventing a
split between stores that nobody can know before launch.

> **Above $1M in proceeds, Apple's standard rate applies and this model
> understates fees.** The 10M column is the one affected, and it is the column
> most likely to be quoted at someone. Re-check before using it.

**Everything else is an unverified estimate**, and the script prints them as such
on every run rather than hiding it in a footnote. §47's actual instruction is not
to assume a price is current, and the vendors' pricing pages render in the
browser rather than serving readable content, so they could not be confirmed
here. Each carries its reasoning; each is order-of-magnitude, not a quote.

Two lines are `$0` and genuinely are: push delivery (APNs and FCM do not charge
to send) and monitoring — the second being a gap rather than a saving, since
nothing is wired.

---

## Assumptions worth arguing with

| Assumption | Default | Why it is the fragile one |
| --- | --- | --- |
| `payingShare` | 5% | §48's figure. Dating apps vary enormously; 2% is a plausible bad case and halves everything. |
| `monthlyActiveShare` | 25% | Not in §48, added because usage-driven costs scale with *use*, not signups. A model without it overstates cost ~4×. |
| `translationsPerActiveMonth` | 40 | A guess. The free tier caps at 15/day, so the ceiling is far higher; if real usage approaches it, translation alone exceeds revenue. |
| `virtualDateMinutesPerActiveMonth` | 20 | A guess about a feature that does not exist yet. |

The last two are where this model is most likely to be wrong, and both are
usage on the lines that dominate. **Instrument them before trusting the totals**
— `/app/admin/metrics` already reports translation and virtual-date counts, so
the real ratios are measurable as soon as there are members.

---

## The pricing tension this exposes

At $19.99/year, one PLUS member funds roughly 850k translated characters a year
at the estimated rate — and PLUS advertises *unlimited* translation.

The ceiling that protects this is not a limit on PLUS but the ordinary shape of
conversation: most people do not translate a million characters. But it means
**the free tier's 15/day cap is a cost control, not a sales tactic**, and that
raising it is a financial decision rather than a generosity one.

The same logic runs through virtual dates, which is why that allowance is spent
by both people at acceptance — see `ENTITLEMENTS.md`.
