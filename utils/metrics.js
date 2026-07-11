"use strict";

/**
 * In-process Prometheus text exposition (no external deps).
 * Labels are low-cardinality only (method, status class, route group).
 */

const startTime = Date.now();

const counters = {
  http_requests_total: new Map(), // key method|statusClass|group
  http_request_errors_total: 0,
  bookings_created_total: 0,
  payments_verified_total: 0,
  jobs_processed_total: 0,
};

const histograms = {
  // coarse buckets in ms
  http_request_duration_ms: {
    buckets: [50, 100, 200, 500, 800, 1500, 3000, 10000],
    counts: new Map(), // bucket edge -> count
    sum: 0,
    count: 0,
  },
};

for (const b of histograms.http_request_duration_ms.buckets) {
  histograms.http_request_duration_ms.counts.set(b, 0);
}

function routeGroup(path = "") {
  if (!path) return "other";
  if (path.startsWith("/api/auth")) return "api_auth";
  if (path.startsWith("/api/admin")) return "api_admin";
  if (path.startsWith("/api/host") || path.startsWith("/api/hosts"))
    return "api_host";
  if (path.startsWith("/api/gateway")) return "api_gateway";
  if (path.startsWith("/api/search") || path.startsWith("/api/customers"))
    return "api_public";
  if (path.startsWith("/api/")) return "api_other";
  if (path.startsWith("/health") || path === "/metrics") return "ops";
  if (
    path.startsWith("/js/") ||
    path.startsWith("/css/") ||
    path.startsWith("/icons")
  )
    return "static";
  return "pages";
}

function statusClass(code) {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "1xx";
}

function incCounter(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function observeHttpRequest({ method, path, statusCode, durationMs }) {
  const m = (method || "GET").toUpperCase();
  const sc = statusClass(statusCode || 0);
  const group = routeGroup(path);
  incCounter(counters.http_requests_total, `${m}|${sc}|${group}`);
  if ((statusCode || 0) >= 500) counters.http_request_errors_total += 1;

  const h = histograms.http_request_duration_ms;
  h.sum += durationMs;
  h.count += 1;
  for (const b of h.buckets) {
    if (durationMs <= b) h.counts.set(b, (h.counts.get(b) || 0) + 1);
  }
}

function incBookingsCreated() {
  counters.bookings_created_total += 1;
}

function incPaymentsVerified() {
  counters.payments_verified_total += 1;
}

function incJobsProcessed() {
  counters.jobs_processed_total += 1;
}

function escapeLabel(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderPrometheus() {
  const lines = [];
  lines.push("# HELP workhub_process_uptime_seconds Process uptime");
  lines.push("# TYPE workhub_process_uptime_seconds gauge");
  lines.push(
    `workhub_process_uptime_seconds ${(Date.now() - startTime) / 1000}`,
  );

  lines.push("# HELP workhub_http_requests_total HTTP requests");
  lines.push("# TYPE workhub_http_requests_total counter");
  for (const [k, v] of counters.http_requests_total) {
    const [method, status, group] = k.split("|");
    lines.push(
      `workhub_http_requests_total{method="${escapeLabel(method)}",status_class="${escapeLabel(status)}",group="${escapeLabel(group)}"} ${v}`,
    );
  }

  lines.push("# HELP workhub_http_request_errors_total HTTP 5xx responses");
  lines.push("# TYPE workhub_http_request_errors_total counter");
  lines.push(
    `workhub_http_request_errors_total ${counters.http_request_errors_total}`,
  );

  lines.push("# HELP workhub_bookings_created_total Bookings created");
  lines.push("# TYPE workhub_bookings_created_total counter");
  lines.push(
    `workhub_bookings_created_total ${counters.bookings_created_total}`,
  );

  lines.push("# HELP workhub_payments_verified_total Payments verified");
  lines.push("# TYPE workhub_payments_verified_total counter");
  lines.push(
    `workhub_payments_verified_total ${counters.payments_verified_total}`,
  );

  lines.push("# HELP workhub_jobs_processed_total Background jobs processed");
  lines.push("# TYPE workhub_jobs_processed_total counter");
  lines.push(`workhub_jobs_processed_total ${counters.jobs_processed_total}`);

  const h = histograms.http_request_duration_ms;
  lines.push(
    "# HELP workhub_http_request_duration_ms HTTP request duration milliseconds",
  );
  lines.push("# TYPE workhub_http_request_duration_ms histogram");
  for (const b of h.buckets) {
    lines.push(
      `workhub_http_request_duration_ms_bucket{le="${b}"} ${h.counts.get(b) || 0}`,
    );
  }
  lines.push(`workhub_http_request_duration_ms_bucket{le="+Inf"} ${h.count}`);
  lines.push(`workhub_http_request_duration_ms_sum ${h.sum}`);
  lines.push(`workhub_http_request_duration_ms_count ${h.count}`);

  const mem = process.memoryUsage();
  lines.push("# HELP workhub_nodejs_heap_used_bytes Node heap used");
  lines.push("# TYPE workhub_nodejs_heap_used_bytes gauge");
  lines.push(`workhub_nodejs_heap_used_bytes ${mem.heapUsed}`);
  lines.push("# HELP workhub_nodejs_rss_bytes Node RSS");
  lines.push("# TYPE workhub_nodejs_rss_bytes gauge");
  lines.push(`workhub_nodejs_rss_bytes ${mem.rss}`);

  return lines.join("\n") + "\n";
}

function snapshot() {
  return {
    uptimeSec: (Date.now() - startTime) / 1000,
    httpRequests: Object.fromEntries(counters.http_requests_total),
    httpErrors: counters.http_request_errors_total,
    bookingsCreated: counters.bookings_created_total,
    paymentsVerified: counters.payments_verified_total,
    jobsProcessed: counters.jobs_processed_total,
    duration: {
      count: histograms.http_request_duration_ms.count,
      sum: histograms.http_request_duration_ms.sum,
    },
  };
}

module.exports = {
  observeHttpRequest,
  incBookingsCreated,
  incPaymentsVerified,
  incJobsProcessed,
  renderPrometheus,
  snapshot,
  routeGroup,
};
