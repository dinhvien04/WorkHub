'use strict';

async function loadFavorites() {
  const list = document.getElementById('fav-list');
  const err = document.getElementById('fav-error');
  if (!list) return;
  err?.classList.add('hidden');
  DomSafe.clearElement(list);

  try {
    const res = await WorkHubAPI.api('/api/me/favorites');
    if (res.status === 401) {
      // Guest: show local favorites
      const local = JSON.parse(localStorage.getItem('guestFavorites') || '[]');
      if (!local.length) {
        list.appendChild(DomSafe.createTextElement('p', 'empty-state', 'Chưa có yêu thích. Đăng nhập để đồng bộ.'));
        return;
      }
      local.forEach((id) => {
        const card = DomSafe.createTextElement('div', 'bg-white border rounded-2xl p-4', `Branch ${id}`);
        list.appendChild(card);
      });
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || 'Lỗi tải yêu thích';
      err.classList.remove('hidden');
      return;
    }
    const items = data.favorites || [];
    if (!items.length) {
      list.appendChild(DomSafe.createTextElement('p', 'empty-state', 'Chưa lưu cơ sở nào.'));
      return;
    }
    items.forEach((f) => {
      const b = f.BranchID || {};
      const card = document.createElement('a');
      card.href = b.Slug
        ? `/khong-gian/${b.CitySlug || 'viet-nam'}/${b.DistrictSlug || 'khu-vuc'}/${b.Slug}`
        : `/detail?branchId=${b._id || f.BranchID}`;
      card.className = 'bg-white border rounded-2xl p-4 hover:shadow-md transition block';
      card.appendChild(DomSafe.createTextElement('h3', 'font-bold text-slate-800', b.Name || 'Cơ sở'));
      card.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-500 mt-1', b.Address || ''));
      card.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-amber-600 mt-2 font-semibold', `★ ${b.RatingAvg || 0}`)
      );
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'mt-3 text-xs font-bold text-rose-600';
      rm.textContent = 'Bỏ lưu';
      rm.addEventListener('click', async (e) => {
        e.preventDefault();
        await WorkHubAPI.api(`/api/me/favorites/${b._id || f.BranchID}`, { method: 'DELETE' });
        loadFavorites();
      });
      card.appendChild(rm);
      list.appendChild(card);
    });
  } catch {
    if (err) {
      err.textContent = 'Lỗi kết nối';
      err.classList.remove('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', loadFavorites);

// Helper for other pages
window.toggleFavorite = async function toggleFavorite(branchId) {
  if (!branchId) return;
  try {
    const res = await WorkHubAPI.api('/api/me/favorites', {
      method: 'POST',
      body: { branchId },
    });
    if (res.status === 401) {
      const local = JSON.parse(localStorage.getItem('guestFavorites') || '[]');
      if (!local.includes(branchId)) local.push(branchId);
      localStorage.setItem('guestFavorites', JSON.stringify(local.slice(0, 50)));
      alert('Đã lưu tạm (guest). Đăng nhập để đồng bộ.');
      return;
    }
    if (res.status === 409) {
      await WorkHubAPI.api(`/api/me/favorites/${branchId}`, { method: 'DELETE' });
      alert('Đã bỏ yêu thích');
      return;
    }
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || 'Không lưu được');
      return;
    }
    alert('Đã thêm yêu thích');
  } catch {
    alert('Lỗi kết nối');
  }
};
