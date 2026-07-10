// =======================================================
// QUẢN LÝ CƠ SỞ & KHÔNG GIAN (HOST SPACES)
// =======================================================

// --- BIẾN TOÀN CỤC ---
var addFacilityDraft = { imageFile: null, spaces: [] };
var wizardSpaceFiles = {}; 
var addFacilitySpaceCounter = 0;
var currentBranchId = null;
var currentSpaceId = null;

var selectedBranchFiles = [];
var selectedSpaceFiles = [];

var SPACE_STATUS_LABELS = {
    available: "Sẵn sàng",
    maintenance: "Bảo trì",
    inactive: "Tạm ngừng hoạt động",
    ready: "Sẵn sàng",
    preparing: "Đang chuẩn bị",
    occupied: "Có khách",
    suspended: "Tạm ngừng hoạt động"
};

var CATEGORY_LABELS = {
    meeting_room: "Phòng họp",
    desk: "Chỗ ngồi tự do",
    office: "Văn phòng",
    event: "Sự kiện",
    "Phòng họp": "Phòng họp",
    "Chỗ ngồi tự do": "Chỗ ngồi tự do"
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function applyImg(id, src) {
    const el = document.getElementById(id);
    if (!el) return;
    if (src) {
      el.src = src;
      el.classList.remove("hidden");
    } else {
      el.src = "";
      el.classList.add("hidden");
    }
}

// ==========================================
// --- ĐIỀU HƯỚNG MÀN HÌNH LAYER ---
// ==========================================
function showHostSpaceLayer(layerId) {
    ['space-mgr-layer-1', 'space-mgr-layer-2', 'space-mgr-layer-3', 'space-mgr-layer-add'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== layerId);
    });
}

function backToLayer1() {
    currentBranchId = null;
    showHostSpaceLayer('space-mgr-layer-1');
    initHostSpacesPage();
}

function backToLayer2() {
    currentSpaceId = null;
    showHostSpaceLayer('space-mgr-layer-2');
    if (currentBranchId) loadSpaceList(currentBranchId);
}

// ==================== LAYER 1: TẢI DANH SÁCH CƠ SỞ ====================
async function initHostSpacesPage() {
    const token = localStorage.getItem('token');
    if (!token) {
        if(typeof showToast === 'function') showToast("Vui lòng đăng nhập để xem dữ liệu");
        return;
    }
    
    try {
        const res = await fetch('/api/hosts/branches', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if(!res.ok) throw new Error("Lỗi xác thực");
        const data = await res.json();
        renderFacilityList(data.branches || []);
    } catch (err) {
        console.error("Lỗi tải danh sách cơ sở:", err);
    }
}

function renderFacilityList(branches) {
    const grid = document.getElementById('facility-list-grid');
    if (!grid) return;

    if (!branches || !branches.length) {
        grid.innerHTML = '<p class="text-slate-400 text-sm col-span-2">Chưa có cơ sở nào. Bấm "Thêm cơ sở" để bắt đầu.</p>';
        return;
    }

    grid.innerHTML = branches.map(b => {
        const imgHtml = b.Images && b.Images.length > 0
            ? `<img src="${escapeHtml(b.Images[0])}" alt="" class="w-full h-full object-cover group-hover:scale-110 transition duration-500">`
            : `<div class="w-full h-full bg-slate-100 flex items-center justify-center"><span class="text-slate-300 text-xs font-bold uppercase">Chưa có ảnh</span></div>`;

        return `
            <div onclick="openFacilityMgmt('${escapeHtml(b._id)}')" class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-teal-500 transition cursor-pointer group">
                <div class="relative h-40 mb-6 rounded-2xl overflow-hidden shadow-inner">
                    ${imgHtml}
                </div>
                <h3 class="text-xl font-black text-slate-800 tracking-tight">${escapeHtml(b.Name)}</h3>
                <p class="text-sm text-slate-400">${escapeHtml(b.Address)}</p>
            </div>`;
    }).join('');
}

// ==================== LAYER 2: THÔNG TIN CƠ SỞ & KHÔNG GIAN ====================
async function openFacilityMgmt(branchId) {
    currentBranchId = branchId;
    showHostSpaceLayer('space-mgr-layer-2');
    
    selectedBranchFiles = [];
    const fileInput = document.getElementById("branch-img-input");
    if (fileInput) fileInput.value = "";
    const previewContainer = document.getElementById("branch-selected-preview-container");
    if (previewContainer) previewContainer.innerHTML = "";

    const token = localStorage.getItem('token');
    try {
        const branchRes = await fetch('/api/hosts/branches', { headers: { 'Authorization': `Bearer ${token}` } });
        const branchData = await branchRes.json();
        const branch = (branchData.branches || []).find(b => String(b._id) === String(branchId));

        if (branch) {
            const nameEl = document.querySelector('#space-mgr-layer-2 [data-fac-field="name"]');
            const addrEl = document.querySelector('#space-mgr-layer-2 [data-fac-field="address"]');
            const noteEl = document.querySelector('#space-mgr-layer-2 [data-fac-field="note"]');
            if (nameEl) nameEl.value = branch.Name || "";
            if (addrEl) addrEl.value = branch.Address || "";
            if (noteEl) noteEl.value = branch.Description || "";
            
            const mainImgContainer = document.getElementById("branch-main-img-container") || document.getElementById("branch-main-img");
            if (mainImgContainer) {
                if (branch.Images && branch.Images.length > 0) {
                    mainImgContainer.innerHTML = branch.Images.map(img => `
                        <div class="relative w-20 h-20 inline-block group mr-2">
                            <img src="${img}" class="w-full h-full object-cover rounded-xl border shadow-sm">
                            <button type="button" onclick="deleteExistingBranchImage('${img}')" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold shadow hover:bg-red-600 transition">✕</button>
                        </div>
                    `).join("");
                } else {
                    mainImgContainer.innerHTML = `<span class="text-[10px] text-slate-400 uppercase p-4">Chưa có ảnh hiển thị</span>`;
                }
            }
        }
        loadSpaceList(branchId);
    } catch (err) {
        console.error("Lỗi tải thông tin chi nhánh:", err);
    }
}

async function deleteExistingBranchImage(imgUrl) {
    if (!confirm("Bạn có chắc muốn xóa tấm ảnh này khỏi hệ thống?")) return;
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/hosts/branches/${currentBranchId}/delete-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ imageUrl: imgUrl }),
        });
        if (response.ok) {
            if(typeof showToast === 'function') showToast("Xóa ảnh thành công!");
            openFacilityMgmt(currentBranchId);
        }
    } catch (error) { console.error("Lỗi xóa ảnh cũ:", error); }
}

function previewBranchImagesFromInput(input) {
    if (input.files && input.files.length > 0) {
        selectedBranchFiles = [...selectedBranchFiles, ...Array.from(input.files)];
    }
    if (input) input.value = ""; 
    renderBranchSelectedPreviews();
}

function renderBranchSelectedPreviews() {
    const container = document.getElementById("branch-selected-preview-container");
    if (!container) return;
    container.innerHTML = selectedBranchFiles.map((file, index) => `
        <div class="relative w-20 h-20 inline-block mt-2 mr-2">
            <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover rounded-xl border border-teal-400">
            <button type="button" onclick="removeSelectedBranchFile(${index})" class="absolute -top-1.5 -right-1.5 bg-slate-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold hover:bg-red-500 transition">✕</button>
        </div>
    `).join("");
}

function removeSelectedBranchFile(index) {
    selectedBranchFiles.splice(index, 1);
    renderBranchSelectedPreviews();
}

async function saveBranchInfo() {
    const nameEl = document.querySelector('[data-fac-field="name"]');
    const addrEl = document.querySelector('[data-fac-field="address"]');
    const noteEl = document.querySelector('[data-fac-field="note"]');
    
    const name = nameEl?.value.trim();
    const address = addrEl?.value.trim();
    if (!name || !address) {
        if(typeof showToast === 'function') showToast("Tên cơ sở và địa chỉ không được để trống.");
        return;
    }
    
    const formData = new FormData();
    formData.append("name", name);
    formData.append("address", address);
    formData.append("note", noteEl?.value.trim() || "");
    
    if (selectedBranchFiles.length > 0) {
        selectedBranchFiles.forEach((file) => formData.append("image", file));
    }
    
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`/api/hosts/branches/${currentBranchId}`, {
            method: "PUT",
            headers: { 'Authorization': `Bearer ${token}` }, 
            body: formData,
        });
        
        const data = await res.json();
        if (!res.ok) {
            if(typeof showToast === 'function') showToast(data.error || "Cập nhật thất bại.");
            return;
        }
    
        if(typeof showToast === 'function') showToast("Cập nhật cơ sở thành công!");
        selectedBranchFiles = [];
        openFacilityMgmt(currentBranchId);
    } catch (err) {
        console.error("Lỗi cập nhật cơ sở:", err);
    }
}

// ==================== KHÔNG GIAN BÊN TRONG CƠ SỞ (LAYER 2) ====================
async function loadSpaceList(branchId) {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/hosts/branches/${branchId}/spaces`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        renderSpacesList(data.spaces || []);
    } catch (error) { console.error("Lỗi tải danh sách phòng:", error); }
}

function renderSpacesList(spaces) {
    const tbody = document.getElementById('spaces-list-body');
    if (!tbody) return;

    if (!spaces.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-slate-400 text-sm text-center">Chưa có không gian nào.</td></tr>';
        return;
    }

    tbody.innerHTML = spaces.map(s => {
        const statusLabel = SPACE_STATUS_LABELS[s.Status] || s.Status;
        const catLabel = CATEGORY_LABELS[s.Category] || s.Category;
        const statusColor = s.Status === "available" || s.Status === "ready"
            ? "bg-green-50 text-green-600"
            : s.Status === "maintenance" || s.Status === "preparing"
            ? "bg-yellow-50 text-yellow-600"
            : "bg-red-50 text-red-500";
            
        const spaceStr = encodeURIComponent(JSON.stringify(s));
        return `
            <tr class="border-b border-slate-50 hover:bg-slate-50 transition">
                <td class="p-4 font-black text-slate-700">${escapeHtml(s.SpaceCode || s.Name)}</td>
                <td class="p-4 text-slate-500">${escapeHtml(catLabel)}</td>
                <td class="p-4"><span class="px-2 py-1 rounded-lg text-[9px] uppercase font-black ${statusColor}">${escapeHtml(statusLabel)}</span></td>
                <td class="p-4"><button type="button" onclick="openLayer3('${spaceStr}')" class="text-teal-600 underline font-black text-xs">Chi tiết</button></td>
            </tr>`;
    }).join('');
}

// ==================== LAYER 3: CHI TIẾT KHÔNG GIAN ====================
function openLayer3(encodedSpace) {
    const space = JSON.parse(decodeURIComponent(encodedSpace));
    currentSpaceId = space._id;
    selectedSpaceFiles = []; 
  
    showHostSpaceLayer("space-mgr-layer-3");
  
    const titleEl = document.getElementById("detail-space-title");
    if (titleEl) titleEl.innerText = `Chi tiết: ${space.Name} [${space.SpaceCode}]`;
    document.getElementById("detail-space-price").value = space.PricePerHour;
    document.getElementById("detail-space-status").value = space.Status;
  
    const spaceInput = document.getElementById("space-img-input");
    if (spaceInput) spaceInput.value = "";
  
    renderSpaceImages(space);
    document.getElementById("space-detail-new-preview").innerHTML = "";
    loadSpaceBookings(space._id);
}

function renderSpaceImages(space) {
    const container = document.getElementById("space-detail-img-container");
    if (!container) return;
  
    if (space.Images && space.Images.length > 0) {
      container.innerHTML = space.Images.map(img => `
        <div class="relative w-20 h-20 inline-block mr-2 mb-2">
          <img src="${img}" class="w-full h-full object-cover rounded-xl border shadow-sm">
          <button type="button" onclick="deleteExistingSpaceImage('${img}')" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold shadow hover:bg-red-600">✕</button>
        </div>
      `).join("");
    } else {
      container.innerHTML = `<span class="text-[10px] text-slate-400 uppercase p-4">Chưa có ảnh hiển thị</span>`;
    }
}

async function deleteExistingSpaceImage(imgUrl) {
    if (!confirm("Xóa ảnh này khỏi phòng?")) return;
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/hosts/spaces/${currentSpaceId}/delete-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ imageUrl: imgUrl }),
        });
        const data = await response.json();
        if (response.ok) {
            if(typeof showToast === 'function') showToast("Xóa ảnh thành công!");
            openLayer3(encodeURIComponent(JSON.stringify(data.space)));
        } else alert(data.error || "Lỗi khi xóa ảnh phòng.");
    } catch (error) { console.error("Lỗi xóa ảnh phòng cũ:", error); }
}

function previewNewSpaceDetailImages(input) {
    if (input.files && input.files.length > 0) selectedSpaceFiles = [...selectedSpaceFiles, ...Array.from(input.files)];
    if (input) input.value = ""; 
    renderSpaceSelectedPreviews();
}

function renderSpaceSelectedPreviews() {
    const previewDiv = document.getElementById("space-detail-new-preview");
    if (!previewDiv) return;
    previewDiv.innerHTML = selectedSpaceFiles.map((file, index) => `
        <div class="relative w-20 h-20 inline-block mr-2 mb-2">
            <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover rounded-xl border border-teal-400">
            <button type="button" onclick="removeSelectedSpaceFile(${index})" class="absolute -top-1.5 -right-1.5 bg-slate-600 text-white w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold hover:bg-red-500">✕</button>
        </div>
    `).join("");
}

function removeSelectedSpaceFile(index) {
    selectedSpaceFiles.splice(index, 1);
    renderSpaceSelectedPreviews();
}

async function saveSpaceDetail() {
    if (!currentSpaceId) return;
    const pricePerHour = document.getElementById("detail-space-price").value;
    const status = document.getElementById("detail-space-status").value;
  
    const formData = new FormData();
    formData.append("pricePerHour", String(pricePerHour).replace(/\D/g, ""));
    formData.append("status", status);
  
    if (selectedSpaceFiles && selectedSpaceFiles.length > 0) {
      selectedSpaceFiles.forEach((file) => formData.append("image", file));
    }
  
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/hosts/spaces/${currentSpaceId}`, {
            method: "PUT",
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });
        const data = await response.json();
        if (response.ok) {
            if(typeof showToast === 'function') showToast("Cập nhật chi tiết không gian thành công!");
            selectedSpaceFiles = [];
            openLayer3(encodeURIComponent(JSON.stringify(data.space)));
        } else {
            if(typeof showToast === 'function') showToast(data.error || "Có lỗi xảy ra.");
        }
    } catch (error) { console.error("Lỗi cập nhật phòng:", error); }
}

async function loadSpaceBookings(spaceId) {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/hosts/bookings`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        const tbody = document.getElementById("space-schedule-body");
        tbody.innerHTML = "";
  
        const filtered = (data.bookings || []).filter((b) => b.SpaceID && b.SpaceID._id === spaceId);
  
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 text-sm">Chưa có lịch đặt nào.</td></tr>`;
            return;
        }
  
        filtered.forEach((booking) => {
            const start = new Date(booking.StartTime).toLocaleString("vi-VN");
            const end = new Date(booking.EndTime).toLocaleString("vi-VN");
            const statusLabel = SPACE_STATUS_LABELS[booking.Status] || booking.Status;
            tbody.innerHTML += `
                <tr class="border-b font-medium text-slate-700 hover:bg-slate-50 text-sm">
                    <td class="p-4">
                        <div class="font-bold">${booking.CustomerID?.FullName || "Ẩn danh"}</div>
                        <div class="text-[10px] text-slate-400">${booking.CustomerID?.Email || ""}</div>
                    </td>
                    <td class="p-4">${start}</td>
                    <td class="p-4">${end}</td>
                    <td class="p-4 uppercase font-bold text-[10px] text-teal-600">${statusLabel}</td>
                </tr>
            `;
        });
    } catch (error) { console.error(error); }
}

// ==================== TẠO MỚI CƠ SỞ (WIZARD CỦA BẠN - GIAO DIỆN HEAD) ====================
function startAddFacility() {
    addFacilityDraft = { imageFile: null, spaces: [] };
    wizardSpaceFiles = {};
    addFacilitySpaceCounter = 0;
    document.getElementById('add-fac-name').value = '';
    document.getElementById('add-fac-address').value = '';
    document.getElementById('add-fac-note').value = '';
    const imgInput = document.getElementById('add-fac-image');
    if (imgInput) imgInput.value = '';
    const preview = document.getElementById('add-fac-image-preview');
    if (preview) preview.innerHTML = '<span class="text-[10px] font-bold text-slate-400 uppercase">Chưa có ảnh</span>';
    setAddFacilityStep(1);
    showHostSpaceLayer('space-mgr-layer-add');
}

function cancelAddFacility() {
    showHostSpaceLayer('space-mgr-layer-1');
}

function setAddFacilityStep(step) {
    const s1 = document.getElementById('add-facility-step-1');
    const s2 = document.getElementById('add-facility-step-2');
    const label = document.getElementById('add-facility-step-label');
    const b1 = document.getElementById('add-fac-step-1-badge');
    const b2 = document.getElementById('add-fac-step-2-badge');
    if (!s1 || !s2) return;
    s1.classList.toggle('hidden', step !== 1);
    s2.classList.toggle('hidden', step !== 2);
    if (label) {
        label.textContent = step === 1 ? 'Giai đoạn 1: Nhập thông tin cơ sở' : 'Giai đoạn 2: Nhập các không gian';
    }
    if (b1 && b2) {
        b1.className = step === 1 ? 'px-4 py-2 rounded-xl bg-teal-600 text-white' : 'px-4 py-2 rounded-xl bg-slate-100 text-slate-400';
        b2.className = step === 2 ? 'px-4 py-2 rounded-xl bg-teal-600 text-white' : 'px-4 py-2 rounded-xl bg-slate-100 text-slate-400';
    }
}

function previewFacilityImage(input) {
    const file = input.files && input.files[0];
    const preview = document.getElementById('add-fac-image-preview');
    if (!file || !preview) return;
    addFacilityDraft.imageFile = file; 
    const reader = new FileReader();
    reader.onload = e => {
        preview.innerHTML = `<img src="${e.target.result}" alt="" class="w-full h-full object-cover">`;
    };
    reader.readAsDataURL(file);
}

function previewSpaceImage(input, rowId) {
    const file = input.files && input.files[0];
    const preview = document.getElementById(`space-img-preview-${rowId}`);
    if (!file || !preview) return;
    wizardSpaceFiles[rowId] = file; 
    const reader = new FileReader();
    reader.onload = e => {
        preview.innerHTML = `<img src="${e.target.result}" alt="" class="w-full h-full object-cover">`;
    };
    reader.readAsDataURL(file);
}

function addFacilityGoStep2() {
    const name = document.getElementById('add-fac-name')?.value.trim();
    const address = document.getElementById('add-fac-address')?.value.trim();
    if (!name || !address) {
        if(typeof showToast === 'function') showToast('Vui lòng nhập Tên cơ sở và Địa chỉ');
        else alert('Vui lòng nhập Tên cơ sở và Địa chỉ');
        return;
    }
    document.getElementById('add-fac-summary-name').textContent = name;
    document.getElementById('add-fac-summary-address').textContent = address;
    setAddFacilityStep(2);
    const list = document.getElementById('add-facility-spaces-list');
    if (list && !list.children.length) addFacilitySpaceRow();
}

function addFacilityBackToStep1() {
    setAddFacilityStep(1);
}

function addFacilitySpaceRow() {
    const list = document.getElementById('add-facility-spaces-list');
    if (!list) return;
    const rowId = ++addFacilitySpaceCounter;
    const card = document.createElement('div');
    card.className = 'p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4';
    card.dataset.rowId = String(rowId);
    card.innerHTML = `
        <div class="flex justify-between items-center">
            <p class="text-[10px] font-black text-slate-400 uppercase">Không gian #${rowId}</p>
            <button type="button" onclick="removeFacilitySpaceRow(${rowId})" class="text-red-500 text-[10px] font-black uppercase hover:text-red-700">Xóa</button>
        </div>
        <div class="flex flex-wrap gap-3 items-start">
            <div id="space-img-preview-${rowId}" class="h-20 w-28 bg-white rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center shrink-0">
                <span class="text-[9px] font-bold text-slate-400 uppercase">Ảnh</span>
            </div>
            <label class="h-20 w-28 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 font-bold text-[9px] uppercase cursor-pointer hover:border-teal-500 transition shrink-0">
                + Ảnh
                <input type="file" accept="image/*" class="hidden" onchange="previewSpaceImage(this, ${rowId})">
            </label>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
            <div class="p-3 bg-white rounded-xl border border-slate-100">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Tên / Mã <span class="text-red-500">*</span></label>
                <input type="text" data-field="id" placeholder="VD: 103, A-05" class="w-full bg-transparent border-none p-0 text-sm font-bold outline-none text-slate-800 space-code-input">
            </div>
            <div class="p-3 bg-white rounded-xl border border-slate-100">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Loại</label>
                <select data-field="type" class="w-full bg-transparent border-none p-0 text-sm font-bold outline-none text-slate-800 space-type-input">
                    <option value="Phòng họp">Phòng họp</option>
                    <option value="Chỗ ngồi tự do">Chỗ ngồi tự do</option>
                </select>
            </div>
            <div class="p-3 bg-white rounded-xl border border-slate-100">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Giá niêm yết / Giờ</label>
                <input type="text" data-field="price" placeholder="250000" class="w-full bg-transparent border-none p-0 text-sm font-bold outline-none text-teal-600 space-price-input">
            </div>
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <label class="block text-[10px] font-black text-slate-400 uppercase mb-1">Trạng thái</label>
                <select data-field="status" class="w-full bg-transparent border-none p-0 text-sm font-bold outline-none text-slate-800">
                    <option value="ready">Sẵn sàng</option>
                    <option value="preparing">Đang chuẩn bị</option>
                    <option value="occupied">Có khách</option>
                    <option value="suspended">Tạm ngừng hoạt động</option>
                </select>
            </div>
        </div>`;
    list.appendChild(card);
}

function removeFacilitySpaceRow(rowId) {
    const list = document.getElementById('add-facility-spaces-list');
    const card = list?.querySelector(`[data-row-id="${rowId}"]`);
    if (card) card.remove();
    delete wizardSpaceFiles[rowId];
    if (list && !list.children.length) addFacilitySpaceRow();
}

function formatPriceDisplay(raw) {
    const num = String(raw || '').replace(/\D/g, '');
    if (!num) return '0';
    return num;
}

async function saveNewFacility() {
    const name = document.getElementById('add-fac-name')?.value.trim();
    const address = document.getElementById('add-fac-address')?.value.trim();
    const note = document.getElementById('add-fac-note')?.value.trim();
    const token = localStorage.getItem('token');

    if (!name || !address) {
        if(typeof showToast === 'function') showToast('Thiếu thông tin cơ sở');
        setAddFacilityStep(1);
        return;
    }
    
    const formData = new FormData();
    formData.append("name", name);
    formData.append("address", address);
    formData.append("note", note || "");
    if (addFacilityDraft.imageFile) {
        formData.append("image", addFacilityDraft.imageFile);
    }

    try {
        const resBranch = await fetch('/api/hosts/branches', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const branchData = await resBranch.json();
        
        if (!resBranch.ok) {
            if(typeof showToast === 'function') showToast(branchData.error || 'Lỗi khi tạo cơ sở');
            return;
        }

        const list = document.getElementById('add-facility-spaces-list');
        const cards = list.querySelectorAll('[data-row-id]');
        let spacesCount = 0;

        for (let card of cards) {
            const rowId = card.dataset.rowId;
            const code = card.querySelector('[data-field="id"]')?.value.trim();
            if (!code) continue;

            const type = card.querySelector('[data-field="type"]')?.value || 'Phòng họp';
            const status = card.querySelector('[data-field="status"]')?.value || 'ready';
            const price = formatPriceDisplay(card.querySelector('[data-field="price"]')?.value);
            
            const spForm = new FormData();
            spForm.append("id", code);
            spForm.append("name", code);
            spForm.append("type", type);
            spForm.append("price", price);
            spForm.append("status", status);
            
            if (wizardSpaceFiles[rowId]) {
                spForm.append("image", wizardSpaceFiles[rowId]);
            }

            await fetch(`/api/hosts/branches/${branchData._id}/spaces`, {
                method: "POST",
                headers: { 'Authorization': `Bearer ${token}` },
                body: spForm,
            });
            spacesCount++;
        }

        if(typeof showToast === 'function') showToast(`Đã tạo cơ sở "${name}" với ${spacesCount} không gian`);
        
        showHostSpaceLayer('space-mgr-layer-1');
        await initHostSpacesPage();

    } catch (err) {
        console.error('Lỗi lưu cơ sở mới:', err);
        if(typeof showToast === 'function') showToast('Lỗi khi lưu, vui lòng thử lại.');
    }
}


// =======================================================
// LOGIC ĐIỀU KHIỂN BẢNG ĐƠN ĐẶT CHỖ (HOST BOOKINGS)
// =======================================================

let allBookingsCache = []; 

async function loadHostBookings() {
    const tableBody = document.getElementById('host-booking-table-body');
    const emptyState = document.getElementById('booking-empty-state');
    
    const token = localStorage.getItem('token'); 
    
    if (!token) {
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl">Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại!</td></tr>`;
        if (emptyState) emptyState.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`/api/hosts/bookings`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Không thể tải danh sách đơn hàng.');
    
        allBookingsCache = data.bookings || [];
        
        if (allBookingsCache.length === 0) {
            if (tableBody) tableBody.innerHTML = ''; 
            if (emptyState) emptyState.style.display = 'block'; 
            
            const pendingCountBadge = document.getElementById('host-pending-count');
            if (pendingCountBadge) pendingCountBadge.classList.add('hidden'); 
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const pendingCount = allBookingsCache.filter(b => (b.Status || b.status) === 'pending').length;
        const pendingCountBadge = document.getElementById('host-pending-count');
        if (pendingCountBadge) {
            if (pendingCount > 0) {
                pendingCountBadge.textContent = pendingCount;
                pendingCountBadge.classList.remove('hidden'); 
            } else {
                pendingCountBadge.classList.add('hidden'); 
            }
        }

        applyCombinedFilters();

    } catch (error) {
        console.error('Lỗi tải đơn hàng Host:', error);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-rose-500 font-bold bg-rose-50">Lỗi kết nối máy chủ: ${error.message}</td></tr>`;
        if (emptyState) emptyState.style.display = 'none';
    }
}

let currentStatusFilter = 'all'; 
let currentTimeFilter = { type: 'all', start: null, end: null };
let currentKeywordFilter = ''; 

function applyCombinedFilters() {
    const now = new Date();
    
    let filteredList = allBookingsCache.filter(booking => {
        const originalStatus = booking.Status || booking.status;
        const end = new Date(booking.EndTime || booking.endTime);
        const isExpired = !isNaN(end.getTime()) && (now >= end);
        
        let displayStatus = originalStatus;
        if (originalStatus === 'in-use' && isExpired) displayStatus = 'completed';

        let passStatus = false;
        if (currentStatusFilter === 'all') passStatus = true;
        else if (currentStatusFilter === 'in-use') passStatus = (displayStatus === 'in-use');
        else if (currentStatusFilter === 'completed') passStatus = (displayStatus === 'completed' || originalStatus === 'cancelled');
        else passStatus = (displayStatus === currentStatusFilter);

        let passTime = true;
        if (currentTimeFilter.type === 'specific') {
            const bookingStart = new Date(booking.StartTime || booking.startTime);
            passTime = (bookingStart >= currentTimeFilter.start && bookingStart <= currentTimeFilter.end);
        }

        let passKeyword = true;
        if (currentKeywordFilter !== '') {
            const bookingId = (booking._id || '').toLowerCase();
            const customer = booking.CustomerID || booking.customerID || {};
            const customerEmail = (customer.email || customer.Email || '').toLowerCase();
            const customerName = (customer.fullName || customer.FullName || '').toLowerCase();
            
            passKeyword = bookingId.includes(currentKeywordFilter) || 
                          customerEmail.includes(currentKeywordFilter) || 
                          customerName.includes(currentKeywordFilter);
        }

        return passStatus && passTime && passKeyword;
    });

    filteredList.sort((a, b) => {
        const nowTime = now.getTime();

        const getPriorityScore = (bk) => {
            const status = bk.Status || bk.status;
            const endObj = new Date(bk.EndTime || bk.endTime);
            const isExpired = !isNaN(endObj.getTime()) && (nowTime >= endObj.getTime());
            
            let dStatus = status;
            if (status === 'in-use' && isExpired) dStatus = 'completed';

            if (dStatus === 'in-use') {
                const minsLeft = Math.floor((endObj.getTime() - nowTime) / (1000 * 60));
                if (minsLeft <= 14 && minsLeft >= 0) return 1; 
                return 3; 
            }
            if (dStatus === 'pending') return 2; 
            if (dStatus === 'confirmed') return 4;
            return 5; 
        };

        const scoreA = getPriorityScore(a);
        const scoreB = getPriorityScore(b);

        if (scoreA !== scoreB) {
            return scoreA - scoreB;
        }

        const endA = new Date(a.EndTime || a.endTime).getTime();
        const endB = new Date(b.EndTime || b.endTime).getTime();
        return endA - endB;
    });

    renderBookingsToTable(filteredList);
}

function handleBookingSearch() {
    const searchInput = document.getElementById('booking-search-input');
    if (!searchInput) return;
    currentKeywordFilter = searchInput.value.trim().toLowerCase();
    applyCombinedFilters();
}

let liveTimerInterval = null; 

function renderBookingsToTable(bookingsList) {
    const tableBody = document.getElementById('host-booking-table-body');
    const emptyState = document.getElementById('booking-empty-state');

    if (!tableBody) return;

    if (!bookingsList || bookingsList.length === 0) {
        tableBody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    const currentTime = new Date();

    tableBody.innerHTML = bookingsList.map(booking => {
        const start = booking.StartTime || booking.startTime;
        const end = booking.EndTime || booking.endTime;
        const status = booking.Status || booking.status;
        
        const endTimeObj = new Date(end);
        const isDateValid = !isNaN(endTimeObj.getTime());
        const timeDiff = endTimeObj.getTime() - currentTime.getTime();
        const minutesLeft = Math.floor(timeDiff / (1000 * 60)); 
        
        let displayStatus = status;
        let timeWarningUI = ''; 

        if (status === 'in-use' && isDateValid) {
            if (minutesLeft < 0) {
                displayStatus = 'completed';
            } else {
                const isHidden = minutesLeft > 14 ? 'hidden' : 'flex animate-pulse';
                timeWarningUI = `
                    <div class="live-countdown-container mt-2 ${isHidden} items-center gap-1 bg-amber-100 text-amber-600 px-3 py-1.5 rounded-xl text-xs font-black uppercase border border-amber-200 shadow-sm w-max whitespace-nowrap justify-center"
                         data-endtime="${end}">
                        ⏰ <span class="timer-text font-mono">...</span>
                    </div>
                `;
            }
        }

        // ========================================================
        // LOGIC THANH TOÁN (SINGLE SOURCE OF TRUTH - ĐỒNG BỘ VỚI CUSTOMER)
        // ========================================================
        const total = booking.TotalAmount || booking.totalAmount || 0;
        
        // Nhận phần trăm thanh toán trực tiếp từ Backend (ưu tiên percentPaid)
        let percent = booking.percentPaid !== undefined ? booking.percentPaid 
                      : (booking.percentagePaid !== undefined ? booking.percentagePaid : 0);
        
        // Tính tiền thực nhận dựa trên phần trăm
        let actualPaid = (total * percent) / 100;
        let remaining = total - actualPaid;

        // Ép 100% nếu đơn đã hoàn tất hoặc đang dùng (phòng hờ dữ liệu DB cũ)
        if (displayStatus === 'in-use' || displayStatus === 'completed') {
            percent = 100;
            actualPaid = total;
            remaining = 0; 
        }

        const customer = booking.CustomerID || booking.customerID || {};
        const space = booking.SpaceID || booking.spaceID || {};

        const startTimeStr = start ? new Date(start).toLocaleString('vi-VN', {hour: '2-digit', minute:'2-digit'}) : '--:--';
        const endTimeStr = end ? new Date(end).toLocaleString('vi-VN', {hour: '2-digit', minute:'2-digit'}) : '--:--';
        const dateStr = start ? new Date(start).toLocaleDateString('vi-VN') : 'Dữ liệu thời gian lỗi';

        let statusBadge = '';
        if (displayStatus === 'pending') {
            statusBadge = `<span class="bg-amber-50 text-amber-700 px-3 py-1 rounded-full font-black uppercase tracking-wider text-[10px]">Chờ duyệt</span>`;
        } else if (displayStatus === 'confirmed') {
            statusBadge = `<span class="bg-blue-50 text-blue-700 px-3 py-1 rounded-full font-black uppercase tracking-wider text-[10px] whitespace-nowrap">Đã xác nhận</span>`;
        } else if (displayStatus === 'in-use') {
            statusBadge = `<span class="bg-purple-50 text-purple-700 px-3 py-1 rounded-full font-black uppercase tracking-wider text-[10px]">Đang dùng</span>`;
        } else if (displayStatus === 'completed') {
            statusBadge = `<span class="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-black uppercase tracking-wider text-[10px]">Đã kết thúc</span>`;
        } else if (displayStatus === 'cancelled') {
            statusBadge = `<span class="bg-rose-50 text-rose-700 px-3 py-1 rounded-full font-black uppercase tracking-wider text-[10px]">Đã hủy</span>`;
        }

        let actionButtons = '';
        if (displayStatus === 'pending') {
            actionButtons = `
                <button onclick="executeBookingAction('${booking._id}', 'confirm')" class="bg-teal-50 text-teal-700 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase hover:bg-teal-600 hover:text-white transition mr-1">Duyệt</button>
                <button onclick="executeBookingAction('${booking._id}', 'cancel')" class="bg-rose-50 text-rose-700 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase hover:bg-rose-600 hover:text-white transition">Từ chối</button>
            `;
        } else if (displayStatus === 'confirmed') {
            actionButtons = `
                <button onclick="executeBookingAction('${booking._id}', 'checkin')" class="bg-blue-50 text-blue-700 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase hover:bg-blue-600 hover:text-white transition shadow-sm mr-1">Nhận phòng</button>
                <button onclick="executeBookingAction('${booking._id}', 'cancel')" class="bg-rose-50 text-rose-700 font-black px-3 py-1.5 rounded-xl text-[10px] uppercase hover:bg-rose-600 hover:text-white transition shadow-sm" title="Hủy do khách đến trễ/vắng mặt">Hủy (Khách trễ)</button>
            `;
        } else {
            actionButtons = `<span class="text-slate-300 font-black text-lg">-</span>`;
        }

        // ========================================================
        // KẾT XUẤT HIỂN THỊ (RENDER UI)
        // ========================================================
        let paymentUI = '';
        if (total === 0) {
            paymentUI = `
                <div class="font-black text-rose-500 text-[11px] italic">⚠️ Lỗi dữ liệu</div>
                <div class="text-[9px] font-bold text-slate-400 mt-0.5">DB trống giá (0đ)</div>
            `;
        } else {
            paymentUI = `
                <div class="font-black text-slate-800">${total.toLocaleString('vi-VN')}đ</div>
                <div class="text-[10px] font-bold text-slate-500 mt-0.5">Đã trả: ${actualPaid.toLocaleString('vi-VN')}đ (${percent}%)</div>
            `;
            
            if (displayStatus === 'cancelled') {
                paymentUI += `<div class="text-[10px] font-black text-slate-500 mt-1 bg-slate-100 inline-block px-2 py-0.5 rounded border border-slate-200">Không thu thêm</div>`;
            } else if (displayStatus === 'pending' || displayStatus === 'confirmed') {
                if (remaining > 0) {
                    paymentUI += `<div class="text-[10px] font-black text-rose-600 mt-1 bg-rose-50 inline-block px-2 py-0.5 rounded border border-rose-100">Cần thu: ${remaining.toLocaleString('vi-VN')}đ</div>`;
                } else {
                    paymentUI += `<div class="text-[10px] font-black text-emerald-600 mt-1 bg-emerald-50 inline-block px-2 py-0.5 rounded border border-emerald-100">Đã thu đủ</div>`;
                }
            } else {
                paymentUI += `<div class="text-[10px] font-black text-emerald-600 mt-1 bg-emerald-50 inline-block px-2 py-0.5 rounded border border-emerald-100">Đã thu đủ</div>`;
            }
        }

        const displayEmail = customer.email || customer.Email || '<span class="text-rose-500">Lỗi dữ liệu khách</span>';

        function getSpaceDisplayName(sp) {
            if (!sp || typeof sp !== 'object') return 'Chưa cập nhật tên Không gian';
            return (sp.name || sp.Name || sp.spaceName || sp.SpaceName || 'Chưa cập nhật tên Không gian');
        }

        function getSpaceDisplayCode(sp) {
            if (!sp || typeof sp !== 'object') return '---';
            return (sp.SpaceCode || sp.spaceCode || sp.Space_Code || sp.space_code || sp.code || sp.Space_code || '---');
        }

        const displaySpaceName = getSpaceDisplayName(space);
        const displaySpaceCode = getSpaceDisplayCode(space);

        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                <td class="p-5 font-bold text-slate-800">
                    <div class="text-teal-600 font-black">#${booking._id ? booking._id.substring(booking._id.length - 6).toUpperCase() : 'N/A'}</div>
                    <div class="text-slate-500 text-[11px] font-medium mt-0.5">${displayEmail}</div>
                </td>
                
                <td class="p-5 font-bold text-slate-700">
                    <div class="text-sm text-slate-800 mb-1">${displaySpaceName}</div>
                    <div class="text-xs font-bold text-slate-500 mb-3">Mã phòng: ${displaySpaceCode}</div>
                </td>
                
                <td class="p-5 text-slate-500 font-semibold">
                    <div>${startTimeStr} - ${endTimeStr}</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">${dateStr}</div>
                    ${timeWarningUI}
                </td>
                
                <td class="p-5">
                    ${paymentUI}
                </td>
                <td class="p-5">${statusBadge}</td>
                <td class="p-5 text-right">${actionButtons}</td>
            </tr>
        `;
    }).join('');

    if (typeof startLiveTimers === 'function') {
        startLiveTimers();
    }
}

function startLiveTimers() {
    if (liveTimerInterval) clearInterval(liveTimerInterval);

    liveTimerInterval = setInterval(() => {
        const containers = document.querySelectorAll('.live-countdown-container');
        let needToRefreshTable = false; 

        containers.forEach(container => {
            const endStr = container.getAttribute('data-endtime');
            const endTime = new Date(endStr).getTime();
            const now = new Date().getTime();
            const diff = endTime - now;

            if (diff <= 0) {
                needToRefreshTable = true;
            } else {
                const totalSeconds = Math.floor(diff / 1000);
                const mins = Math.floor(totalSeconds / 60);
                const secs = totalSeconds % 60;
                
                const secsFormatted = secs < 10 ? '0' + secs : secs;
                container.querySelector('.timer-text').textContent = `Hết giờ: ${mins}p ${secsFormatted}s`;

                if (mins <= 14) {
                    container.classList.remove('hidden');
                    container.classList.add('flex', 'animate-pulse');
                }
            }
        });

        if (needToRefreshTable) {
            applyCombinedFilters(); 
        }
    }, 1000); 
}

async function executeBookingAction(bookingId, action) {
    if (action !== 'checkin' && !confirm(`Bạn có chắc chắn muốn thực hiện hành động này không?`)) return;

    const token = localStorage.getItem('token');

    try {
        const response = await fetch(`/api/hosts/bookings/${bookingId}/${action}`, { 
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Gặp lỗi khi cập nhật đơn.');

        if (action !== 'checkin') alert(data.message || 'Thao tác dữ liệu thành công!');
        
        loadHostBookings();

    } catch (error) {
        alert(error.message);
    }
}

// =======================================================
// XỬ LÝ KHI CLICK VÀO TAB TRẠNG THÁI (BÊN TRÁI)
// =======================================================
function filterHostBookings(status, tabElement) {
    document.querySelectorAll('.booking-filter-tab').forEach(tab => {
        tab.classList.remove('active', 'bg-white', 'shadow-sm', 'text-teal-600', 'border-teal-500');
        tab.classList.add('text-slate-500', 'hover:bg-white', 'border-transparent');
    });

    if (tabElement) {
        tabElement.classList.add('active', 'bg-white', 'shadow-sm', 'text-teal-600', 'border-teal-500');
        tabElement.classList.remove('text-slate-500', 'hover:bg-white', 'border-transparent');
    }

    currentStatusFilter = status;
    applyCombinedFilters();
}

// =======================================================
// XỬ LÝ KHI CLICK VÀO PHỄU THỜI GIAN (BÊN PHẢI)
// =======================================================
function triggerDatePicker() {
    const dateInput = document.getElementById('funnel-date-picker');
    if (dateInput) {
        try { dateInput.showPicker(); } 
        catch (error) { dateInput.focus(); }
    }
}

function applyFunnelFilter(filterType) {
    const displayLabel = document.getElementById('filter-display-text');
    const datePicker = document.getElementById('funnel-date-picker');

    if (filterType === 'all') {
        datePicker.value = ''; 
        if (displayLabel) {
            displayLabel.textContent = 'Tất cả thời gian';
            displayLabel.classList.remove('text-teal-600'); 
        }
        currentTimeFilter = { type: 'all', start: null, end: null };
        
    } else if (filterType === 'specific') {
        const selectedDateVal = datePicker.value; 
        if (!selectedDateVal) return; 

        const targetDate = new Date(selectedDateVal);
        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

        if (displayLabel) {
            displayLabel.textContent = `Lọc: ${startOfDay.toLocaleDateString('vi-VN')}`;
            displayLabel.classList.add('text-teal-600'); 
        }

        currentTimeFilter = { type: 'specific', start: startOfDay, end: endOfDay };
    }

    applyCombinedFilters();
}

// =======================================================
// TỰ ĐỘNG KÍCH HOẠT KHI TẢI TRANG
// =======================================================
window.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname === '/host/bookings') {
        loadHostBookings();
    }
    
    if (window.location.pathname === '/host/spaces') {
        initHostSpacesPage();
    }

    const searchInput = document.getElementById('booking-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleBookingSearch);
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); 
                handleBookingSearch();  
            }
        });
    }
});

// ==========================================
// ĐỒNG BỘ THỜI GIAN THỰC (SOCKET.IO)
// ==========================================
if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('booking_status_updated', (data) => {
        if (typeof loadHostBookings === 'function') {
            loadHostBookings();
        }
    });
}


// =======================================================
// XỬ LÝ MODAL THÊM KHÔNG GIAN ĐƠN LẺ (KHI ĐÃ Ở TRONG 1 CƠ SỞ)
// =======================================================

let modalSpaceSelectedFiles = [];

// Mở modal thêm không gian mới
function openSpaceModal() {
    if (!currentBranchId) {
        if(typeof showToast === 'function') showToast("Vui lòng chọn 1 Cơ sở trước khi thêm Không gian!");
        return;
    }
    
    // Reset form
    document.getElementById("modal-space-code").value = "";
    document.getElementById("modal-space-name").value = "";
    document.getElementById("modal-space-category").selectedIndex = 0;
    document.getElementById("modal-space-price").value = "";
    document.getElementById("modal-space-img-input").value = "";
    
    modalSpaceSelectedFiles = [];
    document.getElementById("modal-space-img-preview").innerHTML = "";

    // Hiển thị Modal
    const modal = document.getElementById("modal-add-space");
    if (modal) modal.classList.remove("hidden");
}

// Đóng modal
function closeSpaceModal() {
    const modal = document.getElementById("modal-add-space");
    if (modal) modal.classList.add("hidden");
}

// Xem trước ảnh khi chọn trong Modal
function previewModalSpaceImage(input) {
    if (input.files && input.files.length > 0) {
        modalSpaceSelectedFiles = [...modalSpaceSelectedFiles, ...Array.from(input.files)];
    }
    if (input) input.value = ""; 
    
    const previewContainer = document.getElementById("modal-space-img-preview");
    if (!previewContainer) return;
    
    previewContainer.innerHTML = modalSpaceSelectedFiles.map((file, index) => `
        <div class="relative w-16 h-16 inline-block mt-2 mr-2">
            <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover rounded-xl border border-teal-400 shadow-sm">
            <button type="button" onclick="removeModalSpaceFile(${index})" class="absolute -top-1.5 -right-1.5 bg-slate-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold hover:bg-red-500 transition shadow">✕</button>
        </div>
    `).join("");
}

// Xóa ảnh đã chọn trong Modal
function removeModalSpaceFile(index) {
    modalSpaceSelectedFiles.splice(index, 1);
    
    // Kích hoạt lại hàm preview để vẽ lại UI
    previewModalSpaceImage({ files: [] }); 
}

// Xử lý sự kiện submit Form để lưu Không gian mới qua API
async function submitNewSpace(event) {
    event.preventDefault(); // Ngăn trình duyệt reload lại trang

    if (!currentBranchId) return;

    // Lấy dữ liệu từ Form
    const code = document.getElementById("modal-space-code").value.trim();
    const name = document.getElementById("modal-space-name").value.trim();
    const type = document.getElementById("modal-space-category").value;
    const price = document.getElementById("modal-space-price").value;

    if (!code || !name || !price) {
        if(typeof showToast === 'function') showToast("Vui lòng điền đầy đủ các thông tin bắt buộc.");
        return;
    }

    // Đóng gói dữ liệu
    const formData = new FormData();
    formData.append("spaceCode", code);
    formData.append("name", name);
    formData.append("type", type);
    formData.append("price", String(price).replace(/\D/g, ""));
    formData.append("status", "ready"); // Mặc định khi tạo mới là Sẵn sàng

    // Đính kèm các ảnh đã chọn (Dùng tên 'spaceImage' để khớp với thiết lập Cloudinary của bạn)
    if (modalSpaceSelectedFiles.length > 0) {
    modalSpaceSelectedFiles.forEach((file) => formData.append("image", file));
    }

    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch(`/api/hosts/branches/${currentBranchId}/spaces`, {
            method: "POST",
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if(typeof showToast === 'function') showToast(`Tạo không gian [${code}] thành công!`);
            closeSpaceModal();
            // Tải lại danh sách không gian của cơ sở hiện tại
            loadSpaceList(currentBranchId); 
        } else {
            if(typeof showToast === 'function') showToast(data.error || "Có lỗi xảy ra khi tạo Không gian.");
        }
    } catch (error) {
        console.error("Lỗi khi tạo Không gian:", error);
        if(typeof showToast === 'function') showToast("Lỗi hệ thống. Không thể tạo Không gian.");
    }
}