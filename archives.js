const COMPLETED_CASES_KEY = 'fenn-md.completed-cases.v1';
const fallbackManifest = {
  defaultCase: '001-inferior-stemi',
  cases: [
    { number: 1, id: '001-inferior-stemi', title: "The Principal's Chest Pain", diagnosis: 'Inferior STEMI with right-ventricular involvement', system: 'Cardiology', status: 'active' },
    { number: 2, id: '002-wernicke-encephalopathy', title: "The Restaurant Manager's Collapse", diagnosis: 'Wernicke Encephalopathy', system: 'Neurology', status: 'active' },
    { number: 3, id: '003-anticholinergic-toxidrome', title: "The Conservatory Technician's Confusion", diagnosis: 'Anticholinergic Toxidrome', system: 'Toxicology', status: 'active' },
    { number: 4, id: '004-small-cell-lung-cancer', title: "The Sales Director's Cough", diagnosis: 'Small Cell Lung Cancer', system: 'Pulmonology', status: 'active' },
    { number: 5, id: '005-cushing-syndrome', title: "The Councilor's Prescription", diagnosis: 'Cushing Syndrome', system: 'Endocrinology', status: 'active' }
  ]
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function readCompletedCases() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COMPLETED_CASES_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

async function loadManifest() {
  for (const path of ['cases/manifest.json', 'manifest.json']) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (response.ok) return response.json();
    } catch {
      // Direct file previews cannot fetch JSON; the embedded active shelf keeps the Archive visible.
    }
  }
  return fallbackManifest;
}

function renderArchive(manifest) {
  const shelf = document.querySelector('#case-shelf');
  const completed = readCompletedCases();
  const cases = manifest.cases.filter((entry) => entry.status === 'active').sort((a, b) => a.number - b.number);
  const completedCount = cases.filter((entry) => completed[entry.id]?.completed).length;
  document.querySelector('#archive-progress-value').textContent = `${completedCount} / ${cases.length}`;
  document.querySelector('#archive-status').textContent = `${cases.length} playable files · ${completedCount} completed`;
  document.querySelector('#today-link').href = `index.html?case=${encodeURIComponent(manifest.defaultCase)}`;

  shelf.innerHTML = cases.map((entry) => {
    const record = completed[entry.id];
    const isCompleted = Boolean(record?.completed);
    const isToday = entry.id === manifest.defaultCase;
    const badges = `${isToday ? '<span class="today-badge">TODAY</span>' : ''}${isCompleted ? '<span class="complete-badge">✓ CLOSED</span>' : ''}`;
    return `<article class="case-file${isToday ? ' today' : ''}${isCompleted ? ' completed' : ''}">
      <div class="file-number">${String(entry.number).padStart(2, '0')}</div>
      <div class="file-copy">
        <div class="file-meta"><span>${escapeHtml(entry.system)}</span><span>${badges}</span></div>
        <h2>${escapeHtml(entry.title)}</h2>
        <p class="file-diagnosis${isCompleted ? '' : ' sealed'}">${isCompleted ? escapeHtml(entry.diagnosis) : 'Diagnosis sealed until case completion'}</p>
        <div class="file-footer">
          <span class="file-score">${isCompleted ? `BEST SCORE ${Number(record.bestScore) || 0} · ${Number(record.attempts) || 1} ${Number(record.attempts) === 1 ? 'RUN' : 'RUNS'}` : 'UNRESOLVED'}</span>
          <a class="open-case" href="index.html?case=${encodeURIComponent(entry.id)}">${isCompleted ? 'REPLAY' : 'OPEN FILE'} →</a>
        </div>
      </div>
    </article>`;
  }).join('');
}

loadManifest().then(renderArchive).catch((error) => {
  const message = document.querySelector('#archive-error');
  message.hidden = false;
  message.textContent = `The archive could not be opened: ${error.message}`;
});

const rainCanvas = document.querySelector('#archive-rain');
const rainContext = rainCanvas.getContext('2d', { alpha: true });
let rainSeed = 71357;
const random = () => {
  rainSeed = (rainSeed * 16807) % 2147483647;
  return (rainSeed - 1) / 2147483646;
};
const rainDrops = Array.from({ length: 154 }, () => ({
  x: random() * rainCanvas.width,
  y: random() * rainCanvas.height,
  length: 11 + Math.floor(random() * 10),
  speed: 4.4 + random() * 3.8,
  alpha: .18 + random() * .3,
  drift: -(2.4 + random() * 2.1)
}));
let lastRainFrame = 0;
let rainFrameCount = 0;
function drawRain(time) {
  if (time - lastRainFrame >= 32) {
    lastRainFrame = time;
    rainFrameCount += 1;
    rainCanvas.dataset.frame = String(rainFrameCount);
    rainContext.clearRect(0, 0, rainCanvas.width, rainCanvas.height);
    rainDrops.forEach((drop) => {
      drop.y += drop.speed;
      drop.x += drop.drift;
      if (drop.y > rainCanvas.height + drop.length || drop.x < -drop.length) {
        drop.x = random() * rainCanvas.width + 7;
        drop.y = -drop.length - random() * 28;
      }
      const slant = Math.max(5, Math.round(drop.length * .58));
      const x = Math.round(drop.x);
      const y = Math.round(drop.y);
      const crossesCenterMullion = x > 449 && x < 508;
      if (!crossesCenterMullion) {
        rainContext.strokeStyle = `rgba(157, 216, 244, ${drop.alpha})`;
        rainContext.lineWidth = 2;
        rainContext.beginPath();
        rainContext.moveTo(x, y);
        rainContext.lineTo(x - slant, y + drop.length);
        rainContext.stroke();
      }
    });
  }
  requestAnimationFrame(drawRain);
}
requestAnimationFrame(drawRain);
