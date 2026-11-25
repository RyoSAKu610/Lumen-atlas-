import { loadGameDataOrThrow } from './data/load';
import { bindLivingWorld, runObservation } from './observe/session';
import { mountShell } from './ui/shell';

const root = document.querySelector<HTMLElement>('#app');

async function boot(): Promise<void> {
  if (!root) return;
  const data = loadGameDataOrThrow();
  const modules = await bindLivingWorld();
  if (!modules) {
    const shell = mountShell(root, data);
    shell.setClock({ day: 1, clock: '06:00', season: '春', weather: '晴れ', temp: '—', speed: '待機' });
    shell.setShot('湯霞の夜明け');
    shell.setStatus('生態・光・骨格を結線しています');
    shell.pushJournal({
      time: '06:00',
      text: data.narration.templates['system.world_created']?.[0] ?? '湯霞の谷。観察を始める。',
    });
    markReady();
    return;
  }
  try {
    await runObservation(root, modules, data);
  } catch (error) {
    const shell = mountShell(root, data);
    shell.setStatus(error instanceof Error ? error.message : '観察を開始できなかった');
    markReady();
  }
}

function markReady(): void {
  (window as Window & { __LA_READY?: boolean }).__LA_READY = true;
}

void boot();
