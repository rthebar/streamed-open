const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const OPENF1_BASE = 'https://api.openf1.org/v1';
const BALLDONTLIE_BASE = 'https://api.balldontlie.io/v1';
const BALLDONTLIE_V1_BASE = 'https://www.balldontlie.io/api/v1';

export const SCORE_SOURCES = {
  espn: { label: 'ESPN', url: 'https://espn.com' },
  espncricinfo: { label: 'ESPNcricinfo', url: 'https://www.espncricinfo.com' },
  openf1: { label: 'OpenF1', url: 'https://openf1.org' },
  balldontlie: { label: 'balldontlie', url: 'https://balldontlie.io' },
};

export const SPORT_CONFIG = {
  football: { sport: 'soccer' },
  basketball: { sport: 'basketball', league: 'nba' },
  cricket: { sport: 'cricket' },
  tennis: { sport: 'tennis' },
  baseball: { sport: 'baseball', league: 'mlb' },
  hockey: { sport: 'hockey', league: 'nhl' },
  'american-football': { sport: 'football', league: 'nfl' },
  'motor-sports': { sport: 'racing', league: 'f1' },
  mma: { sport: 'mma', league: 'ufc' },
  boxing: { sport: 'boxing' },
  rugby: { sport: 'rugby' },
  golf: { sport: 'golf' },
  afl: { sport: 'afl' },
};

const LEAGUE_FALLBACKS = {
  soccer: [
    'uefa.champions', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1',
    'fifa.world', 'uefa.europa', 'nld.1', 'por.1', 'sco.1',
  ],
  basketball: ['nba', 'wnba'],
};

const CATEGORY_EXTRA_SOURCES = {
  cricket: ['cricketProxy'],
  'motor-sports': ['openf1'],
  basketball: ['balldontlie'],
};

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- ESPN ----

async function fetchESPN(sport, league) {
  const url = league
    ? `${ESPN_BASE}/${sport}/${league}/scoreboard`
    : `${ESPN_BASE}/${sport}/scoreboard`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  const data = await res.json();
  return data.events || [];
}

async function fetchESPNWithFallback(sport, league) {
  try {
    const events = await fetchESPN(sport);
    if (events.length > 0) return events;
  } catch {
    // fall through
  }

  if (league) {
    try {
      return await fetchESPN(sport, league);
    } catch {
      // fall through
    }
  }

  const fallbacks = LEAGUE_FALLBACKS[sport];
  if (fallbacks) {
    const results = await Promise.allSettled(
      fallbacks.map((l) => fetchESPN(sport, l))
    );
    const allEvents = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') allEvents.push(...r.value);
    });
    return allEvents;
  }

  return [];
}

function parseESPNEvent(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeName = home.team?.displayName || home.team?.name || home.team?.abbreviation || '';
  const awayName = away.team?.displayName || away.team?.name || away.team?.abbreviation || '';
  if (!homeName && !awayName) return null;

  return {
    homeName,
    awayName,
    homeScore: home.score ?? null,
    awayScore: away.score ?? null,
    status: comp.status?.type?.name || '',
    clock: comp.status?.displayClock || null,
    period: comp.status?.period || null,
    source: 'espn',
  };
}

// ---- Cricket Proxy (ESPNcricinfo via local proxy) ----

async function fetchCricketProxy() {
  const res = await fetch('/api/cricket/live', { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Cricket proxy ${res.status}`);
  return res.json();
}

// ---- OpenF1 (motorsports) ----

async function fetchOpenF1() {
  // Get latest session (Race preferred, else qualifying)
  const sessionsRes = await fetch(`${OPENF1_BASE}/sessions?session_key=latest`, { signal: AbortSignal.timeout(5000) });
  if (!sessionsRes.ok) throw new Error(`OpenF1 sessions ${sessionsRes.status}`);
  const sessions = await sessionsRes.json();
  if (!sessions || sessions.length === 0) return [];

  // Pick the latest session (Race > Qualifying > Practice)
  const session = sessions.reduce((best, s) => {
    const rank = { Race: 3, Qualifying: 2, Practice: 1 };
    return (rank[s.session_name] || 0) > (rank[best.session_name] || 0) ? s : best;
  }, sessions[0]);

  const sessionKey = session.session_key;
  const circuitName = session.circuit_short_name || '';
  const sessionName = session.session_name || '';
  const dateStart = session.date_start || '';

  // Get top 3 positions
  const posRes = await fetch(
    `${OPENF1_BASE}/session_result?session_key=${sessionKey}&position%3C=3`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!posRes.ok) return [];
  const positions = await posRes.json();
  if (!positions || positions.length === 0) return [];

  // Get driver info
  const driversRes = await fetch(
    `${OPENF1_BASE}/drivers?session_key=${sessionKey}`,
    { signal: AbortSignal.timeout(5000) }
  );
  const drivers = driversRes.ok ? await driversRes.json() : [];
  const driverMap = {};
  (drivers || []).forEach((d) => {
    driverMap[d.driver_number] = d.full_name || d.name_acronym || `#${d.driver_number}`;
  });

  // Build standings string
  const top3 = positions
    .sort((a, b) => a.position - b.position)
    .map((p) => driverMap[p.driver_number] || `#${p.driver_number}`);

  // Return a single event for the race
  const titleName = `${sessionName} ${circuitName}`.trim();

  const status = dateStart
    ? (new Date(dateStart) > new Date() ? 'STATUS_SCHEDULED' : 'STATUS_IN_PROGRESS')
    : 'STATUS_SCHEDULED';

  const laps = positions[0]?.number_of_laps || null;

  return [{
    homeName: titleName,
    awayName: '',
    homeScore: top3.join(', '),
    awayScore: null,
    status,
    clock: laps ? `Lap ${laps}` : null,
    period: sessionName,
    source: 'openf1',
  }];
}

// ---- balldontlie (NBA) ----

async function fetchBalldontlie() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `${BALLDONTLIE_BASE}/games?dates[]=${today}`,
    `${BALLDONTLIE_V1_BASE}/games?dates[]=${today}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      const games = data?.data || [];
      if (games.length > 0) return games;
    } catch {
      continue;
    }
  }
  return [];
}

function parseBalldontlieGame(game) {
  const homeName = game.home_team?.full_name || game.home_team?.name || '';
  const awayName = game.visitor_team?.full_name || game.visitor_team?.name || '';
  if (!homeName && !awayName) return null;

  let status = game.status || '';
  let clock = game.time || '';
  let period = game.period || null;

  if (status.toLowerCase() === 'final') {
    status = 'STATUS_FINAL';
    clock = null;
  } else if (status === '' && period && period > 0) {
    status = 'STATUS_IN_PROGRESS';
  }

  if (clock === ' ' || clock === '') clock = null;
  if (clock === 'Final') {
    status = 'STATUS_FINAL';
    clock = null;
  }

  return {
    homeName,
    awayName,
    homeScore: game.home_team_score != null ? String(game.home_team_score) : null,
    awayScore: game.visitor_team_score != null ? String(game.visitor_team_score) : null,
    status,
    clock,
    period,
    source: 'balldontlie',
  };
}

// ---- Unified event matching ----

function matchScore(streamedMatch, events) {
  const homeName = streamedMatch.teams?.home?.name || '';
  const awayName = streamedMatch.teams?.away?.name || '';

  if (!homeName && !awayName) return null;
  const normHome = normalize(homeName);
  const normAway = normalize(awayName);

  for (const ev of events) {
    const eHome = normalize(ev.homeName);
    const eAway = normalize(ev.awayName);

    if (!eHome && !eAway) continue;

    const homeMatch = !normHome || (eHome && (eHome.includes(normHome) || normHome.includes(eHome)));
    const awayMatch = !normAway || (eAway && (eAway.includes(normAway) || normAway.includes(eAway)));

    if (homeMatch && awayMatch) {
      return {
        home: ev.homeScore,
        away: ev.awayScore,
        homeOvers: ev.homeOvers || null,
        awayOvers: ev.awayOvers || null,
        homeInnings: ev.homeInnings || [],
        awayInnings: ev.awayInnings || [],
        status: ev.status,
        elapsed: ev.clock,
        period: ev.period,
        source: ev.source,
      };
    }
  }

  return null;
}

// ---- Main API ----

export async function fetchScoresForCategory(category) {
  const config = SPORT_CONFIG[category];
  if (!config) return [];

  const allEvents = [];

  // Try ESPN
  try {
    const espnRaw = await fetchESPNWithFallback(config.sport, config.league);
    const parsed = espnRaw.map(parseESPNEvent).filter(Boolean);
    allEvents.push(...parsed);
  } catch {
    // fall through
  }

  // Try extra sources for this category
  const extraSources = CATEGORY_EXTRA_SOURCES[category] || [];
  for (const src of extraSources) {
    try {
      if (src === 'cricketProxy') {
        const parsed = await fetchCricketProxy();
        for (const ev of parsed) {
          const dup = allEvents.some(
            (e) =>
              normalize(e.homeName) === normalize(ev.homeName) &&
              normalize(e.awayName) === normalize(ev.awayName)
          );
          if (!dup) allEvents.push(ev);
        }
      } else if (src === 'openf1') {
        const parsed = await fetchOpenF1();
        allEvents.push(...parsed);
      } else if (src === 'balldontlie') {
        const raw = await fetchBalldontlie();
        const parsed = raw.map(parseBalldontlieGame).filter(Boolean);
        for (const ev of parsed) {
          const dup = allEvents.some(
            (e) =>
              normalize(e.homeName) === normalize(ev.homeName) &&
              normalize(e.awayName) === normalize(ev.awayName)
          );
          if (!dup) allEvents.push(ev);
        }
      }
    } catch {
      // fall through
    }
  }

  return allEvents;
}

export function findScore(streamedMatch, scoreEvents) {
  return matchScore(streamedMatch, scoreEvents);
}

export function getScoreDetail(scoreInfo, category) {
  if (!scoreInfo) return null;

  const status = scoreInfo.status || '';
  const clock = scoreInfo.elapsed;
  const period = scoreInfo.period;

  // Status-based display
  const s = status.toUpperCase();

  if (s.includes('HALFTIME')) return 'Half Time';

  if (s.includes('FULL_TIME')) return 'Full Time';

  if (s.includes('FINAL') || s === 'STATUS_END_OF_GAME') {
    if (category === 'football') return 'Full Time';
    if (category === 'cricket') return 'Match Complete';
    return 'Final';
  }

  if (s.includes('INNINGS_BREAK') || s.includes('STUMPS')) {
    return period ? `Innings Break` : 'Innings Break';
  }

  if (s.includes('RAIN') || s.includes('DELAY') || s === 'STATUS_POSTPONED') {
    if (s.includes('RAIN')) return 'Rain Delay';
    if (s.includes('POSTPONED')) return 'Postponed';
    return 'Delayed';
  }

  if (s.includes('CANCELLED')) return 'Cancelled';

  if (s.includes('END_OF_PERIOD') || s.includes('END_PERIOD')) {
    return period ? `End of Q${period}` : 'Period End';
  }

  if (s.includes('SCHEDULED')) return null;

  // Cricket
  if (category === 'cricket') {
    if (clock) return clock;
    if (period) return period;
    if (s === 'LIVE') return 'LIVE';
    return null;
  }

  // In-progress — show clock/period
  if (clock && period) {
    if (category === 'american-football') return `Q${period} ${clock}`;
    if (category === 'basketball') return `Q${period} ${clock}`;
    if (category === 'baseball') return `${period}${getPeriodSuffix(period)} ${clock}`;
    if (category === 'hockey') return `Period ${period} ${clock}`;
    if (category === 'football') return `${clock}'`;
    return `${clock}`;
  }

  if (clock && category === 'football') return `${clock}'`;

  if (period) {
    if (category === 'american-football') return `Q${period}`;
    if (category === 'basketball') return `Q${period}`;
    if (category === 'baseball') return `${period}${getPeriodSuffix(period)}`;
    if (category === 'hockey') return `Period ${period}`;
    return `${period}`;
  }

  if (clock) return clock;

  return null;
}

function getPeriodSuffix(n) {
  const abs = Math.abs(n % 100);
  if (abs >= 11 && abs <= 13) return 'th';
  switch (abs % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
