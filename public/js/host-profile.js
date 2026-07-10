// Hàm gom nhóm việc làm sạch/ẩn các ô nhập mật khẩu
function clearPasswordFields() {
    ['old-password', 'new-password', 'confirm-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('password-error')?.classList.add('hidden');
}

// Hàm ẩn/hiện các ô nhập mật khẩu
function togglePasswordFields() {
    const fields = document.getElementById('password-fields');
    if (!fields) return;

    fields.classList.toggle('hidden');
    if (fields.classList.contains('hidden')) {
        clearPasswordFields();
    }
}

// Hàm xem trước Logo khi upload
function previewImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const output = document.getElementById('logo-preview');
        if (output) output.src = reader.result;
    };
    reader.readAsDataURL(file);
}

// Hàm kiểm tra mật khẩu gõ lại có khớp hay không
function validatePasswordMatch() {
    const newPass = document.getElementById('new-password')?.value || '';
    const confirmPass = document.getElementById('confirm-password')?.value || '';
    const errorText = document.getElementById('password-error');

    const isMismatch = confirmPass && newPass !== confirmPass;
    errorText?.classList.toggle('hidden', !isMismatch);
    return !isMismatch;
}

// ==========================================
// TỰ ĐỘNG TẢI DỮ LIỆU KHI MỞ TRANG PROFILE
// ==========================================
async function loadProfile() {
    const token = localStorage.getItem('token');
    if (!token) return console.error('Không tìm thấy token xác thực. Vui lòng đăng nhập lại.');

    try {
        // Đã sửa đường dẫn URL chuẩn
        const response = await fetch('/api/hosts/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không thể tải dữ liệu hồ sơ.');

        const { user = {}, profile = {} } = data;

        const mapping = {
            'host-name-input': user.FullName,
            'email': user.Email,
            'companyName': profile.CompanyName,
            'hotline': profile.Hotline,
            'taxCode': profile.TaxCode,
            'bankName': profile.BankName,
            'bankNumber': profile.BankNumber
        };

        Object.entries(mapping).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        });

        if (profile.Logo) {
            const logoPreview = document.getElementById('logo-preview');
            if (logoPreview) logoPreview.src = profile.Logo;
        }

    } catch (error) {
        console.error('Lỗi khi tải thông tin hồ sơ:', error.message);
    }
}

window.addEventListener('DOMContentLoaded', loadProfile);

// ==========================================
// HÀM XỬ LÝ CHÍNH KHI BẤM NÚT LƯU HỒ SƠ
// ==========================================
async function updateProfile() {
    const submitBtn = document.getElementById('submit-btn');
    const token = localStorage.getItem('token');
    if (!submitBtn) return;

    submitBtn.disabled = true;
    submitBtn.innerText = 'ĐANG XỬ LÝ...';
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
        const oldPassword = document.getElementById('old-password')?.value.trim() || '';
        const newPassword = document.getElementById('new-password')?.value.trim() || '';

        if (oldPassword || newPassword) {
            if (!oldPassword || !newPassword) return alert('Vui lòng điền đầy đủ cả Mật khẩu cũ và Mật khẩu mới!');
            if (!validatePasswordMatch()) return alert('Mật khẩu xác nhận không trùng khớp!');
            if (newPassword.length < 6) return alert('Mật khẩu mới phải từ 6 ký tự trở lên!');

            const passResponse = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            const passResult = await passResponse.json();
            if (!passResponse.ok) return alert('Lỗi đổi mật khẩu: ' + (passResult.error || 'Thất bại'));
        }

        const formElement = document.getElementById('profile-form');
        // Đã sửa đường dẫn URL chuẩn
        const profileResponse = await fetch('/api/hosts/profile', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: new FormData(formElement)
        });

        const profileResult = await profileResponse.json();

        if (profileResponse.ok) {
            typeof showToast === 'function' ? showToast('Cập nhật hồ sơ thành công!') : alert('Cập nhật hồ sơ thành công!');

            document.getElementById('password-fields')?.classList.add('hidden');
            clearPasswordFields();
            loadProfile();
        } else {
            alert(profileResult.error || 'Cập nhật thông tin hồ sơ thất bại!');
        }

    } catch (error) {
        console.error('Lỗi hệ thống:', error);
        alert('Có lỗi xảy ra trong quá trình truyền dữ liệu!');
    } finally {
        resetSubmitButton();
    }
}

// Hàm trả lại trạng thái cho nút bấm
function resetSubmitButton() {
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'LƯU THAY ĐỔI HỒ SƠ';
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}