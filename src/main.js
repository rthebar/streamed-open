import { fetchScoresForCategory, findScore, getScoreDetail, SCORE_SOURCES } from './scores.js';
import { getSportIcon } from './sportIcons.js';

const API_BASE = 'https://streamed.pk';

// State
const state = {
  currentView: 'live',
  currentSport: null,
  matches: [],
  sports: [],
  loading: false,
  error: null,
  searchQuery: '',
  scoresMap: null,
  activeSources: null,
};

// DOM refs
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

const dom = {
  navTabs: $$('.nav-tab'),
  sportsList: $('#sportsList'),
  matchesGrid: $('#matchesGrid'),
  contentTitle: $('#contentTitle'),
  matchCount: $('#matchCount'),
  loadingState: $('#loadingState'),
  refreshBtn: $('#refreshBtn'),
  searchInput: $('#searchInput'),
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebarToggle'),
  liveCount: $('#liveCount'),
  sidebarAttribution: $('#sidebarAttribution'),

  modal: $('#streamModal'),
  modalTitle: $('#modalTitle'),
  modalCategory: $('#modalCategory'),
  modalClose: $('#modalClose'),
  streamContainer: $('#streamContainer'),
  sourceTabs: $('#sourceTabs'),
  streamList: $('#streamList'),
  toastContainer: $('#toastContainer'),
};

// API
async function apiFetch(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

function fetchSports() {
  return apiFetch('/api/sports');
}

function fetchMatches(view, sport) {
  let path;
  if (sport && sport !== 'all' && sport !== 'live') {
    path = view === 'popular' ? `/api/matches/${sport}/popular` : `/api/matches/${sport}`;
  } else if (sport === 'all' || view === 'all') {
    path = view === 'popular' ? '/api/matches/all/popular' : '/api/matches/all';
  } else if (view === 'today') {
    path = '/api/matches/all-today';
  } else {
    path = '/api/matches/live';
  }
  return apiFetch(path);
}

function fetchStreams(source, id) {
  return apiFetch(`/api/stream/${source}/${id}`);
}

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function parseScore(title) {
  const m = title.match(/(\d+)\s*[-–:]\s*(\d+)/);
  return m ? { home: m[1], away: m[2] } : null;
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMatchTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const SPORT_TIMING = {
  football: { periods: 2, periodLen: 45, extraLen: 15, type: 'mins' },
  basketball: { periods: 4, periodLen: 12, type: 'quarter' },
  hockey: { periods: 3, periodLen: 20, type: 'mins' },
  tennis: { type: 'sets' },
  cricket: { type: 'overs', maxOvers: 50 },
  baseball: { periods: 9, type: 'inning' },
  'motor-sports': { type: 'laps', totalLaps: 58 },
  mma: { periods: 5, periodLen: 5, type: 'round' },
  boxing: { periods: 12, periodLen: 3, type: 'round' },
  rugby: { periods: 2, periodLen: 40, type: 'mins' },
  'american-football': { periods: 4, periodLen: 15, type: 'quarter' },
  golf: { type: 'rounds', totalRounds: 4 },
  darts: { type: 'legs' },
};

function getSportTimeInfo(category, matchDate) {
  const now = Date.now();
  const elapsed = now - matchDate;
  const elapsedSec = Math.floor(elapsed / 1000);
  const elapsedMin = Math.floor(elapsedSec / 60);

  if (elapsed < -3600000) {
    return { status: 'upcoming', label: formatMatchTime(matchDate) };
  }

  if (elapsed < 0) {
    return { status: 'upcoming', label: 'Starting soon' };
  }

  if (elapsed > 14400000) {
    return { status: 'finished', label: 'Finished' };
  }

  const config = SPORT_TIMING[category];
  if (!config) {
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    return { status: 'live', label: h > 0 ? `${h}h ${m}m` : `${m}m` };
  }

  if (config.type === 'mins') {
    const totalGameMin = config.periods * config.periodLen;
    const min = Math.min(elapsedMin, totalGameMin + (config.extraLen || 0));
    const stoppage = elapsedMin > totalGameMin ? `+${elapsedMin - totalGameMin}` : '';
    return { status: 'live', label: `${min}'`, detail: stoppage };
  }

  if (config.type === 'quarter') {
    const periodMin = config.periodLen;
    const currentPeriod = Math.min(Math.floor(elapsedMin / periodMin) + 1, config.periods);
    const timeInPeriod = elapsedMin % periodMin;
    const remaining = Math.max(0, periodMin - timeInPeriod);
    const mins = Math.floor(remaining);
    const secs = Math.floor((remaining - mins) * 60);
    return { status: 'live', label: `Q${currentPeriod} ${mins}:${String(secs).padStart(2, '0')}` };
  }

  if (config.type === 'overs') {
    const totalBalls = Math.floor(elapsedSec / 6);
    const overs = Math.min(Math.floor(totalBalls / 6), config.maxOvers);
    const balls = totalBalls % 6;
    return { status: 'live', label: `Ov ${overs}.${balls}` };
  }

  if (config.type === 'inning') {
    const innMin = 20;
    const currentInning = Math.min(Math.floor(elapsedMin / innMin) + 1, config.periods * 2);
    const half = currentInning % 2 === 1 ? 'Top' : 'Bot';
    const inn = Math.ceil(currentInning / 2);
    return { status: 'live', label: `${half} ${inn}` };
  }

  if (config.type === 'laps') {
    const lapTime = 80;
    const lap = Math.min(Math.floor(elapsedSec / lapTime) + 1, config.totalLaps);
    return { status: 'live', label: `Lap ${lap}/${config.totalLaps}` };
  }

  if (config.type === 'round') {
    const roundSec = config.periodLen * 60;
    const round = Math.min(Math.floor(elapsedSec / roundSec) + 1, config.periods);
    const timeInRound = Math.floor((elapsedSec % roundSec) / 60);
    return { status: 'live', label: `R${round} ${timeInRound}:${String(Math.floor((elapsedSec % 60))).padStart(2, '0')}` };
  }

  if (config.type === 'sets') {
    return { status: 'live', label: 'In Progress' };
  }

  return { status: 'live', label: 'LIVE' };
}

function getMatchStatus(match) {
  const now = Date.now();
  if (now - match.date < 0) return 'upcoming';
  if (now - match.date > 14400000) return 'finished';
  return 'live';
}

// Render functions
function renderAttribution() {
  const el = dom.sidebarAttribution;
  if (!el) return;
  if (state.activeSources && state.activeSources.size > 0) {
    const parts = [];
    state.activeSources.forEach((src) => {
      const info = SCORE_SOURCES[src] || { label: src, url: '#' };
      parts.push(`<a href="${info.url}" target="_blank" rel="noopener">${info.label}</a>`);
    });
    el.innerHTML = `Scores: ${parts.join(', ')}`;
  } else {
    el.innerHTML = '';
  }
}

function renderSports(sports) {
  const existing = $$('.sport-item:not([data-sport="live"]):not([data-sport="all"])', dom.sportsList);
  existing.forEach((el) => el.remove());

  const sorted = [...sports].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((sport) => {
    const li = document.createElement('li');
    li.className = 'sport-item';
    li.dataset.sport = sport.id;
    li.dataset.label = `${escapeHtml(sport.name)} Matches`;
    li.innerHTML = `
      <span class="sport-icon">${getSportIcon(sport.id)}</span>
      <span class="sport-name">${escapeHtml(sport.name)}</span>
    `;
    li.addEventListener('click', () => selectSport(sport.id, `${sport.name} Matches`));
    dom.sportsList.appendChild(li);
  });
}

function renderMatches(matches) {
  dom.matchesGrid.innerHTML = '';

  if (state.loading) {
    dom.matchesGrid.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading matches...</p>
      </div>
    `;
    return;
  }

  if (state.error) {
    dom.matchesGrid.innerHTML = `
      <div class="error-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3>Failed to load matches</h3>
        <p>${escapeHtml(state.error)}</p>
        <button onclick="window.location.reload()">Try Again</button>
      </div>
    `;
    return;
  }

  if (!matches || matches.length === 0) {
    dom.matchesGrid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <h3>No matches found</h3>
        <p>Try a different category or check back later</p>
      </div>
    `;
    return;
  }

  const filtered = state.searchQuery
    ? matches.filter(
        (m) =>
          m.title.toLowerCase().includes(state.searchQuery) ||
          (m.teams?.home?.name || '').toLowerCase().includes(state.searchQuery) ||
          (m.teams?.away?.name || '').toLowerCase().includes(state.searchQuery)
      )
    : matches;

  if (filtered.length === 0) {
    dom.matchesGrid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <h3>No matches match your search</h3>
        <p>Try different keywords</p>
      </div>
    `;
    return;
  }

  dom.matchCount.textContent = `${filtered.length} match${filtered.length !== 1 ? 'es' : ''}`;

  filtered.forEach((match, i) => {
    const card = createMatchCard(match, i);
    dom.matchesGrid.appendChild(card);
  });

  if (filtered.length > 0) {
    startTimers();
  }
}

function getPosterUrl(match) {
  if (!match.poster) return null;
  if (match.poster.startsWith('http')) return match.poster;
  if (match.poster.startsWith('/')) return `${API_BASE}${match.poster}`;
  return `${API_BASE}/api/images/proxy/${match.poster}${match.poster.endsWith('.webp') ? '' : '.webp'}`;
}

function determineMatchLayout(match) {
  const hasHome = !!match.teams?.home?.name;
  const hasAway = !!match.teams?.away?.name;

  if (hasHome && hasAway) {
    return {
      type: 'team-vs-team',
      home: { name: match.teams.home.name, badge: match.teams.home.badge },
      away: { name: match.teams.away.name, badge: match.teams.away.badge },
    };
  }

  if (hasHome) {
    return {
      type: 'team-vs-team',
      home: { name: match.teams.home.name, badge: match.teams.home.badge },
      away: null,
    };
  }

  if (hasAway) {
    return {
      type: 'team-vs-team',
      home: null,
      away: { name: match.teams.away.name, badge: match.teams.away.badge },
    };
  }

  const vsMatch = match.title.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (vsMatch) {
    const home = vsMatch[1].trim().replace(/\s+\d+[-–:]\d+.*$/, '').trim();
    const away = vsMatch[2].trim().replace(/\s+\d+[-–:]\d+.*$/, '').trim();
    return {
      type: 'team-vs-team',
      home: { name: home, badge: null },
      away: { name: away, badge: null },
    };
  }

  return { type: 'single' };
}

function createMatchCard(match, index) {
  const card = document.createElement('div');
  card.style.animationDelay = `${(index % 10) * 0.03}s`;

  const status = getMatchStatus(match);
  const score = parseScore(match.title);
  const timeInfo = status === 'live' ? getSportTimeInfo(match.category, match.date) : null;
  const layout = determineMatchLayout(match);
  const posterUrl = getPosterUrl(match);

  const badgeUrl = (badge) =>
    badge ? `${API_BASE}/api/images/badge/${badge}.webp` : null;

  // Shared header
  const headerHtml = `
    <div class="match-card-header">
      <div class="match-badges">
        ${status === 'live' ? '<span class="badge badge-live"><span class="badge-dot"></span>LIVE</span>' : ''}
        ${status === 'upcoming' ? '<span class="badge badge-upcoming">Upcoming</span>' : ''}
        ${match.popular ? '<span class="badge badge-popular">Popular</span>' : ''}
        <span class="badge badge-sport">${escapeHtml(match.category)}</span>
      </div>
      <span class="match-time" data-date="${match.date}">${status === 'live' && timeInfo ? timeInfo.label : match.date ? formatDate(match.date) : ''}</span>
    </div>
  `;

  const footerHtml = `
    <div class="match-card-footer">
      <span class="match-date" data-date="${match.date}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${formatDate(match.date)}
      </span>
      ${match.sources && match.sources.length > 0
        ? `<span class="match-sources-count">${match.sources.length} source${match.sources.length > 1 ? 's' : ''}</span>`
        : ''
      }
      <button class="watch-btn">Watch</button>
    </div>
  `;

  const posterClass = posterUrl ? ' has-poster' : '';

  if (layout.type === 'single') {
    card.className = `match-card single-entity${posterClass}`;

    card.innerHTML = `
      ${posterUrl ? `<img class="card-poster" src="${posterUrl}" alt="${escapeHtml(match.title)}" loading="lazy" onerror="this.style.display='none'" />` : ''}
      <div class="card-body">
        ${headerHtml}
        <div class="event-title">${escapeHtml(match.title)}</div>
        <div class="match-status-line${status === 'live' ? ' status-live' : status === 'upcoming' ? ' status-upcoming' : ' status-finished'}" data-timer="${match.id}"${status === 'live' && timeInfo ? `>${timeInfo.label}${timeInfo.detail ? ' ' + timeInfo.detail : ''}` : status === 'upcoming' ? `>${formatMatchTime(match.date)}` : ` style="display:none">`}</div>
        ${footerHtml}
      </div>
    `;
  } else {
    card.className = `match-card${posterClass}`;

    const home = layout.home;
    const away = layout.away;
    const homeName = home?.name || '';
    const awayName = away?.name || '';
    const homeBadge = badgeUrl(home?.badge);
    const awayBadge = badgeUrl(away?.badge);
    const homeInitial = homeName ? homeName.charAt(0).toUpperCase() : '?';
    const awayInitial = awayName ? awayName.charAt(0).toUpperCase() : '?';

    card.innerHTML = `
      ${posterUrl ? `<img class="card-poster" src="${posterUrl}" alt="${escapeHtml(match.title)}" loading="lazy" onerror="this.style.display='none'" />` : ''}
      <div class="card-body">
        ${headerHtml}
        <div class="match-teams">
          <div class="team">
            ${homeBadge
              ? `<img class="team-badge" src="${homeBadge}" alt="${escapeHtml(homeName)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="team-badge-placeholder" style="display:none">${escapeHtml(homeInitial)}</div>`
              : `<div class="team-badge-placeholder">${escapeHtml(homeInitial)}</div>`
            }
            <span class="team-name">${escapeHtml(homeName)}</span>
          </div>

          <div class="match-score-display">
            <span class="score ${score ? 'has-score' : ''}">${score ? `${escapeHtml(score.home)}-${escapeHtml(score.away)}` : ''}</span>
          </div>

          <div class="team">
            ${awayBadge
              ? `<img class="team-badge" src="${awayBadge}" alt="${escapeHtml(awayName)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="team-badge-placeholder" style="display:none">${escapeHtml(awayInitial)}</div>`
              : `<div class="team-badge-placeholder">${escapeHtml(awayInitial)}</div>`
            }
            <span class="team-name">${escapeHtml(awayName)}</span>
          </div>
        </div>

        <div class="match-status-line${status === 'live' ? ' status-live' : status === 'upcoming' ? ' status-upcoming' : ' status-finished'}" data-timer="${match.id}"${status === 'live' && timeInfo ? `>${timeInfo.label}${timeInfo.detail ? ' ' + timeInfo.detail : ''}` : status === 'upcoming' ? `>${formatMatchTime(match.date)}` : ` style="display:none">`}</div>

        ${footerHtml}
      </div>
    `;
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.watch-btn')) {
      openStreamModal(match);
    }
  });

  card.dataset.matchId = match.id;
  card.dataset.category = match.category;

  // Apply score if already fetched
  if (state.scoresMap) {
    const s = state.scoresMap.get(match.id);
    if (s) {
      updateCardScore(card, s);
    }
  }

  return card;
}

// Stream Modal
async function openStreamModal(match) {
  dom.modalTitle.textContent = match.title;
  dom.modalCategory.textContent = match.category;
  dom.streamContainer.innerHTML = `
    <div class="stream-placeholder">
      <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
      <p>Select a source below to watch</p>
    </div>
  `;
  dom.streamList.innerHTML = '';

  if (!match.sources || match.sources.length === 0) {
    dom.sourceTabs.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No stream sources available</p>';
    dom.modal.classList.add('open');
    return;
  }

  dom.sourceTabs.innerHTML = match.sources
    .map(
      (s, i) =>
        `<button class="source-tab ${i === 0 ? 'active' : ''}" data-source="${escapeHtml(s.source)}" data-id="${escapeHtml(s.id)}">${escapeHtml(s.source)}</button>`
    )
    .join('');

  $$('.source-tab', dom.sourceTabs).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.source-tab', dom.sourceTabs).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadStreams(btn.dataset.source, btn.dataset.id);
    });
  });

  dom.modal.classList.add('open');

  // Load first source
  const first = match.sources[0];
  loadStreams(first.source, first.id);
}

async function loadStreams(source, id) {
  dom.streamList.innerHTML = '<div class="loading-state" style="padding:20px"><div class="spinner"></div><p>Loading streams...</p></div>';

  try {
    const streams = await fetchStreams(source, id);
    dom.streamList.innerHTML = '';

    if (!streams || streams.length === 0) {
      dom.streamList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No streams available for this source</p>';
      return;
    }

    streams.forEach((stream) => {
      const item = document.createElement('div');
      item.className = 'stream-item';
      item.innerHTML = `
        <div class="stream-item-info">
          <span class="stream-language">${escapeHtml(stream.language) || 'Unknown'}</span>
          ${stream.hd ? '<span class="stream-hd">HD</span>' : ''}
          ${stream.streamNo ? `<span style="font-size:0.78rem;color:var(--text-muted)">#${stream.streamNo}</span>` : ''}
        </div>
        <button class="play-btn" data-embed="${stream.embedUrl || ''}">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Play
        </button>
      `;

      item.querySelector('.play-btn').addEventListener('click', () => {
        const embedUrl = stream.embedUrl;
        if (embedUrl) {
          dom.streamContainer.innerHTML = `<iframe src="${embedUrl}" allowfullscreen loading="lazy"></iframe>`;
        } else {
          showToast('Stream URL not available', 'error');
        }
      });

      dom.streamList.appendChild(item);
    });
  } catch (err) {
    dom.streamList.innerHTML = `<p style="color:var(--red);text-align:center;padding:20px">Failed to load streams: ${err.message}</p>`;
  }
}

// Toast
function showToast(msg, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Timers
let timerInterval = null;
let scoreRefreshCount = 0;

function startTimers() {
  if (timerInterval) clearInterval(timerInterval);
  scoreRefreshCount = 0;
  timerInterval = setInterval(updateTimers, 1000);
}

function updateTimers() {
  if (state.matches.length === 0) return;

  const timeEls = $$('[data-date]');
  const timerEls = $$('[data-timer]');

  timeEls.forEach((el) => {
    const date = parseInt(el.dataset.date);
    if (!isNaN(date)) {
      const elapsed = Date.now() - date;
      if (elapsed > 0 && elapsed < 14400000) {
        el.textContent = formatElapsed(elapsed);
      }
    }
  });

  timerEls.forEach((el) => {
    if (el.dataset.scoreSourced === 'true') return;
    const matchId = el.dataset.timer;
    const match = state.matches.find((m) => m.id === matchId);
    if (match) {
      const info = getSportTimeInfo(match.category, match.date);
      el.textContent = info.label + (info.detail ? ' ' + info.detail : '');
    }
  });

  // Refresh scores every 60 seconds
  scoreRefreshCount++;
  if (scoreRefreshCount >= 60 && state.matches.length > 0) {
    scoreRefreshCount = 0;
    fetchScoresForMatches(state.matches);
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

// Navigation
function selectView(view) {
  state.currentView = view;
  state.currentSport = null;

  dom.navTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  $$('.sport-item').forEach((item) => item.classList.remove('active'));
  const liveItem = $(`[data-sport="live"]`, dom.sportsList);
  if (liveItem) liveItem.classList.add('active');

  const labels = { live: 'Live Matches', today: "Today's Matches", all: 'All Matches' };
  dom.contentTitle.textContent = labels[view] || 'Matches';

  loadMatches();
}

function selectSport(sportId, label) {
  state.currentSport = sportId;
  state.currentView = null;

  $$('.sport-item').forEach((item) => item.classList.remove('active'));
  const el = $(`[data-sport="${sportId}"]`, dom.sportsList);
  if (el) el.classList.add('active');

  dom.navTabs.forEach((tab) => tab.classList.remove('active'));
  dom.contentTitle.textContent = label || `${sportId} Matches`;

  if (window.innerWidth <= 1024) {
    dom.sidebar.classList.remove('open');
  }

  loadMatches();
}

// Data loading
async function loadMatches() {
  state.loading = true;
  state.error = null;
  state.scoresMap = null;
  state.activeSources = null;

  // Clear previous score-sourced markers
  const prevMarked = document.querySelectorAll('[data-score-sourced]');
  prevMarked.forEach((el) => delete el.dataset.scoreSourced);
  renderMatches([]);

  try {
    const sport = state.currentSport || state.currentView;
    const view = state.currentView || '';
    const matches = await fetchMatches(view, sport);
    state.matches = Array.isArray(matches) ? matches : [];
    state.loading = false;

    // Update live count
    const liveCount = state.matches.filter((m) => getMatchStatus(m) === 'live').length;
    dom.liveCount.textContent = liveCount;

    renderMatches(state.matches);

    // Fetch scores only for matches that have started (not upcoming)
    const startedMatches = state.matches.filter((m) => getMatchStatus(m) !== 'upcoming');
    fetchScoresForMatches(startedMatches);
  } catch (err) {
    state.loading = false;
    state.error = err.message;
    renderMatches([]);
    showToast(`Error: ${err.message}`, 'error');
  }
}

function getUniqueSportCategories(matches) {
  const cats = new Set();
  matches.forEach((m) => cats.add(m.category));
  return [...cats];
}

async function fetchScoresForMatches(matches) {
  const categories = getUniqueSportCategories(matches);
  if (categories.length === 0) return;

  // Clear stale score-sourced markers from previous refresh
  const staleMarked = document.querySelectorAll('[data-score-sourced]');
  staleMarked.forEach((el) => delete el.dataset.scoreSourced);

  const results = await Promise.allSettled(
    categories.map(async (category) => {
      const events = await fetchScoresForCategory(category);
      return { category, events };
    })
  );

  const scoresMap = new Map();

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.events.length > 0) {
      const { category, events } = result.value;
      const catMatches = matches.filter((m) => m.category === category);
      catMatches.forEach((match) => {
        const score = findScore(match, events);
        if (score) {
          scoresMap.set(match.id, score);
        }
      });
    }
  });

  state.scoresMap = scoresMap;

  state.activeSources = new Set();
  scoresMap.forEach((score) => {
    if (score.source) state.activeSources.add(score.source);
  });

  renderAttribution();

  if (scoresMap.size > 0) {
    const cards = document.querySelectorAll('.match-card');
    cards.forEach((card) => {
      const matchId = card.dataset.matchId;
      const score = scoresMap.get(matchId);
      if (score) {
        updateCardScore(card, score);
      }
    });
  }
}

function updateCardScore(card, score) {
  const scoreDisplay = card.querySelector('.score');
  const category = card.dataset.category;

  if (scoreDisplay) {
    if (category === 'cricket') {
      const homePart = score.home != null ? escapeHtml(score.home) + (score.homeOvers ? ` (${escapeHtml(score.homeOvers)})` : '') : '';
      const awayPart = score.away != null ? escapeHtml(score.away) + (score.awayOvers ? ` (${escapeHtml(score.awayOvers)})` : '') : '';
      if (homePart || awayPart) {
        scoreDisplay.textContent = homePart && awayPart ? `${homePart} | ${awayPart}` : (homePart || awayPart);
        scoreDisplay.classList.add('has-score');
      }
    } else {
      if (score.home != null && score.away != null) {
        scoreDisplay.textContent = `${escapeHtml(score.home)}-${escapeHtml(score.away)}`;
        scoreDisplay.classList.add('has-score');
      } else if (score.home != null) {
        scoreDisplay.textContent = escapeHtml(score.home);
        scoreDisplay.classList.add('has-score');
      }
    }
  }

  const statusLine = card.querySelector('.match-status-line');
  if (statusLine) {
    statusLine.dataset.scoreSourced = 'true';
    if (score.elapsed || score.status) {
      const detail = getScoreDetail(score, category);
      if (detail) {
        statusLine.textContent = detail;
        statusLine.style.display = '';
      }
    }
  }

  // Add LIVE badge if scores confirm match is live but badge missing
  if (score.elapsed || (score.status && !score.status.toUpperCase().includes('SCHEDULED'))) {
    const badges = card.querySelector('.match-badges');
    if (badges && !badges.querySelector('.badge-live')) {
      const liveDot = document.createElement('span');
      liveDot.className = 'badge badge-live';
      liveDot.innerHTML = '<span class="badge-dot"></span>LIVE';
      badges.insertBefore(liveDot, badges.firstChild);
    }
  }
}

async function loadSports() {
  try {
    state.sports = await fetchSports();
    if (Array.isArray(state.sports)) {
      renderSports(state.sports);
    }
  } catch (err) {
    console.warn('Failed to load sports:', err.message);
  }
}

function handleRefresh() {
  dom.refreshBtn.classList.add('spinning');
  loadMatches().finally(() => {
    setTimeout(() => dom.refreshBtn.classList.remove('spinning'), 600);
  });
}

// Init
function init() {
  loadSports();
  loadMatches();

  // Nav tabs
  dom.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => selectView(tab.dataset.view));
  });

  // Sidebar items (live + all are static)
  $$('[data-sport="live"], [data-sport="all"]', dom.sportsList).forEach((item) => {
    item.addEventListener('click', () => {
      const sport = item.dataset.sport;
      if (sport === 'live') selectView('live');
      else if (sport === 'all') selectView('all');
    });
  });

  // Refresh
  dom.refreshBtn.addEventListener('click', handleRefresh);

  // Search
  let searchTimeout;
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = dom.searchInput.value.toLowerCase().trim();
      renderMatches(state.matches);
    }, 250);
  });

  // Sidebar toggle (mobile)
  dom.sidebarToggle.addEventListener('click', () => {
    dom.sidebar.classList.toggle('open');
  });

  // Modal
  dom.modalClose.addEventListener('click', () => {
    dom.modal.classList.remove('open');
    dom.streamContainer.innerHTML = `
      <div class="stream-placeholder">
        <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <p>Select a source below to watch</p>
      </div>
    `;
  });

  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) dom.modalClose.click();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.modal.classList.contains('open')) dom.modalClose.click();
  });

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 1024 &&
      dom.sidebar.classList.contains('open') &&
      !dom.sidebar.contains(e.target) &&
      !dom.sidebarToggle.contains(e.target)
    ) {
      dom.sidebar.classList.remove('open');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
