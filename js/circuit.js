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
    <g id="circuit-plane" class="circuit-plane" transform="translate(0 0)">
      <path d="M 0 -5 L 1.6 -1 L 7 1.2 L 7 2.6 L 1.6 1.8 L 1.4 5 L 3.4 6.2 L 3.4 7.2
               L 0 6.4 L -3.4 7.2 L -3.4 6.2 L -1.4 5 L -1.6 1.8 L -7 2.6 L -7 1.2 L -1.6 -1 Z" />
    </g>
    <!-- altitude readout -->
    <text class="circuit-label" id="circuit-alt" x="6" y="12" opacity="0.9"></text>
  </svg>`;
}

// Heading of the aircraft symbol, so the marker points the way it flies.
const HEADINGS = {
  parking: 45, taxi: 45, holding: 20, lineup: 0, roll: 0, upwind: 0,
  crosswind: -45, downwindEarly: 180, downwind: 180, downwindLate: 180,
  base: 135, final: 90, 'short-final': 60, landing: 0, exit: 200,
  departure: -30, area: 0, areaHigh: 0, rejoin: 200,
};

export function moveDot(container, map) {
  const p = POINTS[map?.point] || POINTS.parking;
  const heading = HEADINGS[map?.point] ?? 0;
  for (const id of ['circuit-dot', 'circuit-dot-halo']) {
    const el = container.querySelector(`#${id}`);
    if (el) { el.setAttribute('cx', p.x); el.setAttribute('cy', p.y); }
  }
  const plane = container.querySelector('#circuit-plane');
  if (plane) plane.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${heading})`);
  const alt = container.querySelector('#circuit-alt');
  if (alt) alt.textContent = map?.altFt ? `${map.altFt} ft AAL` : '';
}

// ---------------------------------------------------------------------------
// Situation band — used by the emergency course, where a traffic-pattern
// drawing would be decorative at best and misleading at worst (11 of the 18
// emergency phases sit in the training area). This says *when* the emergency
// applies, which is the thing worth learning.
// ---------------------------------------------------------------------------

const BANDS = [
  { id: 'ground', points: ['parking', 'taxi', 'holding', 'lineup', 'exit'] },
  { id: 'takeoff', points: ['roll', 'upwind', 'crosswind', 'departure'] },
  { id: 'inflight', points: ['area', 'areaHigh', 'rejoin'] },
  { id: 'circuit', points: ['downwindEarly', 'downwind', 'downwindLate', 'base', 'final'] },
  { id: 'landing', points: ['short-final', 'landing'] },
];

export function renderSituationBand(container, labels) {
  container.innerHTML = `<div class="sitband">${BANDS.map(b => `
    <div class="sitband-seg" data-band="${b.id}">
      <span class="sitband-bar"></span>
      <span class="sitband-label">${labels[b.id] || b.id}</span>
    </div>`).join('')}</div>`;
}

export function moveBand(container, map) {
  const point = map?.point;
  const active = BANDS.find(b => b.points.includes(point))?.id;
  for (const seg of container.querySelectorAll('.sitband-seg')) {
    seg.classList.toggle('active', seg.dataset.band === active);
  }
  const alt = map?.altFt;
  const activeSeg = container.querySelector('.sitband-seg.active');
  container.querySelectorAll('.sitband-alt').forEach(e => e.remove());
  if (alt && activeSeg) {
    const tag = document.createElement('span');
    tag.className = 'sitband-alt';
    tag.textContent = `${alt} ft`;
    activeSeg.appendChild(tag);
  }
}

// ---------------------------------------------------------------------------
// Walk-around plan — a top view of the aircraft with the nine AFM stations,
// laid out like the diagram on AFM p. 4.04. Seeing *where* you are on the
// airframe is the whole point of a walk-around.
// ---------------------------------------------------------------------------

const STATIONS = {
  cabin: { x: 160, y: 62 },
  s1: { x: 138, y: 82 },   // left side of the fuselage — the walk starts here
  s2: { x: 160, y: 118 },  // tail
  s3: { x: 182, y: 82 },   // right side of the fuselage
  s4: { x: 268, y: 54 },   // right wing
  s5: { x: 199, y: 76 },   // right main gear
  s6: { x: 160, y: 30 },   // engine and propeller
  s7: { x: 160, y: 47 },   // nose gear
  s8: { x: 121, y: 76 },   // left main gear
  s9: { x: 52, y: 54 },    // left wing
};

export function renderWalkPlan(container, label) {
  const dots = Object.entries(STATIONS)
    .filter(([id]) => id !== 'cabin')
    .map(([id, p], i) => `
      <circle class="walk-dot" data-station="${id}" cx="${p.x}" cy="${p.y}" r="8" />
      <text class="walk-num" data-station="${id}" x="${p.x}" y="${p.y + 3.2}" text-anchor="middle">${i + 1}</text>`)
    .join('');
  container.innerHTML = `
  <svg viewBox="0 0 320 132" aria-hidden="true">
    <!-- fuselage -->
    <path class="plane-body" d="M 160 14 C 168 22, 170 40, 170 60 L 170 96 L 176 112 L 176 120 L 144 120 L 144 112 L 150 96 L 150 60 C 150 40, 152 22, 160 14 Z" />
    <!-- wings -->
    <path class="plane-body" d="M 150 52 L 44 58 L 44 68 L 150 72 Z" />
    <path class="plane-body" d="M 170 52 L 276 58 L 276 68 L 170 72 Z" />
    <!-- tailplane -->
    <path class="plane-body" d="M 150 104 L 116 108 L 116 115 L 150 114 Z" />
    <path class="plane-body" d="M 170 104 L 204 108 L 204 115 L 170 114 Z" />
    <!-- cabin -->
    <rect class="plane-cabin" x="151" y="44" width="18" height="26" rx="7" />
    ${dots}
    <text class="circuit-label" id="walk-label" x="160" y="10" text-anchor="middle"></text>
  </svg>`;
  const l = container.querySelector('#walk-label');
  if (l) l.textContent = label || '';
}

export function moveStation(container, map) {
  const id = map?.point;
  for (const el of container.querySelectorAll('[data-station]')) {
    el.classList.toggle('active', el.dataset.station === id);
  }
  const l = container.querySelector('#walk-label');
  if (l) l.textContent = id === 'cabin' ? (l.dataset.cabin || '') : '';
}
