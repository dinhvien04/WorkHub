'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const el = document.getElementById('health-json');
  try {
    const res = await WorkHubAPI.api('/api/admin/system-health');
    const data = await res.json();
    el.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el.textContent = e.message || 'Lỗi';
  }
});
