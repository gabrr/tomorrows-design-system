"""Illustrative component templates, not provider-specific performance claims."""

from copy import deepcopy


_GROUPS = {
    "clients": [("browser", "Browser"), ("mobile_client", "Mobile client"), ("api_client", "API client"), ("iot_device", "IoT device")],
    "networking": [("dns", "DNS"), ("vpc", "Virtual network"), ("nat_gateway", "NAT gateway"), ("vpn", "VPN"), ("transit_gateway", "Transit gateway")],
    "edge": [("cdn", "CDN"), ("edge_function", "Edge function"), ("edge_cache", "Edge cache"), ("global_accelerator", "Global accelerator")],
    "routing": [("load_balancer", "Load balancer"), ("api_gateway", "API gateway"), ("reverse_proxy", "Reverse proxy"), ("service_mesh", "Service mesh"), ("ingress", "Ingress")],
    "security": [("waf", "Web application firewall"), ("firewall", "Firewall"), ("auth_service", "Authentication service"), ("identity_provider", "Identity provider"), ("secrets_manager", "Secrets manager")],
    "compute": [("virtual_machine", "Virtual machine"), ("container", "Container"), ("kubernetes_pod", "Kubernetes pod"), ("serverless_function", "Serverless function"), ("gpu_instance", "GPU instance")],
    "applications": [("web_app", "Web application"), ("api_service", "API service"), ("microservice", "Microservice"), ("graphql", "GraphQL service"), ("websocket_service", "WebSocket service")],
    "database topologies": [("sql_database", "SQL database"), ("postgres", "PostgreSQL"), ("mysql", "MySQL"), ("document_database", "Document database"), ("key_value_database", "Key-value database"), ("database_primary", "Database primary"), ("read_replica", "Read replica"), ("database_shard", "Database shard"), ("distributed_sql", "Distributed SQL")],
    "caching": [("cache", "Cache"), ("redis", "Redis cache"), ("memcached", "Memcached"), ("local_cache", "Local cache")],
    "storage": [("object_storage", "Object storage"), ("block_storage", "Block storage"), ("file_storage", "File storage"), ("archive_storage", "Archive storage")],
    "messaging": [("queue", "Message queue"), ("message_broker", "Message broker"), ("pubsub", "Pub/sub"), ("event_bus", "Event bus"), ("dead_letter_queue", "Dead-letter queue")],
    "workers": [("worker", "Worker"), ("batch_worker", "Batch worker"), ("scheduler", "Scheduler"), ("stream_worker", "Stream worker")],
    "data systems": [("stream", "Event stream"), ("data_warehouse", "Data warehouse"), ("data_lake", "Data lake"), ("etl", "ETL processor"), ("search_index", "Search index")],
    "AI": [("llm", "Language model"), ("openai", "OpenAI endpoint"), ("anthropic", "Anthropic endpoint"), ("google_ai", "Google AI endpoint"), ("openrouter", "OpenRouter endpoint"), ("embedding", "Embedding endpoint"), ("vector_database", "Vector database"), ("reranker", "Reranker"), ("ai_guardrail", "AI guardrail")],
    "dependencies": [("external_api", "External API"), ("payment_gateway", "Payment gateway"), ("email_provider", "Email provider")],
    "observability": [("metrics", "Metrics collector"), ("logging", "Log collector"), ("tracing", "Trace collector"), ("alerting", "Alert evaluator")],
    "recovery": [("backup", "Backup service"), ("disaster_recovery", "Recovery service"), ("replication", "Replication link service")],
    "deployment boundaries": [("region", "Region boundary"), ("availability_zone", "Availability zone boundary"), ("on_premise", "On-premise boundary"), ("cloud_account", "Cloud account boundary")],
}
# Explicit catalog coverage; all entries retain declared service-station limits.
_ADDITIONS = {
    "clients": [("desktop_client", "Desktop client"), ("webhook_producer", "Webhook producer"), ("traffic_generator", "Traffic generator")],
    "networking": [("public_subnet", "Public subnet"), ("private_subnet", "Private subnet"), ("router", "Router"), ("internet_gateway", "Internet gateway"), ("private_endpoint", "Private endpoint"), ("network_link", "Network connection")],
    "edge": [("static_hosting", "Static hosting"), ("media_delivery", "Media delivery")],
    "routing": [("service_discovery", "Service discovery")],
    "security": [("ddos_protection", "DDoS protection"), ("authorization_service", "Authorization service"), ("key_management", "Key management")],
    "compute": [("server", "Application server"), ("container_service", "Container service"), ("kubernetes_cluster", "Kubernetes cluster"), ("batch_job", "Batch job"), ("scheduled_job", "Scheduled job")],
    "applications": [("monolith", "Monolith"), ("webhook_receiver", "Webhook receiver"), ("workflow_orchestrator", "Workflow orchestrator")],
    "database topologies": [("wide_column_database", "Wide-column database"), ("graph_database", "Graph database"), ("time_series_database", "Time-series database"), ("embedded_database", "Embedded database"), ("standby", "Database standby"), ("connection_pooler", "Connection pooler"), ("database_proxy", "Database proxy")],
    "caching": [("http_cache", "HTTP cache"), ("query_cache", "Query cache"), ("session_store", "Session store")],
    "storage": [("ephemeral_disk", "Temporary disk")],
    "messaging": [("priority_queue", "Priority queue"), ("event_topic", "Event topic"), ("event_stream", "Event stream"), ("consumer_group", "Consumer group")],
    "workers": [("worker_pool", "Worker pool"), ("batch_processor", "Batch processor"), ("stream_processor", "Stream processor")],
    "data systems": [("change_data_capture", "Change-data capture"), ("indexing_service", "Indexing service")],
    "AI": [("model_router", "Model router"), ("inference_server", "Inference server"), ("moderation_service", "Moderation service"), ("ai_cache", "AI response cache"), ("agent", "AI agent"), ("tool_execution", "Tool execution"), ("retrieval_pipeline", "Retrieval pipeline"), ("conversation_state", "Conversation state"), ("model_fallback", "Model fallback"), ("batch_inference", "Batch inference")],
    "dependencies": [("sms_provider", "SMS provider"), ("push_notification", "Push notification service"), ("external_authentication", "External authentication")],
    "recovery": [("snapshot", "Snapshot process"), ("restore", "Restore process"), ("failover_controller", "Failover controller")],
    "deployment boundaries": [("data_center", "Data center boundary"), ("host", "Host boundary"), ("cluster", "Cluster boundary"), ("namespace", "Namespace boundary")],
}
for _category, _entries in _ADDITIONS.items():
    _GROUPS[_category].extend(_entries)
CATALOG_VERSION = "tds-components-1.1"
_CACHES = {"cdn", "edge_cache", "cache", "redis", "memcached", "local_cache", "http_cache", "query_cache", "ai_cache"}
_ROUTERS = {"load_balancer", "reverse_proxy", "ingress", "model_router", "model_fallback"}
_QUEUES = {"queue", "message_broker", "pubsub", "event_bus", "dead_letter_queue", "priority_queue", "event_topic", "event_stream"}


def catalog():
    """Return a fresh JSON-serializable catalog on each call."""
    components = []
    for category, entries in _GROUPS.items():
        for kind, label in entries:
            defaults = dict(capacity_rps=100, latency_ms=20, concurrency=100,
                            queue_limit=1000, hourly_cost=0.1,
                            provider="generic", region="local", instance_class="custom")
            model = "Bounded FIFO service station with paced admission and synchronous downstream fan-out."
            limitations = ["Illustrative manual defaults; no measured or provider-specific calibration.",
                           "No protocol, payload-content, resource contention or automatic replication semantics."]
            if kind in _CACHES:
                defaults.update(cache_hit_rate=0.8, latency_ms=2)
                model += " Independent seeded cache-hit branch; only misses invoke downstream."
                limitations.append("No keys, TTL, eviction, invalidation, warming or consistency model.")
            if kind in _ROUTERS:
                defaults.update(routing="weighted", health_check_delay=5, latency_ms=1)
                model += " One weighted healthy destination, with delayed health observations."
                limitations.append("No retries, connection affinity or active probe traffic.")
            if kind in _QUEUES:
                defaults.update(async_dispatch=True, latency_ms=1)
                model += " Acknowledges enqueue and creates independent downstream jobs."
                limitations.append("Single bounded service queue; no durable delivery, retry or exactly-once guarantees.")
            if category == "AI":
                defaults.update(latency_ms=500, concurrency=10, capacity_rps=10)
                limitations.append("No inference quality, batching, GPU memory, streaming tokens or vendor quota model.")
            if kind in ("llm", "openai", "anthropic", "google_ai", "openrouter", "embedding", "reranker", "moderation_service", "inference_server", "batch_inference"):
                defaults.update(model="", input_tokens=1000, output_tokens=250)
            if kind in ("openai", "anthropic", "google_ai", "openrouter"):
                defaults.update(provider={"google_ai": "google"}.get(kind, kind), region="unspecified")
            if category == "database topologies":
                limitations.append("Topology is explicit edges only; no transactions, elections, locks or replica consistency.")
            if kind == "priority_queue":
                limitations.append("FIFO only; priority ordering is not emulated.")
            if kind in ("agent", "tool_execution", "workflow_orchestrator", "scheduler", "scheduled_job"):
                limitations.append("Explicit request-flow service only; no autonomous tool execution or calendar scheduling.")
            if category == "deployment boundaries":
                defaults.update(latency_ms=0, hourly_cost=0, capacity_rps=10000)
                limitations.append("An ordinary station, not a container; failure does not implicitly affect a region's nodes.")
            if category == "observability":
                limitations.append("Ordinary explicit traffic processing; does not collect hidden telemetry or alter the engine.")
            components.append(dict(type=kind, label=label, category=category,
                                   description=f"Illustrative {label.lower()} architecture component.",
                                   defaults=defaults, model=model, limitations=limitations))
    return {"components": components, "catalog_version": CATALOG_VERSION}


def presets():
    """Four experiments with deliberately visible failure and capacity tradeoffs."""
    def node(key, kind, x, y, **config):
        return dict(id=key, type=kind, label=key.replace("_", " ").title(), x=x, y=y, config=config)

    def edge(source, target, **options):
        return dict(id=f"{source}-{target}", source=source, target=target, **options)

    def project(key, name, nodes, edges, events, rps=20):
        return dict(id=key, name=name, nodes=nodes, edges=edges,
                    scenario=dict(duration=60, seed=42, rps=rps, events=events),
                    monthly=dict(hours=730, traffic_multiplier=1))

    return deepcopy([
        project("failover", "Delayed health-check failover", [
            node("balancer", "load_balancer", 80, 160, health_check_delay=5),
            node("app_a", "api_service", 340, 80, latency_ms=30),
            node("app_b", "api_service", 340, 240, latency_ms=30)],
            [edge("balancer", "app_a"), edge("balancer", "app_b")],
            [dict(id="outage", type="fail", target="app_a", time=15),
             dict(id="restore", type="recover", target="app_a", time=40)]),
        project("cache-app", "Cache-backed application", [
            node("app", "web_app", 60, 160), node("cache", "redis", 300, 160, cache_hit_rate=0.85),
            node("database", "postgres", 540, 160, capacity_rps=15, latency_ms=40)],
            [edge("app", "cache"), edge("cache", "database")],
            [dict(id="surge", type="traffic", target="global", time=20, value=100)], rps=30),
        project("queue-worker", "Background jobs and queue drain", [
            node("api", "api_service", 60, 160), node("jobs", "queue", 300, 160),
            node("worker", "worker", 540, 160, capacity_rps=10, concurrency=2, latency_ms=150, queue_limit=500)],
            [edge("api", "jobs"), edge("jobs", "worker")],
            [dict(id="stop-input", type="traffic", target="global", time=20, value=0)], rps=20),
        project("ai-pipeline", "Retrieval and AI pipeline", [
            node("gateway", "api_gateway", 40, 160), node("embedding", "embedding", 220, 160, latency_ms=80, input_tokens=100, input_cost_per_million=0.1),
            node("retrieval", "vector_database", 400, 160, latency_ms=30),
            node("generation", "llm", 580, 160, latency_ms=800, input_tokens=1200, output_tokens=250,
                 input_cost_per_million=2, output_cost_per_million=8)],
            [edge("gateway", "embedding"), edge("embedding", "retrieval"), edge("retrieval", "generation")],
            [dict(id="slow-model", type="latency", target="generation", time=25, value=1500)], rps=3),
    ])
