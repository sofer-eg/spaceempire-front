import { sendLaunchDrone, type EntityRef } from './api';
import { emitLog } from './eventBus';

// launchDronesReported launches the salvo and journals how many drones actually
// flew — the mirror of recallDronesReported, for the same reason.
//
// Since TASK-176 the SERVER sizes the salvo (min(up_drone_control level − drones
// already out, drones in the hold)), so the number is variable and the client cannot
// predict it: a level-8 module over a full hold spends eight drones — tens of
// thousands of credits — on one click, and both call sites used to drop `spawned` on
// the floor, leaving the player with no count and no confirmation. A short answer
// («запущено 1 из 3») is a normal outcome, not an error, and one the player has to be
// told about.
//
// Both call sites (the combat HUD and the object menu, panel row and canvas alike) go
// through here so the two cannot drift. Errors are left to the caller's own handler,
// which already shows them.
export async function launchDronesReported(shipID: number, targetRef: EntityRef): Promise<void> {
  const { spawned } = await sendLaunchDrone(shipID, targetRef);
  emitLog({
    category: 'combat',
    kind: spawned > 0 ? 'good' : 'warn',
    message: spawned > 0 ? `Запущено дронов: ${spawned}.` : 'Дроны не запущены.',
  });
}
