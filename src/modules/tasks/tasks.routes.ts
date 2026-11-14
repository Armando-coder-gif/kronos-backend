import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AuthenticatedRequest, requireAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

const createTaskSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1, 'El título es obligatorio').max(200),
  description: z.string().max(1000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).default('TODO'),
  estimated_minutes: z.number().int().min(0).default(0),
  cost_usd: z.number().min(0).default(0),
  position: z.number().int().default(0),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  estimated_minutes: z.number().int().min(0).optional(),
  cost_usd: z.number().min(0).optional(),
  position: z.number().int().optional(),
});

router.post(
  '/',
  requireAuth,
  validateBody(createTaskSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;

      const { data: project } = await supabaseAdmin
        .from('projects')
        .select('id')
        .eq('id', req.body.project_id)
        .eq('user_id', userId)
        .single();

      if (!project) {
        res.status(403).json({ error: 'No tienes acceso a este proyecto' });
        return;
      }

      const completed_at = req.body.status === 'DONE' ? new Date().toISOString() : null;

      const { data, error } = await supabaseAdmin
        .from('tasks')
        .insert({
          ...req.body,
          user_id: userId,
          completed_at,
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireAuth,
  validateBody(updateTaskSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const updates: Record<string, unknown> = { ...req.body };

      if (req.body.status === 'DONE') {
        updates.completed_at = new Date().toISOString();
      } else if (req.body.status) {
        updates.completed_at = null;
      }

      const { data, error } = await supabaseAdmin
        .from('tasks')
        .update(updates)
        .eq('id', String(req.params.id))
        .eq('user_id', req.user!.id)
        .select()
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Tarea no encontrada' });
        return;
      }

      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', String(req.params.id))
      .eq('user_id', req.user!.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;