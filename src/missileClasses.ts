// The five missile ammunition classes (ct_missiles, TASK-175): class → goods id,
// display name and hold footprint. Mirrors the backend's own table, which lives in
// `domain` (domain.MissileGoodsTypes) precisely so the layers that must agree on it
// cannot drift — see internal/domain/cargo.go.
//
// One module rather than a copy per component: CombatHUD (a button per class with
// its own hold count) and ObjectActionsMenu (the same five items on the canvas /
// row menu) both need it, and the two copies TASK-175 shipped had already diverged
// in their field set — one carried `space`, the other did not — which is exactly
// how the class→goods table starts drifting.
//
// `space` is the hold footprint quoted in CombatHUD's tooltip: it decides whether a
// hull can carry the ammunition at all. A starter cargobay is 50, so even the
// heaviest missile (3) fits comfortably — unlike the drone's 290, which a starter
// hull cannot take at all.
export const MISSILE_CLASSES = [
  { cls: 1, goods: 10, name: 'Москит', space: 1 },
  { cls: 2, goods: 11, name: 'Оса', space: 1 },
  { cls: 3, goods: 12, name: 'Стрекоза', space: 1 },
  { cls: 4, goods: 13, name: 'Шелкопряд', space: 2 },
  { cls: 5, goods: 14, name: 'Шершень', space: 3 },
] as const;
