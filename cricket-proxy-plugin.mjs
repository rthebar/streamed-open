const ESPNCRICINFO_URL = 'https://www.espncricinfo.com/live-cricket-score';

export default function cricketProxyPlugin() {
  return {
    name: 'cricket-proxy',
    configureServer(server) {
      server.middlewares.use('/api/cricket/live', async (req, res) => {
        try {
          const response = await fetch(ESPNCRICINFO_URL, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(10000),
          });
          const html = await response.text();
          const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
          if (!m) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'No __NEXT_DATA__ found in page' }));
            return;
          }

          const data = JSON.parse(m[1]);
          const matches = data?.props?.appPageProps?.data?.content?.matches || [];

          const formatted = matches
            .map((m) => {
              if (!m.teams || m.teams.length < 2) return null;
              const home = m.teams.find((t) => t.isHome === true) || m.teams[1];
              const away = m.teams.find((t) => t.isHome === false) || m.teams[0];

              const homeName = home?.team?.name || home?.team?.longName || '';
              const awayName = away?.team?.name || away?.team?.longName || '';
              if (!homeName && !awayName) return null;

              const statusText = m.statusText || null;

              const series = m.series ? {
                name: m.series.name,
                longName: m.series.longName,
                year: m.series.year,
              } : null;

              return {
                homeName,
                awayName,
                homeScore: home?.score || null,
                awayScore: away?.score || null,
                homeOvers: home?.scoreInfo || null,
                awayOvers: away?.scoreInfo || null,
                homeInnings: home?.inningNumbers || [],
                awayInnings: away?.inningNumbers || [],
                status: m.status || m.state || '',
                clock: statusText,
                period: m.liveInning ? `Innings ${m.liveInning}` : null,
                series,
                source: 'espncricinfo',
              };
            })
            .filter(Boolean);

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(formatted));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}
