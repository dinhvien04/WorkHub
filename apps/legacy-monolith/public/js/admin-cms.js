'use strict';
document.getElementById('cms-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const res = await WorkHubAPI.api('/api/admin/cms', { method: 'POST', body });
  const data = await res.json();
  document.getElementById('cms-msg').textContent = res.ok
    ? `Saved: /huong-dan/${data.page?.Slug || body.Slug}`
    : data.error || 'Error';
});
