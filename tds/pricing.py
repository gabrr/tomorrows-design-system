"""Provider catalogs: immutable fetched snapshots, explicit units, no invented live prices."""
import hashlib
import json
import math
import os
import threading
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from .storage import DATA, atomic_json, read_json

LOCK = threading.Lock()
SOURCES = {
    'openrouter': 'https://openrouter.ai/docs/api/api-reference/models/get-models',
    'aws': 'https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html',
    'azure': 'https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices',
    'gcp': 'https://cloud.google.com/billing/v1/how-tos/catalog-api',
    'openai': 'https://openai.com/api/pricing/',
    'anthropic': 'https://platform.claude.com/docs/en/about-claude/pricing',
    'google': 'https://ai.google.dev/gemini-api/docs/pricing',
}

def fetch_json(url):
    request = Request(url, headers={'User-Agent': 'TomorrowsDesignSystem/0.1', 'Accept': 'application/json'})
    with urlopen(request, timeout=25) as response:
        payload = response.read(24 * 1024 * 1024 + 1)
    if len(payload) > 24 * 1024 * 1024:
        raise ValueError('Provider response exceeds the 24 MiB catalog budget; use a narrower source.')
    return json.loads(payload)

def amount(value):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError('Pricing amount must be finite and nonnegative.')
    return number

def get_prices():
    records, snapshots = [], []
    for provider in SOURCES:
        snapshot = read_json(DATA / 'pricing' / (provider + '.json'))
        if snapshot:
            records.extend(dict(record, snapshot_id=snapshot.get('snapshot_id')) for record in snapshot.get('records', []))
            snapshots.append({k: v for k, v in snapshot.items() if k != 'records'})
    return {'records': records, 'snapshots': snapshots, 'sources': SOURCES,
            'providers': [{'id': p, 'live': p in ('openrouter', 'aws', 'azure', 'gcp'), 'requires_key': p == 'gcp', 'source': u} for p, u in SOURCES.items()],
            'warnings': ['Published prices exclude account-specific discounts, taxes and private quotas.', 'Direct AI provider prices require explicit manual configuration; OpenRouter prices apply to OpenRouter access only.', 'AWS, Azure and GCP refreshes fetch bounded representative catalogs, not every service.']}

def refresh_prices(provider):
    if provider not in SOURCES:
        raise ValueError('Unknown pricing provider.')
    if provider in ('openai', 'anthropic', 'google'):
        raise ValueError('Configure direct-provider prices manually using the linked source. No verified machine-readable direct pricing adapter is installed.')
    if not LOCK.acquire(blocking=False):
        raise ValueError('A pricing refresh is already running.')
    try:
        stamp = datetime.now(timezone.utc).isoformat()
        records = []
        if provider == 'openrouter':
            url = 'https://openrouter.ai/api/v1/models'
            data = fetch_json(url)
            for model in data.get('data', []):
                prices = model.get('pricing', {})
                if 'prompt' not in prices or 'completion' not in prices:
                    continue
                try:
                    record = {'id': model['id'], 'label': model.get('name', model['id']), 'provider': provider,
                              'model_provider': model['id'].split('/')[0], 'model': model['id'],
                              'input_per_million': amount(prices['prompt']) * 1e6,
                              'output_per_million': amount(prices['completion']) * 1e6,
                              'request_cost': amount(prices.get('request', 0)),
                              'context_length': model.get('context_length'), 'quota': None,
                              'unit': 'USD / million tokens', 'currency': 'USD'}
                    records.append(record)
                except (ValueError, TypeError, KeyError):
                    continue
        elif provider == 'azure':
            query = urlencode({'$filter': "serviceName eq 'Virtual Machines' and armRegionName eq 'eastus' and armSkuName eq 'Standard_D2s_v5' and priceType eq 'Consumption'"})
            url = 'https://prices.azure.com/api/retail/prices?' + query
            data = fetch_json(url)
            for item in data.get('Items', []):
                if item.get('unitOfMeasure') != '1 Hour':
                    continue
                records.append({'id': item['meterId'], 'label': item['productName'] + ' / ' + item['skuName'] + ' / ' + item.get('meterName', ''), 'provider': provider, 'region': item['armRegionName'], 'hourly_cost': amount(item['retailPrice']), 'currency': item['currencyCode'], 'unit': 'instance-hour', 'sku': item.get('armSkuName'), 'quota': None})
        elif provider == 'aws':
            url = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json'
            data = fetch_json(url)
            products = data.get('products', {})
            for sku, terms in data.get('terms', {}).get('OnDemand', {}).items():
                for term in terms.values():
                    for dimension in term.get('priceDimensions', {}).values():
                        if dimension.get('beginRange') != '0':
                            continue
                        records.append({'id': dimension['rateCode'], 'label': dimension['description'], 'provider': provider, 'region': products.get(sku, {}).get('attributes', {}).get('regionCode', 'us-east-1'), 'price': amount(dimension['pricePerUnit']['USD']), 'unit': dimension['unit'], 'currency': 'USD', 'sku': sku, 'quota': None})
        else:
            key = os.environ.get('GOOGLE_CLOUD_API_KEY')
            service = os.environ.get('TDS_GCP_SERVICE', '6F81-5844-456A')
            if not key:
                raise ValueError('GCP Catalog requires GOOGLE_CLOUD_API_KEY in the server environment. Manual pricing remains available.')
            import re
            if not re.fullmatch(r'[A-Za-z0-9-]+', service):
                raise ValueError('Invalid GCP service identifier.')
            url = 'https://cloudbilling.googleapis.com/v1/services/' + service + '/skus?pageSize=250'
            data = fetch_json(url + '&' + urlencode({'key': key}))
            for sku in data.get('skus', []):
                info = sku.get('pricingInfo', [])
                if not info:
                    continue
                expression = info[-1]['pricingExpression']
                for tier in expression.get('tieredRates', []):
                    unit_price = tier['unitPrice']
                    records.append({'id': sku['skuId'] + ':' + str(tier.get('startUsageAmount', 0)), 'label': sku['description'], 'provider': provider, 'regions': sku.get('serviceRegions', []), 'price': amount(float(unit_price.get('units', 0)) + unit_price.get('nanos', 0) / 1e9), 'unit': expression.get('usageUnit'), 'tier_start': tier.get('startUsageAmount', 0), 'currency': unit_price.get('currencyCode', 'USD'), 'quota': None})
        for record in records:
            record.update({'source': url, 'retrieved_at': stamp, 'provenance': 'provider-published'})
        if not records:
            raise ValueError('No usable prices returned; the previous snapshot was preserved.')
        digest = hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()
        snapshot = {'provider': provider, 'retrieved_at': stamp, 'source': url, 'snapshot_id': digest, 'records': records, 'partial': provider != 'openrouter'}
        atomic_json(DATA / 'pricing' / (provider + '.json'), snapshot)
        atomic_json(DATA / 'pricing' / 'snapshots' / (digest + '.json'), snapshot)
        return snapshot
    finally:
        LOCK.release()
