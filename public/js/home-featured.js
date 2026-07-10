'use strict';

/**
 * Progressive enhance homepage with live featured API (newest strip).
 */
document.addEventListener('DOMContentLoaded', async () => {
  const strip = document.getElementById('home-newest');
  if (!strip) return;
  try {
    const res = await fetch('/api/featured?limit=8&newLimit=6', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) return;
    const items = data.newest || [];
    if (!items.length) return;
    strip.classList.remove('hidden');
    const list = strip.querySelector('[data-newest-list]');
    if (!list) return;
    list.replaceChildren();
    items.forEach((b) => {
      const a = document.createElement('a');
      const city = b.CitySlug || 'viet-nam';
      const dist = b.DistrictSlug || 'khu-vuc';
      const slug = b.Slug || b._id;
      a.href = `/khong-gian/${city}/${dist}/${slug}`;
      a.className =
        'bg-white border rounded-2xl p-3 block hover:shadow-md no-underline text-inherit min-w-[200px]';
      a.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm', b.Name || '—'));
      a.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-slate-500 mt-1', b.City || b.Address || '')
      );
      list.appendChild(a);
    });
  } catch {
    /* ignore */
  }
});
