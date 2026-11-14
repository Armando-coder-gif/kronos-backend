import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error.middleware.js';

import profileRoutes from './modules/profile/profile.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import tasksRoutes from './modules/tasks/tasks.routes.js';
import timerRoutes from './modules/timer/timer.routes.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Kronos API', timestamp: new Date().toISOString() });
});

app.use('/api/profile', profileRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/timer', timerRoutes);

app.use(errorHandler);

export default app;