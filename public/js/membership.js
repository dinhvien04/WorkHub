'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const plansEl = document.getElementById('mem-plans');
  const curEl = document.getElementById('mem-current');
  try {
    const pRes = await fetch('/api/membership/plans');
    const pData = await pRes.json();
    (pData.plans || []).forEach((p) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-3xl p-5';
      card.appendChild(DomSafe.createTextElement('h3', 'font-black text-lg', p.Name));
      card.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-teal-700 font-bold mt-2',
          `${Number(p.MonthlyPrice).toLocaleString('vi-VN')}đ/tháng`
        )
      );
      card.appendChild(
        DomSafe.createTextElement('p', 'text-sm text-slate-500 mt-1', `${p.IncludedHours || 0} giờ · giảm ${p.DiscountPercent || 0}%`)
      );
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary w-full mt-4';
      btn.textContent = 'Đăng ký';
      btn.addEventListener('click', async () => {
        const res = await WorkHubAPI.api('/api/membership/subscribe', {
          method: 'POST',
          body: { planCode: p.Code },
        });
        const d = await res.json();
        alert(res.ok ? 'Đã đăng ký membership' : d.error || 'Lỗi');
        if (res.ok) location.reload();
      });
      card.appendChild(btn);
      plansEl.appendChild(card);
    });

    const mRes = await WorkHubAPI.api('/api/membership/me', { redirectOn401: false });
    if (mRes.ok) {
      const mData = await mRes.json();
      if (mData.membership) {
        curEl.appendChild(
          DomSafe.createTextElement(
            'div',
            'bg-teal-50 border border-teal-100 rounded-2xl p-4 text-sm',
            `Đang active · còn ${mData.membership.CreditsRemaining || 0} giờ · hết hạn ${new Date(mData.membership.EndsAt).toLocaleDateString('vi-VN')}`
          )
        );
      }
    }
  } catch (e) {
    console.error(e);
  }
});
