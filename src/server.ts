import app from './app.js';
import { env } from './config/env.js';

app.listen(Number(env.PORT), () => {
  console.log(`🚀 Kronos Backend corriendo en http://localhost:${env.PORT}`);
});