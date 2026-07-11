'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  function msg(text, ok) {
    const el = $('dev-msg');
    if (!el) return;
    el.textContent = text;
    el.className =
      'mb-4 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    el.classList.remove('hidden');
  }

  async function loadKeys() {
    const box = $('key-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/partner/keys', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const keys = data.keys || [];
    if (!keys.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có API key.'));
      return;
    }
    keys.forEach((k) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex flex-wrap justify-between gap-2 items-center';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          (k.Name || k.name || 'Key') + ' · ' + (k.Status || k.status || '')
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500 font-mono',
          (k.KeyPrefix || k.prefix || '') +
            ' · scopes ' +
            (k.Scopes || k.scopes || []).join(', ')
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-400',
          k.AllBranches || k.allBranches
            ? 'allBranches'
            : 'branches: ' + ((k.AllowedBranchIDs || k.allowedBranchIds || []).length || 0)
        )
      );
      li.appendChild(left);
      if ((k.Status || k.status) !== 'revoked') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-xs font-bold text-red-600';
        btn.textContent = 'Revoke';
        btn.addEventListener('click', async () => {
          if (!confirm('Thu hồi API key này?')) return;
          const r = await WorkHubAPI.api(`/api/partner/keys/${k._id || k.id}`, {
            method: 'DELETE',
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return msg(d.error || 'Revoke thất bại');
          msg('Đã revoke key', true);
          loadKeys();
        });
        li.appendChild(btn);
      }
      box.appendChild(li);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadKeys();

    $('key-create')?.addEventListener('click', async () => {
      const scopes = Array.from(document.querySelectorAll('.key-scope:checked')).map(
        (el) => el.value
      );
      const allBranches = !!$('key-all-branches')?.checked;
      const branchRaw = ($('key-branches')?.value || '').trim();
      const allowedBranchIds = branchRaw
        ? branchRaw
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const body = {
        name: ($('key-name')?.value || 'Partner key').trim(),
        scopes,
        allBranches,
      };
      if (!allBranches) body.allowedBranchIds = allowedBranchIds;
      const res = await WorkHubAPI.api('/api/partner/keys', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Tạo key thất bại');
      const secretEl = $('key-secret');
      if (secretEl) {
        secretEl.textContent =
          'SECRET (chỉ hiện 1 lần):\n' +
          (data.secret || '') +
          '\n\nPrefix: ' +
          (data.apiKey?.prefix || '') +
          '\n' +
          (data.warning || '');
        secretEl.classList.remove('hidden');
      }
      msg('Đã tạo API key — copy secret ngay.', true);
      loadKeys();
    });

    $('ical-rotate')?.addEventListener('click', async () => {
      const res = await WorkHubAPI.api('/api/host/ical/token', { method: 'POST', body: {} });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Rotate iCal thất bại');
      const el = $('ical-url');
      if (el) {
        el.textContent =
          (data.url || data.feedUrl || data.path || JSON.stringify(data, null, 2)) +
          (data.token ? '\n\nToken raw: ' + data.token : '');
      }
      msg('Đã rotate iCal token', true);
    });

    $('ical-revoke')?.addEventListener('click', async () => {
      if (!confirm('Thu hồi feed iCal?')) return;
      const res = await WorkHubAPI.api('/api/host/ical/token', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return msg(data.error || 'Revoke thất bại');
      const el = $('ical-url');
      if (el) el.textContent = 'Đã revoke — không còn feed public.';
      msg(data.message || 'Đã revoke iCal', true);
    });
  });
})();
