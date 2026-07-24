'use strict';

/**
 * Sync public search filters to URL (back/forward friendly).
 * Works on pages with #search-filters form or data-search-form.
 */
(function () {
  function readParams() {
    return new URLSearchParams(window.location.search);
  }

  function writeParams(params, { replace = false } = {}) {
    const q = params.toString();
    const url = window.location.pathname + (q ? '?' + q : '');
    if (replace) history.replaceState({ search: q }, '', url);
    else history.pushState({ search: q }, '', url);
  }

  function formToParams(form) {
    const params = new URLSearchParams();
    const fd = new FormData(form);
    fd.forEach((v, k) => {
      if (v !== '' && v != null) params.set(k, String(v));
    });
    return params;
  }

  function applyParamsToForm(form, params) {
    params.forEach((v, k) => {
      const el = form.elements.namedItem(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = v === '1' || v === 'true';
      else el.value = v;
    });
  }

  async function runSearch(params) {
    const box = document.getElementById('search-results');
    const zero = document.getElementById('search-zero');
    if (!box) return;
    box.replaceChildren();
    if (zero) zero.classList.add('hidden');
    box.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-500', 'Đang tìm...'));
    try {
      const res = await fetch('/api/search?' + params.toString(), { credentials: 'same-origin' });
      const data = await res.json();
      box.replaceChildren();
      const items = data.items || data.branches || [];
      if (!items.length) {
        if (zero) {
          zero.classList.remove('hidden');
          const zr = data.zeroResult || {};
          const tips = zero.querySelector('[data-zero-tips]');
          if (tips) {
            tips.replaceChildren();
            (zr.tips || ['Thử nới bộ lọc hoặc đổi từ khóa.']).forEach((t) =>
              tips.appendChild(DomSafe.createTextElement('li', '', t))
            );
          }
          const cities = zero.querySelector('[data-zero-cities]');
          if (cities) {
            cities.replaceChildren();
            (zr.popularCities || []).forEach((c) => {
              const a = document.createElement('a');
              a.href = '/khong-gian/' + encodeURIComponent(c.citySlug);
              a.className =
                'text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-900 no-underline';
              a.textContent = (c.label || c.citySlug) + (c.count ? ` (${c.count})` : '');
              cities.appendChild(a);
            });
            (zr.nearbyDistricts || []).forEach((d) => {
              const a = document.createElement('a');
              a.href =
                '/khong-gian/' +
                encodeURIComponent(d.citySlug) +
                '/' +
                encodeURIComponent(d.districtSlug);
              a.className =
                'text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-amber-100 text-slate-700 no-underline';
              a.textContent = d.label;
              cities.appendChild(a);
            });
          }
          const actions = zero.querySelector('[data-zero-actions]');
          if (actions) {
            actions.replaceChildren();
            (zr.suggestedActions || []).forEach((act) => {
              if (act.href) {
                const a = document.createElement('a');
                a.href = act.href;
                a.className =
                  'text-xs font-black uppercase px-3 py-1.5 rounded-xl bg-teal-600 text-white no-underline';
                a.textContent = act.label || act.action;
                actions.appendChild(a);
              } else if (act.action === 'clear_filters') {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className =
                  'text-xs font-black uppercase px-3 py-1.5 rounded-xl border border-amber-300 text-amber-900 bg-white';
                btn.textContent = act.label || 'Xóa bộ lọc';
                btn.addEventListener('click', () => {
                  const form = document.querySelector('[data-search-form], #search-filters');
                  if (form) {
                    form.reset();
                    const p = new URLSearchParams();
                    writeParams(p, { replace: true });
                    runSearch(p);
                  } else {
                    window.location.href = '/search';
                  }
                });
                actions.appendChild(btn);
              } else if (act.action === 'expand_radius') {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className =
                  'text-xs font-black uppercase px-3 py-1.5 rounded-xl border border-amber-300 text-amber-900 bg-white';
                btn.textContent = act.label || 'Mở rộng bán kính';
                btn.addEventListener('click', () => {
                  const p = readParams();
                  const r = Number(p.get('radiusKm') || 10);
                  p.set('radiusKm', String(Math.min(100, r * 2 || 20)));
                  writeParams(p);
                  const form = document.querySelector('[data-search-form], #search-filters');
                  if (form) applyParamsToForm(form, p);
                  runSearch(p);
                });
                actions.appendChild(btn);
              }
            });
          }
        } else {
          box.appendChild(
            DomSafe.createTextElement('p', 'text-sm text-slate-400', 'Không có kết quả.')
          );
        }
        return;
      }
      items.forEach((b) => {
        const card = document.createElement('a');
        card.className =
          'block bg-white rounded-2xl border p-4 hover:shadow-lg transition text-inherit no-underline';
        const hrefCity = b.CitySlug || 'viet-nam';
        const hrefDist = b.DistrictSlug || 'khu-vuc';
        const slug = b.Slug || b._id;
        card.href = `/khong-gian/${hrefCity}/${hrefDist}/${slug}`;
        card.appendChild(DomSafe.createTextElement('h3', 'font-bold text-slate-800', b.Name || '—'));
        card.appendChild(
          DomSafe.createTextElement('p', 'text-sm text-slate-500 mt-1', b.Address || '')
        );
        if (b.distanceKm != null) {
          card.appendChild(
            DomSafe.createTextElement('p', 'text-xs text-teal-700 mt-1', b.distanceKm + ' km')
          );
        }
        if (b.priceFrom != null) {
          card.appendChild(
            DomSafe.createTextElement(
              'p',
              'text-sm font-black text-teal-700 mt-2',
              'Từ ' + Number(b.priceFrom).toLocaleString('vi-VN') + 'đ/giờ'
            )
          );
        }
        box.appendChild(card);
      });
    } catch (e) {
      box.replaceChildren();
      box.appendChild(DomSafe.createTextElement('p', 'text-sm text-red-600', e.message || 'Lỗi'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form =
      document.getElementById('search-filters') ||
      document.querySelector('[data-search-form]');
    if (!form) return;

    const params = readParams();
    applyParamsToForm(form, params);
    if ([...params.keys()].length) runSearch(params);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = formToParams(form);
      writeParams(p);
      runSearch(p);
    });

    // near me
    const nearBtn = document.getElementById('search-near-me');
    if (nearBtn && navigator.geolocation) {
      nearBtn.addEventListener('click', () => {
        nearBtn.disabled = true;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const p = formToParams(form);
            p.set('lat', String(pos.coords.latitude));
            p.set('lng', String(pos.coords.longitude));
            p.set('sort', 'near');
            if (!p.get('radiusKm')) p.set('radiusKm', '10');
            applyParamsToForm(form, p);
            writeParams(p);
            runSearch(p);
            nearBtn.disabled = false;
          },
          () => {
            nearBtn.disabled = false;
            alert('Không lấy được vị trí. Kiểm tra quyền trình duyệt.');
          },
          { enableHighAccuracy: false, timeout: 10000 }
        );
      });
    }

    window.addEventListener('popstate', () => {
      const p = readParams();
      applyParamsToForm(form, p);
      runSearch(p);
    });
  });
})();
