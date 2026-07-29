import { sendRecallDrones } from './api';
import { emitLog } from './eventBus';

// recallDronesReported recalls the ship's drones and journals the outcome.
//
// The hold caps how many can come home (TASK-156: the server credits what fits
// and leaves the rest flying, instead of overfilling the hold as it used to), so a
// partial recall is a normal answer — and one the player has to be told about.
// «Вернуть дронов» is otherwise silent: the drones that stayed out just remain on
// the radar with no explanation, and clicking again does nothing until the hold is
// emptied.
//
// Both call sites (the combat HUD and the object menu) go through here so the two
// cannot drift. Errors are left to the caller's own handler, which already shows
// them.
export async function recallDronesReported(shipID: number): Promise<void> {
  const { recalled, left } = await sendRecallDrones(shipID);
  if (left > 0) {
    emitLog({
      category: 'combat',
      kind: 'warn',
      message:
        recalled > 0
          ? `Возвращено дронов: ${recalled}. В космосе осталось ${left} — не хватает места в трюме.`
          : `Дроны не возвращены: нет места в трюме (в космосе ${left}).`,
    });
    return;
  }
  if (recalled > 0) {
    emitLog({
      category: 'combat',
      kind: 'good',
      message: `Возвращено дронов: ${recalled}.`,
    });
  }
}
