import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AuthenticatedRequest, requireAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(120),
  description: z.string().max(500).optional(),
  billing_type: z.enum(['FIXED', 'HOURLY']).default('FIXED'),
  budget_usd: z.number().min(0).default(0),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const { data: projects, error } = await supabaseAdmin
      .from('projects')
      .select(`
        *,
        tasks (
          id,
          status,
          estimated_minutes,
          cost_usd,
          time_entries (
            duration_seconds,
            started_at,
            ended_at
          )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = (projects || []).map((project) => {
      const tasks = project.tasks || [];
      let totalEstimatedMinutes = 0;
      let totalTrackedSeconds = 0;
      let earnedUsd = 0;
      let totalTasksCostUsd = 0;

      for (const task of tasks) {
        totalEstimatedMinutes += task.estimated_minutes || 0;
        const taskCost = Number(task.cost_usd || 0);
        totalTasksCostUsd += taskCost;

        if (task.status === 'DONE') {
          earnedUsd += taskCost;
        }

        for (const entry of task.time_entries || []) {
          if (entry.ended_at) {
            totalTrackedSeconds += entry.duration_seconds || 0;
          } else {
            const activeSeconds = Math.max(
              0,
              Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000)
            );
            totalTrackedSeconds += activeSeconds;
          }
        }
      }

      const targetBudgetUsd =
        project.billing_type === 'FIXED' && Number(project.budget_usd) > 0
          ? Number(project.budget_usd)
          : totalTasksCostUsd;

      const totalHoursTracked = totalTrackedSeconds / 3600;
      const effectiveHourlyRateUsd =
        totalHoursTracked > 0 ? Number((targetBudgetUsd / totalHoursTracked).toFixed(2)) : 0;

      const { tasks: _omit, ...projectData } = project;

      return {
        ...projectData,
        metrics: {
          total_tasks: tasks.length,
          completed_tasks: tasks.filter((t: any) => t.status === 'DONE').length,
          total_estimated_minutes: totalEstimatedMinutes,
          total_tracked_seconds: totalTrackedSeconds,
          target_budget_usd: Number(targetBudgetUsd.toFixed(2)),
          earned_usd: Number(earnedUsd.toFixed(2)),
          effective_hourly_rate_usd: effectiveHourlyRateUsd,
        },
      };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select(`
        *,
        tasks (
          *,
          time_entries (*)
        )
      `)
      .eq('id', String(req.params.id))
      .eq('user_id', req.user!.id)
      .single();

    if (error || !project) {
      res.status(404).json({ error: 'Proyecto no encontrado' });
      return;
    }

    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireAuth,
  validateBody(createProjectSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .insert({ ...req.body, user_id: req.user!.id })
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
  validateBody(updateProjectSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .update(req.body)
        .eq('id', String(req.params.id))
        .eq('user_id', req.user!.id)
        .select()
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Proyecto no encontrado' });
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
      .from('projects')
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