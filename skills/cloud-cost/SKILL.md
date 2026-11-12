---
name: cloud-cost
description: Implement or review provenance-aware cloud and AI price snapshots and simulation cost estimates.
---

# Cloud Cost

Read pricing contract, adapter implementation and only relevant provider entries in docs/RESEARCH.md. Do not quote remembered rates. Fetch official sources when refreshing; preserve last good snapshot on timeout, malformed payload or partial pagination.

Record provider, SKU/model, region, currency, billing unit, tier/term, effective time when available, retrieval time, source URL and snapshot identity. Distinguish published list rate, cached rate, manual/account override and illustrative estimate. Unknown is not zero. Keep overrides explicit and reversible; never inspect or edit credentials to enable research.

AWS Query/Bulk, GCP Catalog and Azure Retail have different auth/filter/pagination behavior; do not promise universal live refresh. Normalize exact units before multiplication. Model hours, requests, storage, egress and AI input/local-evidence-omitted dimensions separately where supported; list exclusions. Contract monthly hours defaults to 730 as an assumption. Experiment cost uses simulated duration, not playback duration. Reject mismatched currency or missing unit rather than silently combining totals.

For AI providers, model identity alone does not define price: modality, caching, context tiers and processing mode may matter. Test fixed snapshots offline and a synthetic one-hour quote; network access is not a unit-test prerequisite.

Sources: [AWS](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html), [GCP](https://docs.cloud.google.com/billing/v1/how-tos/catalog-api), [Azure](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), and provider pricing links in [research](../../docs/RESEARCH.md).
