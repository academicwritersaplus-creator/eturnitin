'use strict';
// Admin overview: metadata for ALL submissions (title, owner, date, status, %).
// Admins cannot read other people's document text or reports through this API.
const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin, asyncRoute } = require('./middleware');
const { buildFilters, paging, SORTS } = require('./routes-documents');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/documents', asyncRoute(async (req, res) => {
  const params = [];
  const where = buildFilters(req.query, params);
  if (req.query.user) {
    params.push(`%${String(req.query.user).slice(0, 100).replace(/[\\%_]/g, m => '\\' + m)}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, pageSize, offset } = paging(req.query);
  const order = (SORTS[req.query.sort] || SORTS.newest).replace(/(^|, )(\w)/g, '$1d.$2');
  const [list, count] = await Promise.all([
    db.query(
      `SELECT d.id, d.title, d.input_type, d.status, d.similarity, d.word_count, d.report_ref,
              d.created_at, d.completed_at, u.full_name AS owner_name, u.email AS owner_email
       FROM documents d JOIN users u ON u.id = d.user_id ${whereSql}
       ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, params),
    db.query(`SELECT count(*)::int AS n FROM documents d JOIN users u ON u.id = d.user_id ${whereSql}`, params),
  ]);
  res.json({ items: list.rows, total: count.rows[0].n, page, pageSize });
}));

router.get('/stats', asyncRoute(async (req, res) => {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM sources) AS sources,
            count(*)::int AS documents,
            count(*) FILTER (WHERE status = 'pending')::int    AS pending,
            count(*) FILTER (WHERE status = 'processing')::int AS processing,
            count(*) FILTER (WHERE status = 'completed')::int  AS completed,
            count(*) FILTER (WHERE status = 'failed')::int     AS failed
     FROM documents`);
  res.json(rows[0]);
}));

module.exports = router;
