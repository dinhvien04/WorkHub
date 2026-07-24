'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('compare-grid');
  if (!grid) return;
  const ids = JSON.parse(localStorage.getItem('compareIds') || '[]').slice(0, 3);
  if (!ids.length) {
    grid.appendChild(DomSafe.createTextElement('p', 'empty-state', 'Chưa chọn địa điểm để so sánh.'));
    return;
  }
  for (const id of ids) {
    const res = await fetch(`/api/search?limit=1`); // fallback card by id via detail page link
    const card = document.createElement('div');
    card.className = 'bg-white border rounded-2xl p-4';
    card.appendChild(DomSafe.createTextElement('h3', 'font-bold', 'Branch'));
    const a = document.createElement('a');
    a.href = `/detail?branchId=${id}`;
    a.className = 'text-teal-700 text-sm font-bold';
    a.textContent = 'Xem chi tiết';
    card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400 mb-2', id));
    card.appendChild(a);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'block mt-3 text-xs text-rose-600 font-bold';
    rm.textContent = 'Gỡ';
    rm.addEventListener('click', () => {
      const next = ids.filter((x) => x !== id);
      localStorage.setItem('compareIds', JSON.stringify(next));
      location.reload();
    });
    card.appendChild(rm);
    grid.appendChild(card);
  }
});
window.addToCompare = function (branchId) {
  const ids = JSON.parse(localStorage.getItem('compareIds') || '[]');
  if (!ids.includes(branchId) && ids.length < 3) ids.push(branchId);
  localStorage.setItem('compareIds', JSON.stringify(ids));
  alert('Đã thêm vào so sánh (' + ids.length + '/3)');
};
