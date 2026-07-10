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
    },
    {
      id: 'business',
      label: 'Thông tin doanh nghiệp',
      done: !!(profile?.CompanyName && profile?.Hotline),
    },
    {
      id: 'document',
      label: 'Giấy tờ xác minh',
      done: !!profile?.VerificationDocument,
    },
    {
      id: 'payout',
      label: 'Tài khoản nhận tiền',
      done: !!(profile?.BankName && profile?.BankNumber),
    },
    {
      id: 'first_branch',
      label: 'Chi nhánh đầu tiên',
      done: branchCount > 0,
    },
    {
      id: 'first_space',
      label: 'Không gian đầu tiên',
      done: spaceCount > 0,
    },
    {
      id: 'verified',
      label: 'Admin đã duyệt',
      done: !!profile?.IsVerified,
    },
    {
      id: 'publish',
      label: 'Có listing available',
      done: publishedSpaces > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return {
    progress,
    steps,
    canAccessHostApp: !!profile?.IsVerified,
    nextStep: steps.find((s) => !s.done) || null,
  };
}

module.exports = { getHostOnboarding };
