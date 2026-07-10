'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await WorkHubAPI.api('/api/host/onboarding');
    const data = await res.json();
    document.getElementById('ob-pct').textContent = (data.progress || 0) + '%';
    document.getElementById('ob-bar').style.width = (data.progress || 0) + '%';
    const list = document.getElementById('ob-steps');
    list.replaceChildren();
    (data.steps || []).forEach((s) => {
      const li = document.createElement('li');
      li.className =
        'flex items-center justify-between border rounded-2xl px-3 py-2 text-sm ' +
        (s.done ? 'bg-teal-50 border-teal-100' : 'bg-slate-50');
      li.appendChild(DomSafe.createTextElement('span', 'font-semibold', s.label));
      li.appendChild(
        DomSafe.createTextElement('span', 'text-xs font-black uppercase', s.done ? 'Done' : 'Todo')
      );
      list.appendChild(li);
    });
    if (data.nextStep) {
      document.getElementById('ob-next').textContent = 'Bước tiếp: ' + data.nextStep.label;
    } else {
      document.getElementById('ob-next').textContent = 'Hoàn tất onboarding 🎉';
    }
  } catch (e) {
    document.getElementById('ob-next').textContent = e.message || 'Lỗi tải checklist';
  }
});
