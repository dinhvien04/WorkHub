const AuditLog = require('../models/AuditLog');

async function logActivity(actorId, actionType, targetEntity, targetId, description, severity = 'info') {
   console.log(`\n🕵️ ĐANG TIẾN HÀNH GHI NHẬT KÝ: ${actionType} - ${description}`);
    try {
        await AuditLog.create({
            ActorID: actorId || null,
            ActionType: actionType,
            TargetEntity: targetEntity,
            TargetID: targetId || null,
            Description: description,
            Severity: severity
        });
        if (global.io) {
            global.io.emit('new_audit_log_created', {
                message: 'Hệ thống vừa có hoạt động mới!'
            });
        }
    } catch (error) {
        // Ghi log lỗi ra terminal nhưng KHÔNG làm sập tiến trình (không dùng throw error)
        console.error('❌ Lỗi khi ghi Nhật ký hoạt động (AuditLog):', error.message);
    }
}

module.exports = logActivity;