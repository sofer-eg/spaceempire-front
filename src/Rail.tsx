import type { JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Rail is the persistent left icon-nav from the "Space Empire · Tactical"
// mockup. Only сектор / галактика / станция are wired to real screens; the
// rest are placeholders for future phases, rendered disabled with a "phase"
// tooltip so the layout reads complete without faking functionality.
//
// Active state is computed manually (not via NavLink isActive) because
// "станция" and "сектор" share the /sector route — when docked the centre
// shows the station UI, so станция takes the active marker and сектор yields.
//
// "станция" is active whenever the ship is docked at ANY dockable static
// (station / trade station / shipyard / pirbase): the centre swaps to
// StationView for all of them, and this item is the control to return to it.
// The tooltip names the actual object (stationLabel: «Верфь»/«Пиратская
// база»/…) so the item never reads as a plain "station" when it isn't.
type Props = {
  docked: boolean;
  // stationLabel is the human title of the docked static («Станция»/«Верфь»/…),
  // resolved in GameLayout (the rail renders outside <Outlet> and can't call
  // the useStation() hook). Null when in space; feeds the «станция» tooltip.
  stationLabel?: string | null;
  // "задания" is a toggle, not navigation: it opens/closes the floating
  // QuestPanel owned by GameLayout. questsOpen drives the active marker;
  // questBadge surfaces the active-quest count so the panel (and the
  // tutorial) isn't lost while hidden.
  questsOpen: boolean;
  onToggleQuests: () => void;
  questBadge: number;
  // "корабль" swaps the sector map for a full-center «ДЕТАЛИ КОРАБЛЯ» screen
  // (TASK-127.2, owned by GameLayout via ctx.shipPageOpen). shipOpen drives the
  // marker; onLeaveShip closes it from the сектор / станция items.
  shipOpen: boolean;
  onToggleShip: () => void;
  onLeaveShip: () => void;
  // "пилот" is a toggle like the two above, but it swaps the sector map for a
  // full-center «ПИЛОТ» page (owned by GameLayout via ctx.pilotPageOpen).
  pilotOpen: boolean;
  onTogglePilot: () => void;
  // onLeavePilot closes the pilot page. The сектор / станция items call it so
  // those buttons reliably return the centre to the map / station.
  onLeavePilot: () => void;
};

type Item = {
  id: string;
  label: string;
  icon: JSX.Element;
  to?: string;
  onClick?: () => void;
  enabled: boolean;
  active: boolean;
  title?: string;
  badge?: number;
};

export function Rail({ docked, stationLabel, questsOpen, onToggleQuests, questBadge, shipOpen, onToggleShip, onLeaveShip, pilotOpen, onTogglePilot, onLeavePilot }: Props) {
  const navigate = useNavigate();
  const loc = useLocation();
  const onSector = loc.pathname.startsWith('/sector');
  const onGalaxy = loc.pathname.startsWith('/galaxy');
  const onClans = loc.pathname.startsWith('/clans');
  const onBounties = loc.pathname.startsWith('/bounties');

  const soon = (phase: string) => `Скоро — ${phase}`;

  const items: Item[] = [
    {
      id: 'sector',
      label: 'сектор',
      icon: ICONS.sector,
      onClick: () => { onLeavePilot(); onLeaveShip(); navigate('/sector'); },
      enabled: true,
      active: onSector && !docked && !pilotOpen && !shipOpen,
    },
    { id: 'galaxy', label: 'галактика', icon: ICONS.galaxy, to: '/galaxy', enabled: true, active: onGalaxy },
    {
      id: 'station',
      label: 'станция',
      icon: ICONS.station,
      onClick: () => { onLeavePilot(); onLeaveShip(); navigate('/sector'); },
      enabled: docked,
      active: onSector && docked && !pilotOpen && !shipOpen,
      title: docked ? (stationLabel ? `Открыть — ${stationLabel}` : undefined) : 'Доступно при стыковке',
    },
    {
      id: 'ship',
      label: 'корабль',
      icon: ICONS.ship,
      onClick: onToggleShip,
      enabled: true,
      active: shipOpen,
      title: shipOpen ? 'Скрыть детали корабля' : 'Детали корабля',
    },
    { id: 'hangar', label: 'ангар', icon: ICONS.hangar, enabled: false, active: false, title: soon('фаза 4') },
    { id: 'trade', label: 'торг.', icon: ICONS.trade, enabled: false, active: false, title: soon('фаза 3+') },
    { id: 'infonet', label: 'розыск', icon: ICONS.infonet, to: '/bounties', enabled: true, active: onBounties },
    {
      id: 'quests',
      label: 'задания',
      icon: ICONS.quests,
      onClick: onToggleQuests,
      enabled: true,
      active: questsOpen,
      title: questsOpen ? 'Скрыть задания' : 'Показать задания',
      badge: questBadge,
    },
    { id: 'assets', label: 'активы', icon: ICONS.assets, enabled: false, active: false, title: soon('фаза 6') },
    { id: 'clan', label: 'клан', icon: ICONS.clan, to: '/clans', enabled: true, active: onClans },
    {
      id: 'pilot',
      label: 'пилот',
      icon: ICONS.pilot,
      onClick: onTogglePilot,
      enabled: true,
      active: pilotOpen,
      title: pilotOpen ? 'Скрыть профиль пилота' : 'Показать профиль пилота',
    },
  ];

  return (
    <nav className="sw-rail" aria-label="Навигация">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`sw-rail__item${it.active ? ' active' : ''}`}
          disabled={!it.enabled}
          title={it.title}
          aria-current={it.active ? 'page' : undefined}
          aria-pressed={it.onClick ? it.active : undefined}
          onClick={() => {
            if (!it.enabled) return;
            if (it.onClick) it.onClick();
            else if (it.to) navigate(it.to);
          }}
        >
          {it.badge ? <span className="sw-rail__badge">{it.badge > 9 ? '9+' : it.badge}</span> : null}
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

// Compact 18×18 stroke icons (currentColor). Kept intentionally simple —
// recognisable glyphs in the HUD's line-art language, not detailed art.
const S = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const;

const ICONS: Record<string, JSX.Element> = {
  sector: (
    <svg {...S}>
      <circle cx="9" cy="9" r="6.5" />
      <circle cx="9" cy="9" r="3" />
      <circle cx="9" cy="9" r="0.6" fill="currentColor" />
    </svg>
  ),
  galaxy: (
    <svg {...S}>
      <circle cx="4" cy="5" r="1.4" />
      <circle cx="13" cy="4" r="1.4" />
      <circle cx="9" cy="11" r="1.4" />
      <circle cx="14" cy="13" r="1.4" />
      <path d="M5 6 L8 10 M12 5 L9.5 10 M10 11.5 L13 12.5" />
    </svg>
  ),
  station: (
    <svg {...S}>
      <rect x="3.5" y="3.5" width="11" height="11" rx="1" />
      <rect x="7" y="7" width="4" height="4" rx="0.5" />
    </svg>
  ),
  ship: (
    <svg {...S}>
      <path d="M9 2.5 L14 14 L9 11 L4 14 Z" strokeLinejoin="round" />
    </svg>
  ),
  hangar: (
    <svg {...S}>
      <path d="M2.5 8 L9 3.5 L15.5 8" strokeLinejoin="round" />
      <path d="M4 8 V14.5 H14 V8" strokeLinejoin="round" />
    </svg>
  ),
  trade: (
    <svg {...S}>
      <path d="M3 6 H13 L10.5 3.5 M15 12 H5 L7.5 14.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  infonet: (
    <svg {...S}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8 V12.5 M9 5.5 V5.6" strokeLinecap="round" />
    </svg>
  ),
  assets: (
    <svg {...S}>
      <path d="M9 2.8 L15 6 L9 9.2 L3 6 Z" strokeLinejoin="round" />
      <path d="M3 9.5 L9 12.7 L15 9.5 M3 12.8 L9 16 L15 12.8" strokeLinejoin="round" />
    </svg>
  ),
  clan: (
    <svg {...S}>
      <path d="M9 2.5 L14.5 4.5 V9 C14.5 12.5 9 15.5 9 15.5 C9 15.5 3.5 12.5 3.5 9 V4.5 Z" strokeLinejoin="round" />
    </svg>
  ),
  pilot: (
    <svg {...S}>
      <circle cx="9" cy="6" r="2.8" />
      <path d="M3.5 15 C3.5 11.5 6 10 9 10 C12 10 14.5 11.5 14.5 15" strokeLinecap="round" />
    </svg>
  ),
  quests: (
    <svg {...S}>
      <path d="M5 2.5 H13 V15.5 L9 13 L5 15.5 Z" strokeLinejoin="round" />
      <path d="M7.5 6 H10.5 M7.5 8.5 H10.5" strokeLinecap="round" />
    </svg>
  ),
};
