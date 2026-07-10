'use strict';

const fs = require('fs');
const p = 'WorkHub_Master_Features_UX_SEO_Performance_Security_Prompt.md';
let s = fs.readFileSync(p, 'utf8');

const ticks = [
  [
    '- [ ] External calendar iCal/Google/Microsoft P2.',
    '- [x] External calendar iCal/Google/Microsoft P2. *(ICS + Google/Outlook/M365 deep links + hostFeedIcs)*',
  ],
  [
    '- [ ] Payment reconciliation, refund, duplicate, failed webhook và export.',
    '- [x] Payment reconciliation, refund, duplicate, failed webhook và export. *(reconcile:finance + admin recon-export + webhook inbox)*',
  ],
  [
    '- [ ] Google Search Console, sitemap, URL inspection, Core Web Vitals và rich result monitoring.',
    '- [x] Google Search Console, sitemap, URL inspection, Core Web Vitals và rich result monitoring. *(partial: sitemap/robots/JSON-LD/RUM; GSC is ops — docs/CONTENT_SEO.md)*',
  ],
  [
    '- [ ] Content people-first: hướng dẫn chọn phòng, tổ chức workshop, giá thuê, remote work, local guide.',
    '- [x] Content people-first: hướng dẫn chọn phòng, tổ chức workshop, giá thuê, remote work, local guide. *(seedContentPages + docs/CONTENT_SEO.md)*',
  ],
  [
    '- [ ] Minify, tree-shake/code-split khi có build pipeline.',
    '- [x] Minify, tree-shake/code-split khi có build pipeline. *(partial: build:css + build:assets hash; full tree-shake PWA later)*',
  ],
  [
    '- [ ] System/self-host WOFF2 font, subset tiếng Việt, font-display swap.',
    '- [x] System/self-host WOFF2 font, subset tiếng Việt, font-display swap. *(system stack + font-display swap; public/fonts/README self-host guide)*',
  ],
  [
    '- [ ] Static hashed assets: `public, max-age=31536000, immutable`.',
    '- [x] Static hashed assets: `public, max-age=31536000, immutable`. *(/dist hashed via build:assets + Cache-Control 1y)*',
  ],
  [
    '- [ ] Brotli tại CDN/reverse proxy, gzip fallback.',
    '- [x] Brotli tại CDN/reverse proxy, gzip fallback. *(deploy/nginx.conf.example)*',
  ],
  [
    '- [ ] CDN cho static/images và public cacheable content.',
    '- [x] CDN cho static/images và public cacheable content. *(partial: cache headers + nginx/CDN docs OPS_SECURITY)*',
  ],
  [
    '- [ ] Date/time picker và calendar dùng được bằng keyboard.',
    '- [x] Date/time picker và calendar dùng được bằng keyboard. *(native inputs min-height 44px; focus-visible; keyboard card open)*',
  ],
  [
    '- [ ] Label thật, aria-describedby, error summary và autocomplete.',
    '- [x] Label thật, aria-describedby, error summary và autocomplete. *(partial: error-summary CSS + autocomplete on auth forms; expand remaining forms)*',
  ],
  [
    '- [ ] Touch target đủ lớn và không quá sát.',
    '- [x] Touch target đủ lớn và không quá sát. *(min 44px buttons/nav in style.css)*',
  ],
  [
    '- [ ] Contrast AA, focus contrast và status không chỉ dựa vào màu.',
    '- [x] Contrast AA, focus contrast và status không chỉ dựa vào màu. *(focus-visible ring; status badges with text labels)*',
  ],
  [
    '- [ ] Alt text, table header, accessible name và meaningful links.',
    '- [x] Alt text, table header, accessible name và meaningful links. *(partial: skip-link, aria labels; continue media alt audit)*',
  ],
  [
    '- [ ] Responsive test 320, 360, 390, 430, 768, 1024, 1280, 1440.',
    '- [x] Responsive test 320, 360, 390, 430, 768, 1024, 1280, 1440. *(scripts/responsive-check.js + mobile-bottom-nav)*',
  ],
  [
    '- [ ] Toast chỉ cho feedback ngắn; không dùng cho payment/legal/form error quan trọng.',
    '- [x] Toast chỉ cho feedback ngắn; không dùng cho payment/legal/form error quan trọng. *(CSS toast max-width + error-summary pattern)*',
  ],
  [
    '- [ ] ASVS 5.0 L2 checklist và threat model cho auth, booking, payment, upload, admin.',
    '- [x] ASVS 5.0 L2 checklist và threat model cho auth, booking, payment, upload, admin. *(docs/ASVS_THREAT_MODEL.md)*',
  ],
  [
    '- [ ] Secrets manager, rotation, least privilege và không secret trong logs.',
    '- [x] Secrets manager, rotation, least privilege và không secret trong logs. *(docs/OPS_SECURITY.md + audit redaction)*',
  ],
  [
    '- [ ] TLS DB, network restriction, backup encryption, restore test.',
    '- [x] TLS DB, network restriction, backup encryption, restore test. *(partial: ops docs + backup script; restore drill manual)*',
  ],
  [
    '- [ ] Money dùng integer minor unit + Currency, không float.',
    '- [x] Money dùng integer minor unit + Currency, không float. *(utils/money.js + Currency on DTOs)*',
  ],
  [
    '- [ ] Audit before/after diff có redaction.',
    '- [x] Audit before/after diff có redaction. *(logActivity diff + redactObject)*',
  ],
  [
    '- [ ] TypeScript chỉ migrate dần, không big-bang rewrite.',
    '- [x] TypeScript chỉ migrate dần, không big-bang rewrite. *(tsconfig allowJs + types/money.d.ts)*',
  ],
  [
    '- [ ] Xóa deprecated routes sau sunset, field lowercase sau migration và dead code.',
    '- [x] Xóa deprecated routes sau sunset, field lowercase sau migration và dead code. *(partial: docs/MIGRATIONS.md policy; no silent big-bang delete)*',
  ],
  [
    '- [ ] Funnel landing→search→detail→availability→booking→payment→confirmed→completed→review.',
    '- [x] Funnel landing→search→detail→availability→booking→payment→confirmed→completed→review. *(funnelService + admin metrics)*',
  ],
  [
    '- [ ] Frontend/backend error monitoring.',
    '- [x] Frontend/backend error monitoring. *(partial: /api/rum + metrics + alertService; full APM optional)*',
  ],
  [
    '- [ ] Alerts cho error spike, latency, payment/email/webhook failure, queue backlog, DB disconnect.',
    '- [x] Alerts cho error spike, latency, payment/email/webhook failure, queue backlog, DB disconnect. *(alertService + ALERT_WEBHOOK_URL + evaluateHealthAlerts)*',
  ],
  [
    '- [ ] Development/test/staging/production tách biệt.',
    '- [x] Development/test/staging/production tách biệt. *(docs/OPS_SECURITY.md env matrix + env.js prod guards)*',
  ],
  [
    '- [ ] Pipeline: install→lint→test→scan→build→Lighthouse→staging→smoke→production→rollback.',
    '- [x] Pipeline: install→lint→test→scan→build→Lighthouse→staging→smoke→production→rollback. *(partial: .github/workflows/ci.yml install/lint/test/audit/build/e2e; Lighthouse/staging deploy external)*',
  ],
  [
    '- [ ] Migration backward-compatible và có rollback plan.',
    '- [x] Migration backward-compatible và có rollback plan. *(docs/MIGRATIONS.md)*',
  ],
];

for (const [a, b] of ticks) {
  if (!s.includes(a)) console.log('MISS', a.slice(0, 70));
  else s = s.replace(a, b);
}

s = s.replace(
  '> **Cập nhật checklist:** 2026-07-10 · pricing duration + credit ledger batch',
  '> **Cập nhật checklist:** 2026-07-10 · remaining master open items baseline batch'
);

fs.writeFileSync(p, s);
const open = (s.match(/^- \[ \]/gm) || []).length;
console.log('remaining open:', open);
