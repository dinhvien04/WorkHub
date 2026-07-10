'use strict';

const HostProfile = require('../models/Host_Profile');
const Branch = require('../models/Branch');
const Space = require('../models/Space');

/**
 * Host onboarding checklist with progress 0–100.
 */
async function getHostOnboarding(hostId) {
  const profile = await HostProfile.findOne({ UserID: hostId }).lean();
  const branchCount = await Branch.countDocuments({ HostID: hostId });
  const spaceCount = await Space.countDocuments({ HostID: hostId });
  const publishedSpaces = await Space.countDocuments({
    HostID: hostId,
    Status: 'available',
  });

  const steps = [
    {
      id: 'account',
      label: 'Tài khoản host',
      done: true,
      href: '/host/dashboard',
      cta: 'Vào dashboard',
    },
    {
      id: 'business',
      label: 'Thông tin doanh nghiệp',
      done: !!(profile?.CompanyName && profile?.Hotline),
      href: '/host/profile',
      cta: 'Cập nhật hồ sơ',
    },
    {
      id: 'document',
      label: 'Giấy tờ xác minh',
      done: !!profile?.VerificationDocument,
      href: '/host/profile',
      cta: 'Tải giấy tờ',
    },
    {
      id: 'payout',
      label: 'Tài khoản nhận tiền',
      done: !!(profile?.BankName && profile?.BankNumber),
      href: '/host/profile',
      cta: 'Thêm ngân hàng',
    },
    {
      id: 'first_branch',
      label: 'Chi nhánh đầu tiên',
      done: branchCount > 0,
      href: '/host/spaces',
      cta: 'Tạo chi nhánh',
    },
    {
      id: 'first_space',
      label: 'Không gian đầu tiên',
      done: spaceCount > 0,
      href: '/host/spaces',
      cta: 'Tạo không gian',
    },
    {
      id: 'verified',
      label: 'Admin đã duyệt',
      done: !!profile?.IsVerified,
      href: '/host/onboarding',
      cta: 'Chờ duyệt',
    },
    {
      id: 'publish',
      label: 'Có listing available',
      done: publishedSpaces > 0,
      href: '/host/spaces',
      cta: 'Xuất bản listing',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);
  const nextStep = steps.find((s) => !s.done) || null;

  return {
    progress,
    steps,
    canAccessHostApp: !!profile?.IsVerified,
    nextStep,
    stats: {
      branchCount,
      spaceCount,
      publishedSpaces,
      isVerified: !!profile?.IsVerified,
    },
  };
}

module.exports = { getHostOnboarding };
