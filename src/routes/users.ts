import { Router } from 'express';
import { AuthenticatedRequest, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { getDatabase } from '../config/database';
import { logger } from '../utils/logger';
import { businessMetrics } from '../config/monitoring';
import { body, param, query } from 'express-validator';

const router = Router();

// Get user profile
router.get(
  '/profile',
  asyncHandler(async (req: any, res: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    businessMetrics.recordUserAction('profile_viewed', req.user.id);

    res.json({
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      roles: req.user.roles,
    });
  })
);

// Update user profile
router.put(
  '/profile',
  [
    body('firstName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('lastName').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('email').optional().isEmail().normalizeEmail(),
  ],
  validateRequest,
  asyncHandler(async (req: any, res: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = getDatabase();
    const { firstName, lastName, email } = req.body;

    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (firstName !== undefined) {
      updateFields.push(`first_name = $${paramIndex}`);
      updateValues.push(firstName);
      paramIndex++;
    }

    if (lastName !== undefined) {
      updateFields.push(`last_name = $${paramIndex}`);
      updateValues.push(lastName);
      paramIndex++;
    }

    if (email !== undefined) {
      updateFields.push(`email = $${paramIndex}`);
      updateValues.push(email);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(req.user.id);

    const result = await db.query(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() 
       WHERE id = $${paramIndex} RETURNING *`,
      updateValues
    );

    const updatedUser = result.rows[0];

    businessMetrics.recordUserAction('profile_updated', req.user.id);

    logger.info('User profile updated', {
      userId: req.user.id,
      updatedFields: updateFields,
    });

    res.json({
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      firstName: updatedUser.first_name,
      lastName: updatedUser.last_name,
      roles: updatedUser.roles,
    });
  })
);

// Get user preferences
router.get(
  '/preferences',
  asyncHandler(async (req: any, res: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = getDatabase();

    const result = await db.query('SELECT preferences FROM users WHERE id = $1', [req.user.id]);

    const preferences = result.rows[0]?.preferences || {};

    res.json(preferences);
  })
);

// Update user preferences
router.put(
  '/preferences',
  [body('preferences').isObject()],
  validateRequest,
  asyncHandler(async (req: any, res: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = getDatabase();
    const { preferences } = req.body;

    await db.query('UPDATE users SET preferences = $1, updated_at = NOW() WHERE id = $2', [
      JSON.stringify(preferences),
      req.user.id,
    ]);

    businessMetrics.recordUserAction('preferences_updated', req.user.id);

    logger.info('User preferences updated', {
      userId: req.user.id,
    });

    res.json({ success: true });
  })
);

export default router;
