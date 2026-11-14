import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AuthenticatedRequest, requireAuth } from '../../middlewares/auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';

const router = Router();

const startTimerSchema = z.object({
  task_id: z.string().uuid(),
});

async function stopActiveTimerForUser(userId: string) {
  const { data: activeEntry } = await supabaseAdmin
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle();

  if (!activeEntry) return null;

  const endedAt = new Date();
  const durationSeconds = Math.max(
    1,
    Math.floor((endedAt.getTime() - new Date(activeEntry.started_at).getTime()) / 1000)
  );

  const { data: stopped, error } = await supabaseAdmin
    .from('time_entries')
    .update({
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', activeEntry.id)
    .select()
    .single();

  if (error) throw error;
  return stopped;
}

router.get('/active', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('time_entries')
      .select(`
        *,
        tasks (
          id,
          title,
          estimated_minutes,
          project_id,
          projects ( id, name )
        )
      `)
      .eq('user_id', req.user!.id)
      .is('ended_at', null)
      .maybeSingle();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/start',
  requireAuth,
  validateBody(startTimerSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { task_id } = req.body;

      // 1. Verificar si ya existe otra tarea con cronómetro activo
      const { data: activeEntry, error: activeError } = await supabaseAdmin
        .from('time_entries')
        .select(`
          id,
          task_id,
          tasks ( title )
        `)
        .eq('user_id', userId)
        .is('ended_at', null)
        .maybeSingle();

      if (activeError) throw activeError;

      if (activeEntry) {
        const taskRelation = Array.isArray(activeEntry.tasks)
          ? activeEntry.tasks[0]
          : activeEntry.tasks;
        const runningTaskTitle = taskRelation?.title || 'otra tarea';

        res.status(409).json({
          error: `Ya tienes "${runningTaskTitle}" en curso. Páusala, finalízala o elimínala antes de iniciar otra.`,
        });
        return;
      }

      // 2. Verificar que la tarea exista y pertenezca al usuario
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .select('id, status')
        .eq('id', task_id)
        .eq('user_id', userId)
        .single();

      if (!task) {
        res.status(404).json({ error: 'Tarea no encontrada' });
        return;
      }

      if (task.status === 'DONE') {
        res.status(400).json({ error: 'No puedes iniciar el tiempo de una tarea finalizada.' });
        return;
      }

      // 3. Mover automáticamente a IN_PROGRESS si estaba en TODO
      if (task.status === 'TODO') {
        await supabaseAdmin
          .from('tasks')
          .update({ status: 'IN_PROGRESS' })
          .eq('id', task_id)
          .eq('user_id', userId);
      }

      // 4. Iniciar la nueva entrada de tiempo
      const { data: newEntry, error } = await supabaseAdmin
        .from('time_entries')
        .insert({
          task_id,
          user_id: userId,
          started_at: new Date().toISOString(),
        })
        .select(`
          *,
          tasks (
            id,
            title,
            estimated_minutes,
            project_id,
            projects ( id, name )
          )
        `)
        .single();

      if (error) throw error;
      res.status(201).json(newEntry);
    } catch (err) {
      next(err);
    }
  }
);

router.post('/stop', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const stopped = await stopActiveTimerForUser(req.user!.id);
    if (!stopped) {
      res.status(404).json({ error: 'No hay ningún cronómetro activo' });
      return;
    }
    res.json(stopped);
  } catch (err) {
    next(err);
  }
});

export default router;