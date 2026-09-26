# Stablecoins: First-Mover Adoption Trends

> **Source:** Stripe, *"First movers in stablecoins: Five adoption trends from our global data"*  
> **Original:** Stripe.com/crypto  
> **Date:** 2025 (post-GENIUS Act, Circle IPO era)  
> **Saved:** 2026-09-25 — Reference for Jump's payment strategy and stablecoin integration decisions

## Executive Summary

Stripe surveyed ~2,000 business leaders and analyzed their own payment data (Jan–Jun 2025). Key findings:

- **Stablecoin adjusted transaction volume grew 48%+** globally from 2023–2024
- **Stripe stablecoin payment volume grew 5× year-over-year**
- **30% month-over-month growth** in stablecoin transaction volume on Stripe in H1 2025
- US Treasury Secretary Scott Bessent predicted the stablecoin sector could **grow tenfold by 2030**
- **70% of customers paying in stablecoins are net-new** to the business, vs 30% for other payment methods

---

## The Five Adoption Trends

### 1. High Cross-Border Transaction Volume Drives Adoption

Cross-border transactions are slow and costly. Businesses processing **over $1M/month in cross-border payments** are 50%+ more likely to use stablecoins (25% adoption vs 16% global average).

- Shadeform (AI/GPU cloud) moved 20% of payment volume to stablecoins and **cut processing fees by more than half**, boosting revenue by 10%.

**Jump relevance:** As Jump processes payments across US states and potentially international markets, stablecoin rails could reduce processing costs on cross-border transactions, particularly for event organizers with international vendors or attendees.

### 2. Platforms and Marketplaces Relieve FX Pressure

Platforms face exposure to **multi-currency transaction and FX fees** at scale: they store and move money in multiple currencies and pay out to merchants/vendors worldwide.

- **Shopify** announced stablecoin payments for merchants in 34 countries
- Marketplaces are **~40–60% more likely** to use stablecoins (27% of marketplaces vs 16% global)

**Jump relevance:** Jump operates as a platform that collects money from ticket buyers and distributes to event organizers. Stablecoin payouts to organizers could reduce FX friction and settlement delays.

### 3. AI and SaaS Companies Sell Everywhere, Instantly

Digital-goods businesses face fewer regional barriers — 19 of the top 20 AI companies on Stripe are US-based, yet **60% of their revenue comes from outside the US**.

- Stablecoins serve as a **"global local payment method"** — one integration opens worldwide markets without deploying country-by-country LPMs
- AI companies are **nearly 2× more likely** to use stablecoins (30% vs 16%)
- SaaS companies similarly at 29% adoption

**Jump relevance:** Digital event tickets are effectively digital goods. Stablecoin acceptance could unlock buyers in regions with low card penetration.

### 4. Financial Services Companies Build Stablecoin Infrastructure

Financial services are the segment **most likely to use stablecoins exclusively**, often foregoing other cryptocurrencies.

- **Ramp** uses stablecoins to extend spend cards globally
- **Dakota** holds >50% of assets in a self-issued stablecoin (DKUSD)
- **Bank of America** signaled interest in issuing its own stablecoin
- Financial services firms are **~40% more likely** to use stablecoins (22% vs 16%)

**Jump relevance:** If Jump evolves into holding and managing event-organizer balances (ticketing float, deposits), stablecoin treasury management could become relevant.

### 5. Stablecoins Reach New Customers Across the Global South

Customers outside the US/Europe are less likely to have credit cards, and **card authorization rates can be up to 30% lower** in these regions. However, they are **2× more likely to have crypto wallets**.

- Companies serving sub-Saharan Africa are nearly **2× more likely** to use stablecoins (31%)
- MENA: 27%, LATAM: 27%
- **70% of stablecoin-paying customers are net-new** — indicating latent demand

**Jump relevance:** Event organizers targeting international attendees or diaspora communities could reach new buyers through stablecoin acceptance.

---

## How Stripe Enables Stablecoins

Stripe offers four stablecoin capabilities that Jump could leverage:

| Capability | Description |
|---|---|
| **Accept payments** | Switch on stablecoin payments — one integration, instant global access |
| **Send payouts** | Pay contractors or vendors abroad using stablecoins |
| **Hold/manage balances** | Dollar-denominated stablecoin balance across fiat and crypto rails (ACH, wire, 8 blockchains) |
| **Issue own stablecoin** | Bridge Open Issuance — custom stablecoin backed by preferred reserve mix, for internal money management or customer rewards |

## Key Data Points

- **$6T → $4T → $2T** stablecoin transaction volume growth (2023–2024, Visa onchain analytics)
- **48%+** increase in global stablecoin adjusted transaction volume 2023–2024
- **30% MoM** growth in stablecoin volume on Stripe H1 2025
- Only **16%** of businesses overall use stablecoins, but adoption **doubles** among global platforms, fast-moving startups, financial services, and businesses processing >$1M/month cross-border
- Nearly **50%** of business leaders are considering stablecoins

## Implications for Jump

1. **Payment method expansion:** Stablecoins could supplement Stripe's fiat payment methods (credit cards, ACH) for Jump's event ticketing platform, particularly for international buyers
2. **Organizer payouts:** Payouts in stablecoins could reduce FX costs and settlement time for organizers operating across borders
3. **Unlocks new markets:** The 70% net-new-customer statistic suggests stablecoins could help Jump event organizers reach buyers inaccessible via traditional cards
4. **Regulatory tailwind:** The GENIUS Act (US stablecoin regulation) and Circle's IPO signal maturing regulatory environment, reducing risk
5. **Strategic differentiation:** Being an early mover in stablecoin-accepting event ticketing could be a competitive advantage as the sector grows

---

*Filed as research reference for Jump's payment architecture planning.*
*See also: `docs/roadmap.md`, `docs/wiki/features/payments-settings.md`, `specs/010-payments-settings/`*