'use strict';

const Favorite = require('../models/Favorite');
const Branch = require('../models/Branch');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');

async function listFavorites(userId) {
  const favs = await Favorite.find({ UserID: userId })
    .sort({ createdAt: -1 })
    .populate('BranchID', 'Name Address City District Images RatingAvg Slug Status')
    .lean();
  return favs.filter((f) => f.BranchID);
}

async function addFavorite(userId, branchId) {
  if (!branchId) throw new ValidationError('Thiếu branchId.');
  const branch = await Branch.findOne({ _id: branchId, Status: 'active' }).select('_id');
  if (!branch) throw new NotFoundError('Không tìm thấy cơ sở.');
  try {
    return await Favorite.create({ UserID: userId, BranchID: branchId });
  } catch (err) {
    if (err.code === 11000) throw new ConflictError('Đã có trong yêu thích.');
    throw err;
  }
}

async function removeFavorite(userId, branchId) {
  const r = await Favorite.deleteOne({ UserID: userId, BranchID: branchId });
  if (!r.deletedCount) throw new NotFoundError('Không có trong yêu thích.');
  return { ok: true };
}

async function mergeGuestFavorites(userId, branchIds = []) {
  const ids = [...new Set((branchIds || []).map(String))].slice(0, 50);
  let added = 0;
  for (const id of ids) {
    try {
      await addFavorite(userId, id);
      added += 1;
    } catch {
      /* skip invalid/dup */
    }
  }
  return { added };
}

module.exports = { listFavorites, addFavorite, removeFavorite, mergeGuestFavorites };
