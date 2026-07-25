# Content Service Extraction (M5) Migration Documentation

## Extracted Subsystems
Following the Strangler Fig pattern, the following components have been extracted from the legacy monolith:
* **CMS/Public Pages**: Creating, managing, and rendering guides, policies, and FAQs.
* **SEO Metadata**: Handling page title, meta description, and keywords metadata tags.
* **SEO Redirects**: Managing URL paths mapping with status codes `301` or `302`.
* **Sitemap Sources**: Generating dynamically `sitemap_index.xml` and sub-sitemaps (`sitemap.xml`, `sitemap-cities.xml`, `sitemap-guides.xml`, `sitemap-images.xml`).
* **Robots Configuration**: Exposing dynamic `/robots.txt` mapping.
* **i18n Translations**: Serving localized language dictionary bundles (`vi`, `en`).
* **Public Navigation & Policies**: Managing menu paths and public terms files.

---

## Database Ownership
The Content Service owns the isolated `workhub_content` database. Direct monolith calls are replaced by events or local queries on:
* `content_pages` (Cleaned from stored XSS via HTML sanitization)
* `seo_metadata` (Meta tags list)
* `seo_redirects` (Prevents 1-step and 2-step redirect loops)
* `translations` (Locale dictionaries)
* `public_navigation` (Menus)
* `public_policies` (Terms/agreements)
* `content_outbox` (Transactional outbox)
* `processed_messages` (Idempotence)
* `audit_logs` (Logs change actor/reason)

---

## Gateway Cutover Routes
The following endpoints are routed by `apps/api-gateway/server.js` using stable canary buckets:
* `GET /api/content/pages/*`
* `GET /api/i18n/*`
* `GET /api/seo/redirects/*`
* `GET /sitemap*.xml`
* `GET /robots.txt`

For admin mutations:
* `POST /api/content/pages` (Requires admin role)
* `DELETE /api/content/pages/:slug` (Requires admin)
* `POST /api/seo/redirects` (Requires admin)
* `DELETE /api/seo/redirects/:id` (Requires admin)
* `POST /api/i18n` (Requires admin)

---

## Data Migration & Backfill
* **Script**: `services/content-service/scripts/backfillContent.js`
* **Execution**: Processes `cms_pages` and `seo_redirects` in batches, performing idempotent upserts.
* **Verification**: Computes pre- and post-migration counts for both databases, validating that the target totals match the source of truth, and logging errors without exposing push secrets.
* **Delta Sync**: Allows filtering source records using `updatedAt` timestamps to sync changes made during cutover.

---

## Rollback Plan
1. **API Gateway Rollback**: Set `COMMUNICATION_CANARY_PERCENT=0` (or `CONTENT_CANARY_PERCENT=0`) and `CONTENT_SERVICE_ENABLED=false` at the gateway. Traffic is redirected back to the monolith in under 1 second.
2. **Data Fallback**: The monolith databases remain intact. Incremental changes made in the microservice during the canary phase can be reconciled back to the monolith using the backfill script's database connection maps.
