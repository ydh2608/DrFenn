let caseData = null;
const scene = document.querySelector('#scene');
const contextBody = document.querySelector('#context-body');
const contextStatus = document.querySelector('#context-status');
const patientQuote = document.querySelector('#patient-quote');
const fennickComment = document.querySelector('#fennick-comment');
const judgmentValue = document.querySelector('#judgment-value');
const labDrawer = document.querySelector('#lab-drawer');
const labGrid = document.querySelector('#lab-grid');
const labResult = document.querySelector('#lab-result');
const presentationStream = document.querySelector('#presentation-stream');
const phaseWorkspace = document.querySelector('#phase-workspace');
const boardScroll = document.querySelector('#board-scroll');
const caseTab = document.querySelector('#case-tab');
const managementTab = document.querySelector('#management-tab');
const evidenceItems = document.querySelector('#evidence-items');
const evidenceEmpty = document.querySelector('#evidence-empty');
const evidenceCount = document.querySelector('#evidence-count');
const evidenceLog = document.querySelector('#evidence-log');
const evidenceToggle = document.querySelector('#evidence-toggle');
const differentialPanel = document.querySelector('#differential-panel');
const differentialInputs = [...document.querySelectorAll('.differential-input')];
const differentialPrimary = document.querySelector('#differential-primary');
const differentialStage = document.querySelector('#differential-stage');
const differentialIntro = document.querySelector('#differential-intro');
const differentialStatus = document.querySelector('#differential-status');
const differentialFeedback = document.querySelector('#differential-feedback');
const caseLabel = document.querySelector('#case-label');
const patientTitle = document.querySelector('#patient-title');
const patientOccupation = document.querySelector('#patient-occupation');
const patientStatus = document.querySelector('#patient-status');
const hintButton = document.querySelector('#hint-button');
let diagnosisPool = [];

const state = {
  judgment: 0,
  context: 'hpi',
  revealed: new Set(),
  orderedLabs: new Set(),
  phase: 'workup',
  managementStage: 0,
  managementViewStage: 0,
  managementComplete: false,
  managementHistory: [],
  hints: 0,
  wrongAnswers: 0,
  quoteTyping: 0,
  quoteResolve: null,
  evidence: new Map(),
  differentialLocked: false,
  initialDifferential: [],
  finalDifferential: [],
  finalDiagnosis: '',
  diagnosesReady: false,
  diagnosisCorrect: false,
  activeView: 'case'
};

function spendJudgment(amount) {
  state.judgment = Math.max(0, state.judgment - amount);
  judgmentValue.textContent = state.judgment;
}

function setFennick(text) {
  fennickComment.textContent = text;
}

function setQuote(text, speed = 20) {
  if (!text) return Promise.resolve(null);
  const clean = String(text).replace(/^[“”'\"]+|[“”'\"]+$/g, '');
  if (state.quoteResolve) {
    state.quoteResolve(null);
    state.quoteResolve = null;
  }
  const token = ++state.quoteTyping;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    patientQuote.textContent = `“${clean}”`;
    return Promise.resolve(token);
  }

  return new Promise((resolve) => {
    state.quoteResolve = resolve;
    patientQuote.textContent = '“';
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    patientQuote.append(cursor);
    let index = 0;

    const tick = () => {
      if (token !== state.quoteTyping) return;
      if (index < clean.length) {
        cursor.before(document.createTextNode(clean[index++]));
        window.setTimeout(tick, speed + Math.random() * 8);
        return;
      }
      cursor.before(document.createTextNode('”'));
      cursor.remove();
      state.quoteResolve = null;
      resolve(token);
    };

    tick();
  });
}

function continueAfterQuote(quotePromise, callback, pause = 420) {
  quotePromise.then((token) => {
    if (token === null) return;
    window.setTimeout(() => {
      if (state.quoteTyping === token) callback();
    }, pause);
  });
}

function logEvidence(id, label, text) {
  if (state.evidence.has(id)) return;
  state.evidence.set(id, { label, text });
  evidenceEmpty.hidden = true;
  evidenceCount.textContent = `${state.evidence.size} ${state.evidence.size === 1 ? 'finding' : 'findings'}`;

  const item = document.createElement('div');
  item.className = 'evidence-item new';
  item.dataset.evidence = id;
  const heading = document.createElement('strong');
  heading.textContent = label;
  const body = document.createElement('span');
  body.textContent = text;
  item.append(heading, body);
  evidenceItems.append(item);
  window.setTimeout(() => item.classList.remove('new'), 350);
}

function normalizeDiagnosis(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[–—-]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function requireCaseFields(data) {
  const required = ['schemaVersion', 'id', 'date', 'scoring', 'patient', 'fenn', 'hpi', 'chart', 'diagnosticReasoning', 'workup', 'labs', 'management', 'hints', 'debrief'];
  const missing = required.filter((key) => data[key] === undefined || data[key] === null);
  if (missing.length) throw new Error(`Case file is missing: ${missing.join(', ')}`);
  if (data.schemaVersion !== 1) throw new Error(`Unsupported case format: ${data.schemaVersion}`);
  if (!Array.isArray(data.labs) || !data.labs.length) throw new Error('A case needs at least one laboratory result.');
  if (!Array.isArray(data.management) || !data.management.length) throw new Error('A case needs at least one management decision.');
  if (!Array.isArray(data.hints) || !data.hints.length) throw new Error('A case needs at least one hint.');
  data.management.forEach((stage, index) => {
    if (!Array.isArray(stage.options) || stage.options.filter((option) => option.correct).length !== 1) {
      throw new Error(`Management decision ${index + 1} must have exactly one correct option.`);
    }
  });
}

function validateDiagnosisReferences() {
  const available = new Set(diagnosisPool.map((diagnosis) => diagnosis.id));
  const reasoning = caseData.diagnosticReasoning;
  const referenced = [
    reasoning.finalDiagnosisId,
    ...reasoning.earlyRecognitionIds,
    ...reasoning.mustNotMiss.map((item) => item.id),
    ...reasoning.reasonableAlternatives.map((item) => item.id),
    ...Object.keys(reasoning.finalFeedback || {})
  ];
  const missing = [...new Set(referenced.filter((id) => !available.has(id)))];
  if (missing.length) throw new Error(`Case uses diagnosis IDs missing from diagnoses.json: ${missing.join(', ')}`);
}

async function loadCaseData() {
  const manifestResponse = await fetch('cases/manifest.json', { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Case manifest returned ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  const requested = new URLSearchParams(window.location.search).get('case') || manifest.defaultCase;
  const manifestEntry = manifest.cases.find((entry) => entry.id === requested && entry.status === 'active');
  if (!/^[a-z0-9-]+$/.test(requested) || !manifestEntry) {
    throw new Error(`Unknown or inactive case: ${requested}`);
  }
  if (!/^[a-z0-9-]+\.json$/.test(manifestEntry.batch)) throw new Error(`Invalid batch file for case: ${requested}`);
  const caseResponse = await fetch(`cases/${manifestEntry.batch}`, { cache: 'no-store' });
  if (!caseResponse.ok) throw new Error(`Batch ${manifestEntry.batch} returned ${caseResponse.status}`);
  const batch = await caseResponse.json();
  if (!Array.isArray(batch)) throw new Error(`Batch ${manifestEntry.batch} is not an array.`);
  const data = batch.find((entry) => entry.id === requested);
  if (!data) throw new Error(`Case ${requested} is missing from ${manifestEntry.batch}.`);
  requireCaseFields(data);
  return data;
}

function initializeStateForCase() {
  state.judgment = caseData.scoring.initialScore;
  state.context = 'hpi';
  state.revealed = new Set();
  state.orderedLabs = new Set();
  state.phase = 'workup';
  state.managementStage = 0;
  state.managementViewStage = 0;
  state.managementComplete = false;
  state.managementHistory = caseData.management.map(() => ({ attempted: new Set(), correctIndex: null, completed: false }));
  state.hints = 0;
  state.wrongAnswers = 0;
  state.evidence = new Map();
  state.differentialLocked = false;
  state.initialDifferential = [];
  state.finalDifferential = [];
  state.finalDiagnosis = '';
  state.diagnosisCorrect = false;
  state.activeView = 'case';
  judgmentValue.textContent = state.judgment;
}

function renderPatientHeader() {
  const patient = caseData.patient;
  caseLabel.textContent = patient.caseLabel;
  patientTitle.textContent = `${patient.title}, ${patient.age}${patient.sex}`;
  patientOccupation.textContent = patient.occupation;
  patientStatus.textContent = patient.status;
  patientQuote.textContent = `“${String(patient.initialQuote).replace(/^[“”'"]+|[“”'"]+$/g, '')}”`;
  document.title = `Fenn MD — ${patient.title}`;
  Object.entries(patient.vitals).forEach(([key, value]) => {
    const element = document.querySelector(`[data-vital="${key}"]`);
    if (!element) return;
    element.textContent = value;
    element.closest('.vital').classList.toggle('critical', patient.criticalVitals.includes(key));
  });
  setFennick(caseData.fenn.initial);
}

function enableCaseControls() {
  ['history', 'exam'].forEach((kind) => {
    const button = document.querySelector(`[data-workup="${kind}"]`);
    const item = caseData.workup[kind];
    button.disabled = false;
    button.querySelector('small').textContent = kind === 'history' ? 'Focused questions' : 'Focused examination';
    button.querySelector('b').textContent = `−${item.cost}`;
  });
  differentialInputs.forEach((input) => { input.disabled = false; });
  document.querySelectorAll('.promote-diagnosis, .clear-diagnosis').forEach((button) => { button.disabled = false; });
  hintButton.disabled = false;
  hintButton.querySelector('small').textContent = `−${caseData.scoring.hintCost} points`;
  differentialStatus.textContent = 'Select a working diagnosis from the search results.';
  updateCommitButton();
}

function renderCaseLoadError(error) {
  console.error(error);
  patientTitle.textContent = 'Case unavailable';
  patientStatus.textContent = 'ERROR';
  patientQuote.textContent = '“The chart could not be opened.”';
  contextStatus.textContent = 'LOAD ERROR';
  contextBody.innerHTML = `<div class="hpi-block"><span class="micro-label">CASE FILE</span><p>${escapeHtml(error.message)}</p><p>Serve this folder as a website, then refresh the page.</p></div>`;
  setFennick('This chart is not ready yet. Let’s not pretend otherwise.');
  differentialFeedback.className = 'differential-feedback error';
  differentialFeedback.textContent = 'The case engine could not load this case.';
}

async function bootstrapCase() {
  try {
    [caseData] = await Promise.all([loadCaseData(), loadDiagnosisPool()]);
    validateDiagnosisReferences();
    initializeStateForCase();
    renderPatientHeader();
    renderContext();
    renderLabs();
    enableCaseControls();
  } catch (error) {
    renderCaseLoadError(error);
  }
}

function getSelectedDiagnoses() {
  return differentialInputs
    .map((input) => input.dataset.diagnosisId ? { id: input.dataset.diagnosisId, label: input.value } : null)
    .filter(Boolean);
}

function getReasoningEntry(id) {
  return caseData.diagnosticReasoning.mustNotMiss.find((entry) => entry.id === id)
    || caseData.diagnosticReasoning.reasonableAlternatives.find((entry) => entry.id === id)
    || null;
}

function calculateDifferentialScore() {
  const lead = state.initialDifferential[0];
  const recognitionPoints = lead && caseData.diagnosticReasoning.earlyRecognitionIds.includes(lead.id) ? caseData.scoring.earlyRecognitionBonus : 0;
  const safetyIds = new Set(state.initialDifferential.slice(1).map((diagnosis) => diagnosis.id));
  const mustNotMissPoints = caseData.diagnosticReasoning.mustNotMiss.filter((entry) => safetyIds.has(entry.id)).length * caseData.scoring.mustNotMissBonus;
  return { recognitionPoints, mustNotMissPoints, total: recognitionPoints + mustNotMissPoints };
}

function scoreDiagnosisMatch(record, query) {
  const normalizedQuery = normalizeDiagnosis(query);
  const label = normalizeDiagnosis(record.label);
  const aliases = record.aliases.map(normalizeDiagnosis);
  const words = label.split(' ');
  if (label === normalizedQuery || aliases.includes(normalizedQuery)) return 0;
  if (label.startsWith(normalizedQuery)) return 1;
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) return 2;
  if (words.some((word) => word.startsWith(normalizedQuery))) return 3;
  if (label.includes(normalizedQuery)) return 4;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 5;
  return Infinity;
}

function hideDiagnosisResults(input) {
  const list = document.querySelector(`#${input.getAttribute('aria-controls')}`);
  list.hidden = true;
  list.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  input.dataset.activeResult = '-1';
}

function selectDiagnosis(input, record) {
  input.value = record.label;
  input.dataset.diagnosisId = record.id;
  input.classList.remove('invalid');
  hideDiagnosisResults(input);
  updateCommitButton();
}

function renderDiagnosisResults(input) {
  const query = input.value.trim();
  const list = document.querySelector(`#${input.getAttribute('aria-controls')}`);
  if (!state.diagnosesReady || !query) {
    hideDiagnosisResults(input);
    return;
  }

  const selectedElsewhere = new Set(differentialInputs.filter((candidate) => candidate !== input).map((candidate) => candidate.dataset.diagnosisId).filter(Boolean));
  const matches = diagnosisPool
    .map((record) => ({ record, score: scoreDiagnosisMatch(record, query) }))
    .filter(({ record, score }) => Number.isFinite(score) && !selectedElsewhere.has(record.id))
    .sort((a, b) => a.score - b.score || a.record.label.localeCompare(b.record.label))
    .slice(0, 8);

  list.replaceChildren();
  matches.forEach(({ record }, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'diagnosis-result';
    option.id = `${list.id}-option-${index}`;
    option.setAttribute('role', 'option');
    option.dataset.resultIndex = String(index);
    const name = document.createElement('strong');
    name.textContent = record.label;
    option.append(name);
    const matchingAlias = record.aliases.find((alias) => normalizeDiagnosis(alias).includes(normalizeDiagnosis(query)));
    if (matchingAlias) {
      const alias = document.createElement('small');
      alias.textContent = `also: ${matchingAlias}`;
      option.append(alias);
    }
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => selectDiagnosis(input, record));
    list.append(option);
  });

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'diagnosis-empty';
    empty.textContent = 'No diagnosis found in the approved pool.';
    list.append(empty);
  }
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.dataset.activeResult = '-1';
}

function handleDiagnosisKeydown(event) {
  const input = event.currentTarget;
  const list = document.querySelector(`#${input.getAttribute('aria-controls')}`);
  const options = [...list.querySelectorAll('.diagnosis-result')];
  if (list.hidden || !options.length) return;
  let activeIndex = Number(input.dataset.activeResult || -1);

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex = event.key === 'ArrowDown' ? Math.min(options.length - 1, activeIndex + 1) : Math.max(0, activeIndex - 1);
    options.forEach((option, index) => option.classList.toggle('active', index === activeIndex));
    input.dataset.activeResult = String(activeIndex);
    input.setAttribute('aria-activedescendant', options[activeIndex].id);
  } else if (event.key === 'Enter' && activeIndex >= 0) {
    event.preventDefault();
    options[activeIndex].click();
  } else if (event.key === 'Escape') {
    hideDiagnosisResults(input);
  }
}

async function loadDiagnosisPool() {
  const response = await fetch('diagnoses.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Diagnosis pool returned ${response.status}`);
  diagnosisPool = await response.json();
  if (!Array.isArray(diagnosisPool) || !diagnosisPool.every((item) => item.id && item.label && Array.isArray(item.aliases))) {
    throw new Error('Diagnosis library has an invalid format.');
  }
  state.diagnosesReady = true;
}

function unlockDiagnosticTests() {
  const testConfig = {
    labs: { detail: 'Choose tests', cost: `−${caseData.scoring.labCost} ea` },
    imaging: { detail: 'Review imaging', cost: `−${caseData.workup.imaging.cost}` }
  };

  Object.entries(testConfig).forEach(([kind, copy]) => {
    const button = document.querySelector(`[data-workup="${kind}"]`);
    button.disabled = false;
    button.classList.remove('gated');
    button.classList.add('unlocked');
    button.removeAttribute('aria-describedby');
    button.querySelector('small').textContent = copy.detail;
    button.querySelector('b').textContent = copy.cost;
  });
}

function lockInitialDifferential() {
  const diagnoses = getSelectedDiagnoses();
  const invalidInput = differentialInputs.find((input) => input.value.trim() && !input.dataset.diagnosisId);
  if (invalidInput) {
    invalidInput.classList.add('invalid');
    invalidInput.focus();
    differentialFeedback.className = 'differential-feedback error';
    differentialFeedback.textContent = 'Choose every diagnosis from the search results before continuing.';
    return;
  }
  if (!differentialInputs[0].dataset.diagnosisId) {
    differentialInputs[0].focus();
    differentialFeedback.className = 'differential-feedback error';
    differentialFeedback.textContent = 'Select one working diagnosis before beginning diagnostic testing.';
    setQuote('A laboratory cannot decide what you are looking for, Doctor. Begin with a possibility.');
    return;
  }

  state.differentialLocked = true;
  state.initialDifferential = [...diagnoses];
  differentialPanel.classList.add('locked-in');
  differentialStage.textContent = 'POST-TEST · EDITABLE';
  differentialIntro.textContent = 'Revise the working diagnosis as evidence appears. Safety differentials remain optional and can be promoted with one click.';
  differentialStatus.textContent = 'Initial snapshot saved. Labs and imaging unlocked.';
  differentialFeedback.className = 'differential-feedback success';
  differentialFeedback.textContent = `Initial reasoning recorded: ${diagnoses.map((diagnosis) => diagnosis.label).join(' · ')}`;
  unlockDiagnosticTests();
  updateCommitButton();
  setFennick('A sound starting point. Now let’s gather evidence that can genuinely move it.');
  setQuote('A structured list. Reassuring. Let us see whether the evidence is equally cooperative.');
}

function updateCommitButton() {
  const lead = differentialInputs[0];
  const invalidOptional = differentialInputs.slice(1).some((input) => input.value.trim() && !input.dataset.diagnosisId);
  const ready = state.diagnosesReady && Boolean(lead.dataset.diagnosisId) && !invalidOptional;
  differentialPrimary.disabled = !ready;
  if (!state.differentialLocked) {
    differentialPrimary.textContent = 'RECORD DIAGNOSIS & BEGIN WORKUP →';
    differentialStatus.textContent = ready ? `Ready to record: ${lead.value}` : 'Select a working diagnosis from the search results.';
    return;
  }
  differentialPrimary.textContent = ready ? `COMMIT: ${lead.value.toUpperCase()} →` : 'SELECT A WORKING DIAGNOSIS';
  differentialStatus.textContent = ready ? `Current working diagnosis: ${lead.value}` : 'Select a working diagnosis from the search results.';
}

function promoteSafetyDiagnosis(input) {
  if (!input.dataset.diagnosisId) {
    input.focus();
    return;
  }
  const lead = differentialInputs[0];
  const leadValue = lead.value;
  const leadId = lead.dataset.diagnosisId || '';
  lead.value = input.value;
  lead.dataset.diagnosisId = input.dataset.diagnosisId;
  input.value = leadValue;
  if (leadId) input.dataset.diagnosisId = leadId;
  else delete input.dataset.diagnosisId;
  lead.classList.remove('invalid');
  input.classList.remove('invalid');
  differentialInputs.forEach(hideDiagnosisResults);
  updateCommitButton();
}

function clearDiagnosis(input) {
  input.value = '';
  delete input.dataset.diagnosisId;
  input.classList.remove('invalid');
  hideDiagnosisResults(input);
  updateCommitButton();
}

function renderContext() {
  contextStatus.textContent = 'HPI + CHART';
  contextBody.innerHTML = `
    <div class="hpi-block"><span class="micro-label">HPI</span><p>${caseData.hpi}</p></div>
    <dl class="chart-list">${Object.entries(caseData.chart).map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl>`;
}

function revealWorkup(kind, button) {
  if ((kind === 'labs' || kind === 'imaging') && !state.differentialLocked) {
    differentialPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setQuote('First tell me what you believe could be happening. Then investigate it.');
    return;
  }
  if (kind === 'labs') {
    openLabs();
    return;
  }

  const item = caseData.workup[kind];
  if (!state.diagnosisCorrect && !state.revealed.has(kind)) {
    state.revealed.add(kind);
    spendJudgment(item.cost);
  }

  button.classList.add('used');
  logEvidence(kind, item.title, item.text);
  if (!state.diagnosisCorrect) {
    setQuote(item.quote);
    setFennick(item.fennick);
  } else {
    setEvidenceCollapsed(false);
    setFennick(`Of course. Let’s revisit the ${item.title.toLowerCase()}—review never costs points.`);
  }
  document.querySelector(`[data-evidence="${kind}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openLabs() {
  if (!state.differentialLocked) return;
  labDrawer.classList.add('open');
  labDrawer.setAttribute('aria-hidden', 'false');
  document.querySelector('[data-workup="labs"]').classList.add('used');
  if (!state.diagnosisCorrect) {
    setQuote('More blood, then? I trust each tube has a purpose beyond decorating the laboratory.');
    setFennick('Choose the tests that separate the possibilities—not merely the ones that are available.');
  } else {
    setFennick('Everything is open for review now. Take your time; no points are spent here.');
  }
  requestAnimationFrame(() => labDrawer.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function closeLabs(announce = true) {
  labDrawer.classList.remove('open');
  labDrawer.setAttribute('aria-hidden', 'true');
  if (announce && !state.diagnosisCorrect) setQuote('Finished with the laboratory? Then tell me what the results actually changed.');
}

function renderLabs() {
  labGrid.innerHTML = '';
  caseData.labs.forEach((lab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lab-button${state.orderedLabs.has(lab.name) ? ' ordered' : ''}`;
    if (state.diagnosisCorrect) {
      button.classList.add('reviewable');
      button.innerHTML = `<span>${lab.name}</span><small class="lab-status ${lab.status}">${lab.status.toUpperCase()}</small>`;
    } else {
      button.textContent = state.orderedLabs.has(lab.name) ? `${lab.name} ✓` : `${lab.name}  −${caseData.scoring.labCost}`;
    }
    button.addEventListener('click', () => orderLab(lab));
    labGrid.append(button);
  });
}

function orderLab(lab) {
  if (!state.differentialLocked) return;
  if (!state.diagnosisCorrect && !state.orderedLabs.has(lab.name)) {
    state.orderedLabs.add(lab.name);
    spendJudgment(caseData.scoring.labCost);
  }

  renderLabs();
  labResult.innerHTML = `<div class="lab-result-heading"><strong>${lab.name}</strong><span class="lab-status ${lab.status}">${lab.status.toUpperCase()}</span></div>${lab.result}`;
  logEvidence(`lab-${lab.name}`, `LAB · ${lab.name}`, lab.result);
  if (!state.diagnosisCorrect) setQuote(lab.remark);

  if (state.diagnosisCorrect) {
    setFennick(`Let’s look at ${lab.name} again. No points spent—only a second look.`);
  } else if (lab.fennick) {
    setFennick(lab.fennick);
  } else {
    setFennick('Useful. That narrows the room a little. What are you chasing next?');
  }
}

function switchView(view) {
  if (view === 'management' && !state.diagnosisCorrect) return;
  state.activeView = view;
  closeLabs(false);

  const showingCase = view === 'case';
  presentationStream.hidden = false;
  phaseWorkspace.classList.toggle('open', state.diagnosisCorrect);
  caseTab.classList.toggle('active', showingCase);
  managementTab.classList.toggle('active', !showingCase);
  caseTab.setAttribute('aria-pressed', String(showingCase));
  managementTab.setAttribute('aria-pressed', String(!showingCase));
  requestAnimationFrame(() => {
    const destination = showingCase ? 0 : phaseWorkspace.offsetTop;
    boardScroll.scrollTo({ top: destination, behavior: 'smooth' });
  });
}

function setEvidenceCollapsed(collapsed) {
  evidenceLog.classList.toggle('collapsed', collapsed);
  evidenceToggle.setAttribute('aria-expanded', String(!collapsed));
}

function lockDiagnosticWork() {
  document.querySelectorAll('.differential-input, .promote-diagnosis, .clear-diagnosis, #differential-primary').forEach((button) => {
    button.disabled = true;
  });
}

function enableInvestigationReview() {
  const reviewCopy = {
    history: ['Review findings', 'FREE'],
    exam: ['Review findings', 'FREE'],
    labs: ['Review all results', 'FREE'],
    imaging: ['Review result', 'FREE']
  };
  document.querySelectorAll('.workup-card').forEach((button) => {
    const [detail, cost] = reviewCopy[button.dataset.workup];
    button.disabled = false;
    button.classList.remove('gated');
    button.classList.add('review-mode');
    button.querySelector('small').textContent = detail;
    button.querySelector('b').textContent = cost;
  });
  renderLabs();
}

function commitLeadingDiagnosis() {
  const diagnoses = getSelectedDiagnoses();
  const lead = diagnoses[0];
  if (!lead || !differentialInputs[0].dataset.diagnosisId) {
    differentialInputs[0].focus();
    return;
  }

  state.finalDiagnosis = lead.label;
  state.finalDifferential = [...diagnoses];

  if (lead.id !== caseData.diagnosticReasoning.finalDiagnosisId) {
    spendJudgment(caseData.scoring.wrongDiagnosisCost);
    state.wrongAnswers += 1;
    differentialFeedback.className = 'differential-feedback error';
    differentialFeedback.textContent = caseData.diagnosticReasoning.finalFeedback[lead.id]
      || `${lead.label} was reasonable to consider, but it does not best explain the complete evidence. Revise the working diagnosis and try again.`;
    setFennick(caseData.fenn.diagnosisWrong);
    setQuote(caseData.diagnosticReasoning.patientWrong);
    return;
  }

  differentialFeedback.className = 'differential-feedback success';
  differentialFeedback.textContent = caseData.diagnosticReasoning.correctFeedback;
  state.diagnosisCorrect = true;
  managementTab.disabled = false;
  managementTab.classList.remove('locked');
  lockDiagnosticWork();
  enableInvestigationReview();
  setEvidenceCollapsed(true);
  const diagnosisRemark = setQuote(caseData.diagnosticReasoning.patientCorrect);
  setFennick(caseData.fenn.diagnosisCorrect);
  continueAfterQuote(diagnosisRemark, () => renderManagement(0));
}

function handleDifferentialPrimary() {
  if (!state.differentialLocked) lockInitialDifferential();
  else commitLeadingDiagnosis();
}

function renderManagement(stageIndex, { announce = true } = {}) {
  state.managementViewStage = stageIndex;
  state.phase = 'management';
  scene.className = 'scene phase-management';
  const stage = caseData.management[stageIndex];
  const history = state.managementHistory[stageIndex];
  const reviewing = history.completed;
  if (stage.staffUpdate && announce && !reviewing) updateVitals(stage.staffUpdate.vitals);
  phaseWorkspace.innerHTML = `
    <span class="phase-kicker">04 / MANAGEMENT · DECISION ${stageIndex + 1} OF ${caseData.management.length}${reviewing ? ' · REVIEW' : ''}</span>
    <h2>${stage.title}</h2>
    <div class="management-progress">${caseData.management.map((_, index) => `<span class="${state.managementHistory[index].completed ? 'done' : index === state.managementStage ? 'active' : ''}"></span>`).join('')}</div>
    ${stage.staffUpdate ? `<aside class="staff-update" aria-label="${escapeHtml(stage.staffUpdate.type)}">
      <div class="staff-update-copy"><span>${escapeHtml(stage.staffUpdate.type)}</span><strong>${escapeHtml(stage.staffUpdate.name)}</strong><small>${escapeHtml(stage.staffUpdate.role)}</small><p>${escapeHtml(stage.staffUpdate.message)}</p></div>
      <div class="staff-portrait-placeholder" aria-label="Replaceable staff portrait placeholder"><i></i><b>RN</b></div>
    </aside>` : ''}
    <p>${stage.prompt}</p>
    ${reviewing ? '<p class="review-note">Review mode — select any answer to revisit its rationale.</p>' : ''}
    <div class="option-grid" id="option-grid"></div>
    <div id="management-feedback"></div>
    <div class="management-navigation" id="management-navigation"></div>`;

  const grid = document.querySelector('#option-grid');
  stage.options.forEach((option, optionIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `option-button${reviewing && option.correct ? ' correct' : ''}${reviewing && history.attempted.has(optionIndex) && !option.correct ? ' wrong' : ''}`;
    button.textContent = option.text;
    button.addEventListener('click', () => reviewing ? reviewManagementOption(optionIndex) : chooseManagement(optionIndex));
    grid.append(button);
  });
  renderManagementNavigation(stageIndex);
  switchView('management');
  if (announce) setQuote(stage.promptRemark);
}

function renderManagementNavigation(stageIndex) {
  const navigation = document.querySelector('#management-navigation');
  if (!navigation) return;

  if (stageIndex > 0) {
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'secondary-button';
    previous.textContent = '← PREVIOUS DECISION';
    previous.addEventListener('click', () => renderManagement(stageIndex - 1, { announce: false }));
    navigation.append(previous);
  }

  if (stageIndex < state.managementStage) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'secondary-button';
    next.textContent = 'NEXT DECISION →';
    next.addEventListener('click', () => renderManagement(stageIndex + 1, { announce: false }));
    navigation.append(next);
  } else if (state.managementComplete && stageIndex === caseData.management.length - 1) {
    const review = document.createElement('button');
    review.type = 'button';
    review.className = 'primary-button';
    review.textContent = 'RETURN TO CASE REVIEW →';
    review.addEventListener('click', renderDebrief);
    navigation.append(review);
  }
}

function reviewManagementOption(optionIndex) {
  const stage = caseData.management[state.managementViewStage];
  const option = stage.options[optionIndex];
  const buttons = [...document.querySelectorAll('.option-button')];
  const feedback = document.querySelector('#management-feedback');
  buttons.forEach((button, index) => button.classList.toggle('reviewing', index === optionIndex));
  buttons[optionIndex].classList.add(option.correct ? 'correct' : 'wrong');
  feedback.className = `feedback-card ${option.correct ? 'correct' : 'wrong'}`;
  feedback.textContent = option.feedback;
}

function chooseManagement(optionIndex) {
  if (state.managementViewStage !== state.managementStage) return;
  const stage = caseData.management[state.managementStage];
  const history = state.managementHistory[state.managementStage];
  const option = stage.options[optionIndex];
  const buttons = [...document.querySelectorAll('.option-button')];
  const feedback = document.querySelector('#management-feedback');

  if (!option.correct) {
    if (!history.attempted.has(optionIndex)) {
      spendJudgment(caseData.scoring.wrongManagementCost);
      state.wrongAnswers += 1;
      history.attempted.add(optionIndex);
    }
    buttons[optionIndex].classList.add('wrong');
    feedback.className = 'feedback-card wrong';
    feedback.textContent = option.feedback;
    setFennick(`Let’s pause there. ${option.feedback}`);
    setQuote(option.patientWrong);
    return;
  }

  history.attempted.add(optionIndex);
  history.correctIndex = optionIndex;
  history.completed = true;
  buttons.forEach((button) => { button.disabled = true; });
  buttons[optionIndex].classList.add('correct');
  feedback.className = 'feedback-card correct';
  feedback.textContent = option.feedback;
  updateVitals(stage.vitals);
  const patientResponse = setQuote(option.patientCorrect || stage.quote);
  setFennick(stage.fennick);

  const lastStage = state.managementStage === caseData.management.length - 1;
  const advanceNotice = document.createElement('p');
  advanceNotice.className = 'advance-notice';
  advanceNotice.textContent = lastStage ? 'Preparing case review after the patient finishes…' : 'Next decision opens after the patient finishes…';
  feedback.after(advanceNotice);
  continueAfterQuote(patientResponse, () => {
    if (lastStage) {
      state.managementComplete = true;
      renderDebrief();
    } else {
      state.managementStage += 1;
      renderManagement(state.managementStage);
    }
  }, 2500);
}

function updateVitals(nextVitals) {
  Object.entries(nextVitals).forEach(([key, value]) => {
    const element = document.querySelector(`[data-vital="${key}"]`);
    if (element) {
      element.textContent = value;
      element.closest('.vital').classList.remove('critical');
    }
  });
}

function renderDebrief() {
  state.managementComplete = true;
  state.phase = 'debrief';
  scene.className = 'scene phase-debrief';
  const differentialScore = calculateDifferentialScore();
  const initialDifferential = state.initialDifferential.length ? state.initialDifferential.map((diagnosis) => escapeHtml(diagnosis.label)).join(' · ') : 'No initial reasoning recorded.';
  const finalDifferential = state.finalDifferential.length ? state.finalDifferential.map((diagnosis) => escapeHtml(diagnosis.label)).join(' · ') : escapeHtml(state.finalDiagnosis);
  const initialLead = state.initialDifferential[0];
  const leadFeedback = initialLead && caseData.diagnosticReasoning.earlyRecognitionIds.includes(initialLead.id)
    ? caseData.diagnosticReasoning.earlyRecognitionFeedback
    : initialLead && getReasoningEntry(initialLead.id)
      ? `${initialLead.label} was a reasonable alternative, but it was not the strongest initial explanation.`
      : 'The initial working diagnosis was not one of this case’s key supported possibilities.';
  const safetyFeedback = state.initialDifferential.slice(1).map((diagnosis) => {
    const mustNotMiss = caseData.diagnosticReasoning.mustNotMiss.find((entry) => entry.id === diagnosis.id);
    const reasonable = caseData.diagnosticReasoning.reasonableAlternatives.find((entry) => entry.id === diagnosis.id);
    if (mustNotMiss) return `<li><strong>${escapeHtml(diagnosis.label)} <em>+${caseData.scoring.mustNotMissBonus} must-not-miss</em></strong><span>${escapeHtml(mustNotMiss.feedback)}</span></li>`;
    if (reasonable) return `<li><strong>${escapeHtml(diagnosis.label)}</strong><span>${escapeHtml(reasonable.feedback)}</span></li>`;
    return `<li><strong>${escapeHtml(diagnosis.label)}</strong><span>Not one of this case’s key teaching alternatives; review which available findings supported or opposed it.</span></li>`;
  }).join('');
  phaseWorkspace.innerHTML = `
    <span class="phase-kicker">05 / DEBRIEF</span>
    <h2>${escapeHtml(caseData.debrief.title)}</h2>
    <div class="debrief-grid">
      <div class="debrief-stat"><strong>${state.judgment}</strong><span>CASE SCORE</span></div>
      <div class="debrief-stat"><strong>${state.orderedLabs.size}</strong><span>LABS ORDERED</span></div>
      <div class="debrief-stat"><strong>${state.wrongAnswers}</strong><span>INCORRECT DECISIONS</span></div>
      <div class="debrief-stat"><strong>+${differentialScore.total}</strong><span>DIFFERENTIAL BONUS</span></div>
    </div>
    <div class="debrief-card">
      <strong>Clinical reasoning review</strong><br>
      Initial: ${initialDifferential}<br>
      Final: ${finalDifferential}
      <div class="reasoning-verdict"><b>${initialLead ? escapeHtml(initialLead.label) : 'No working diagnosis'}</b><span>${escapeHtml(leadFeedback)}</span></div>
      ${safetyFeedback ? `<ul class="reasoning-list">${safetyFeedback}</ul>` : '<p class="reasoning-empty">No safety differential was recorded. Optional—but dangerous alternatives can earn case-specific bonuses.</p>'}
      <div class="reasoning-score">Early recognition +${differentialScore.recognitionPoints} · Must-not-miss +${differentialScore.mustNotMissPoints}</div>
    </div>
    <div class="debrief-card">
      <strong>Clinical pearl</strong><br>
      ${escapeHtml(caseData.debrief.pearl)}
    </div>
    <div class="phase-actions"><button class="secondary-button" id="review-management" type="button">← REVIEW MANAGEMENT</button><button class="secondary-button" id="restart-case" type="button">RESTART CASE</button></div>`;
  switchView('management');
  setFennick(caseData.fenn.debrief);
  document.querySelector('#review-management').addEventListener('click', () => renderManagement(caseData.management.length - 1, { announce: false }));
  document.querySelector('#restart-case').addEventListener('click', () => window.location.reload());
}

document.querySelectorAll('.workup-card').forEach((button) => button.addEventListener('click', () => revealWorkup(button.dataset.workup, button)));
document.querySelector('#lab-close').addEventListener('click', () => closeLabs(true));
differentialPrimary.addEventListener('click', handleDifferentialPrimary);
differentialInputs.forEach((input) => {
  input.addEventListener('input', () => {
    delete input.dataset.diagnosisId;
    input.classList.remove('invalid');
    renderDiagnosisResults(input);
    updateCommitButton();
  });
  input.addEventListener('focus', () => renderDiagnosisResults(input));
  input.addEventListener('keydown', handleDiagnosisKeydown);
  input.addEventListener('blur', () => window.setTimeout(() => hideDiagnosisResults(input), 120));
});
document.querySelectorAll('[data-promote]').forEach((button) => button.addEventListener('click', () => {
  promoteSafetyDiagnosis(button.closest('.differential-row').querySelector('.differential-input'));
}));
document.querySelectorAll('[data-clear]').forEach((button) => button.addEventListener('click', () => {
  clearDiagnosis(button.closest('.differential-row').querySelector('.differential-input'));
}));
caseTab.addEventListener('click', () => switchView('case'));
managementTab.addEventListener('click', () => switchView('management'));
evidenceToggle.addEventListener('click', () => setEvidenceCollapsed(!evidenceLog.classList.contains('collapsed')));
hintButton.addEventListener('click', () => {
  if (!caseData) return;
  spendJudgment(caseData.scoring.hintCost);
  const hint = caseData.hints[state.hints % caseData.hints.length];
  setFennick(hint.fenn);
  setQuote(hint.patient);
  state.hints += 1;
});

bootstrapCase();

const rainCanvas = document.querySelector('#rain-canvas');
const rainContext = rainCanvas.getContext('2d', { alpha: true });
let rainSeed = 91357;
const random = () => {
  rainSeed = (rainSeed * 16807) % 2147483647;
  return (rainSeed - 1) / 2147483646;
};

const rainDrops = Array.from({ length: 58 }, () => ({
  x: random() * rainCanvas.width,
  y: random() * rainCanvas.height,
  length: 3 + Math.floor(random() * 6),
  speed: 1.4 + random() * 3.2,
  alpha: .24 + random() * .34,
  drift: .14 + random() * .28
}));

let lastRainFrame = 0;
let rainFrameCount = 0;

function drawRain(time) {
  if (time - lastRainFrame >= 76) {
    lastRainFrame = time;
    rainFrameCount += 1;
    rainCanvas.dataset.frame = String(rainFrameCount);
    rainContext.clearRect(0, 0, rainCanvas.width, rainCanvas.height);

    rainDrops.forEach((drop) => {
      drop.y += drop.speed;
      drop.x += drop.drift;
      if (drop.y > rainCanvas.height + drop.length || drop.x > rainCanvas.width + 3) {
        drop.x = random() * rainCanvas.width - 7;
        drop.y = -drop.length - random() * 28;
      }

      const x = Math.round(drop.x);
      const y = Math.round(drop.y);
      const split = Math.max(1, Math.floor(drop.length * .58));
      rainContext.fillStyle = `rgba(115, 191, 231, ${drop.alpha})`;
      rainContext.fillRect(x, y, 1, split);
      rainContext.fillStyle = `rgba(183, 226, 246, ${Math.min(drop.alpha + .12, .72)})`;
      rainContext.fillRect(x + 1, y + split, 1, drop.length - split);
    });
  }
  requestAnimationFrame(drawRain);
}

requestAnimationFrame(drawRain);
