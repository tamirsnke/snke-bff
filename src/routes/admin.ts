import { Router } from 'express';
import { AuthenticatedRequest, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { businessMetrics } from '../config/monitoring';
import { body, param, query } from 'express-validator';

const router = Router();

// All routes require admin role
router.use(requireRole('admin') as any);

// Get all users
router.get(
  '/users',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString().trim(),
  ],
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDatabase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;

    let query = `
      SELECT id, username, email, first_name, last_name, roles, 
             created_at, updated_at, last_login
      FROM users
    `;
    const params: any[] = [];

    if (search) {
      query += ` WHERE username ILIKE $1 OR email ILIKE $1 OR 
                 first_name ILIKE $1 OR last_name ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [usersResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(
        search
          ? 'SELECT COUNT(*) FROM users WHERE username ILIKE $1 OR email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1'
          : 'SELECT COUNT(*) FROM users',
        search ? [`%${search}%`] : []
      ),
    ]);

    const users = usersResult.rows;
    const total = parseInt(countResult.rows[0].count);

    businessMetrics.recordApiUsage('/admin/users', req.user?.roles[0] || 'admin');

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

// Get user by ID
router.get(
  '/users/:id',
  [param('id').isUUID()],
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDatabase();
    const { id } = req.params;

    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    businessMetrics.recordApiUsage('/admin/users/:id', req.user?.roles[0] || 'admin');

    res.json(user);
  })
);

// Update user roles
router.put(
  '/users/:id/roles',
  [
    param('id').isUUID(),
    body('roles')
      .isArray()
      .custom((roles) => {
        const validRoles = ['user', 'admin', 'moderator'];
        return roles.every((role: string) => validRoles.includes(role));
      }),
  ],
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDatabase();
    const { id } = req.params;
    const { roles } = req.body;

    const result = await db.query(
      'UPDATE users SET roles = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [roles, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    logger.info('User roles updated', {
      adminUserId: req.user?.id,
      targetUserId: id,
      newRoles: roles,
    });

    businessMetrics.recordApiUsage('/admin/users/:id/roles', req.user?.roles[0] || 'admin');

    res.json(user);
  })
);

// Delete user
router.delete(
  '/users/:id',
  [param('id').isUUID()],
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDatabase();
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (id === req.user?.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const deletedUser = result.rows[0];

    logger.info('User deleted', {
      adminUserId: req.user?.id,
      deletedUserId: id,
      deletedUsername: deletedUser.username,
    });

    businessMetrics.recordApiUsage('/admin/users/:id', req.user?.roles[0] || 'admin');

    res.json({ success: true });
  })
);

// Get system statistics
router.get(
  '/stats',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDatabase();

    const [userCountResult, activeSessionsResult, recentLoginsResult] = await Promise.all([
      db.query('SELECT COUNT(*) as total FROM users'),
      db.query('SELECT COUNT(*) as active FROM user_sessions WHERE expires_at > NOW()'),
      db.query(
        "SELECT COUNT(*) as recent FROM users WHERE last_login > NOW() - INTERVAL '24 hours'"
      ),
    ]);

    const stats = {
      totalUsers: parseInt(userCountResult.rows[0].total),
      activeSessions: parseInt(activeSessionsResult.rows[0].active),
      recentLogins: parseInt(recentLoginsResult.rows[0].recent),
    };

    businessMetrics.recordApiUsage('/admin/stats', req.user?.roles[0] || 'admin');

    res.json(stats);
  })
);

export default router;
