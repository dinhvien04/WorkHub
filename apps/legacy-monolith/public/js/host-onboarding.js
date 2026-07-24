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
        'flex flex-wrap items-center justify-between gap-2 border rounded-2xl px-3 py-2 text-sm ' +
        (s.done ? 'bg-teal-50 border-teal-100' : 'bg-slate-50');
      const left = document.createElement('div');
      left.className = 'flex items-center gap-2 min-w-0';
      left.appendChild(
        DomSafe.createTextElement('span', '', s.done ? '✅' : '⬜')
      );
      left.appendChild(DomSafe.createTextElement('span', 'font-semibold', s.label));
      li.appendChild(left);
      const right = document.createElement('div');
      right.className = 'flex items-center gap-2';
      right.appendChild(
        DomSafe.createTextElement(
          'span',
          'text-xs font-black uppercase ' + (s.done ? 'text-teal-700' : 'text-slate-400'),
          s.done ? 'Done' : 'Todo'
        )
      );
      if (!s.done && s.href) {
        const a = document.createElement('a');
        a.href = s.href;
        a.className =
          'text-[10px] font-black uppercase bg-teal-600 text-white px-2.5 py-1.5 rounded-lg no-underline';
        a.textContent = s.cta || 'Tiếp';
        right.appendChild(a);
      }
      li.appendChild(right);
      list.appendChild(li);
    });
    const next = document.getElementById('ob-next');
    if (data.nextStep) {
      next.textContent = 'Bước tiếp: ' + data.nextStep.label;
      const cta = document.getElementById('ob-next-cta');
      if (cta && data.nextStep.href) {
        cta.href = data.nextStep.href;
        cta.textContent = data.nextStep.cta || 'Tiếp tục';
        cta.classList.remove('hidden');
      }
    } else {
      next.textContent = 'Hoàn tất onboarding 🎉';
    }
    if (data.stats) {
      const st = document.getElementById('ob-stats');
      if (st) {
        st.textContent = `Chi nhánh: ${data.stats.branchCount} · Spaces: ${data.stats.spaceCount} · Available: ${data.stats.publishedSpaces}`;
      }
    }
  } catch (e) {
    document.getElementById('ob-next').textContent = e.message || 'Lỗi tải checklist';
  }
});
