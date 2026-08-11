// Circuit mini-map: top view of the aerodrome traffic circuit (left-hand)
// plus a small altitude profile. The amber dot marks the current phase.
//
// Named anchor points cover the whole flight, including departure to the
// training area (drawn as a loop off the circuit).

const W = 320, H = 132;

// Top-view geometry (left-hand circuit, runway along the bottom)
const RWY = { x1: 95, x2: 225, y: 96 };
const PATTERN = {
  downwindY: 34,
  leftX: 62,   // final/upwind turn line
  rightX: 258, // crosswind/base turn line
};

const POINTS = {
  parking:      { x: 40, y: 118, label: 'APRON' },
  taxi:         { x: 68, y: 112, label: 'TAXI' },
  holding:      { x: 88, y: 108, label: 'HLDG PT' },
  lineup:       { x: 100, y: 96 },
  roll:         { x: 140, y: 96 },
  upwind:       { x: 232, y: 96 },
  crosswind:    { x: 258, y: 65 },
  downwindEarly:{ x: 230, y: 34 },
  downwind:     { x: 160, y: 34 },
  downwindLate: { x: 100, y: 34 },
  base:         { x: 62, y: 65 },
  final:        { x: 62, y: 84 },
  'short-final': { x: 80, y: 92 },
  landing:      { x: 130, y: 96 },
  exit:         { x: 92, y: 104 },
  // training-area loop (off pattern, drawn top-right)
  departure:    { x: 285, y: 78 },
  area:         { x: 300, y: 45 },
  areaHigh:     { x: 300, y: 22 },
  rejoin:       { x: 272, y: 30 },
};

export function renderCircuit(container) {
  container.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <!-- training area loop -->
    <path class="circuit-line" stroke-dasharray="3 4"
      d="M ${POINTS.upwind.x} ${POINTS.upwind.y}
         C 290 96, 302 88, ${POINTS.area.x} ${POINTS.area.y}
         C 302 12, 288 10, ${POINTS.rejoin.x} ${POINTS.rejoin.y}
         L ${POINTS.downwindEarly.x} ${POINTS.downwindEarly.y}" />
    <!-- circuit rectangle -->
    <path class="circuit-line"
      d="M ${RWY.x2 + 7} ${RWY.y}
         L ${PATTERN.rightX} ${RWY.y} L ${PATTERN.rightX} ${PATTERN.downwindY}
         L ${PATTERN.leftX} ${PATTERN.downwindY}
         L ${PATTERN.leftX} ${RWY.y} L ${RWY.x1} ${RWY.y}" />
    <!-- runway -->
    <rect class="circuit-rwy" x="${RWY.x1}" y="${RWY.y - 3}" width="${RWY.x2 - RWY.x1}" height="6" rx="1.5" />
    <!-- taxiway to apron -->
    <path class="circuit-line" stroke-dasharray="2 3"
      d="M ${RWY.x1 + 5} ${RWY.y} L ${POINTS.holding.x} ${POINTS.holding.y} L ${POINTS.parking.x} ${POINTS.parking.y}" />
    <!-- labels -->
    <text class="circuit-label" x="160" y="${PATTERN.downwindY - 6}" text-anchor="middle">DOWNWIND</text>
    <text class="circuit-label" x="${PATTERN.leftX - 6}" y="68" text-anchor="end">BASE</text>
    <text class="circuit-label" x="${PATTERN.rightX + 6}" y="68">XWIND</text>
    <text class="circuit-label" x="160" y="${RWY.y + 14}" text-anchor="middle">RWY</text>
    <text class="circuit-label" x="${W - 6}" y="12" text-anchor="end" opacity="0.8">TRAINING AREA</text>
    <!-- current position -->
    <circle class="circuit-dot-halo" id="circuit-dot-halo" cx="0" cy="0" r="9" />
    <circle class="circuit-dot" id="circuit-dot" cx="0" cy="0" r="4" />
    <!-- altitude readout -->
    <text class="circuit-label" id="circuit-alt" x="6" y="12" opacity="0.9"></text>
  </svg>`;
}

export function moveDot(container, map) {
  const p = POINTS[map?.point] || POINTS.parking;
  for (const id of ['circuit-dot', 'circuit-dot-halo']) {
    const el = container.querySelector(`#${id}`);
    if (el) { el.setAttribute('cx', p.x); el.setAttribute('cy', p.y); }
  }
  const alt = container.querySelector('#circuit-alt');
  if (alt) alt.textContent = map?.altFt ? `${map.altFt} ft AAL` : '';
}
