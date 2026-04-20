import './styles/app.css';
import { bootstrap } from './app/bootstrap';
import { startLoop } from './app/loop';

async function main() {
  const ctx = await bootstrap();
  if (!ctx) return; // unsupported message already shown
  startLoop(ctx);
}

void main();
