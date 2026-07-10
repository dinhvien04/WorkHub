# People-first content plan (SEO)

CMS pages (seed via admin CMS or `scripts/seedContentPages.js`):

| Slug | Intent |
|------|--------|
| `huong-dan-chon-phong-hop` | Hướng dẫn chọn phòng họp theo số người, thiết bị |
| `to-chuc-workshop-coworking` | Tổ chức workshop tại co-working |
| `bang-gia-thue-van-phong` | Giá thuê / so sánh gói |
| `remote-work-viet-nam` | Remote work, hybrid |
| `local-guide-quan-cafe-lam-viec` | Local guide (city pages link in) |

## Ops monitoring (not fully automated in-app)

- Google Search Console: property = `PUBLIC_BASE_URL`
- Submit `/sitemap.xml`; inspect key URLs after deploy
- Core Web Vitals via CrUX / PageSpeed; RUM beacon `/api/rum`
- Rich results: validate JSON-LD on listing/host pages

In-app: robots.txt, sitemap, canonical, Open Graph baselines already ship.
