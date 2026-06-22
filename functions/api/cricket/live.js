export async function onRequest(context) {
  try {
    const response = await fetch('https://www.espncricinfo.com/live-cricket-score', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!match) {
      return new Response(JSON.stringify({ error: 'No __NEXT_DATA__ found' }), { status: 502 });
    }

    const data = JSON.parse(match[1]);
    const matches = data?.props?.appPageProps?.data?.content?.matches || [];

    const formatted = matches
      .map((m) => {
        if (!m.teams || m.teams.length < 2) return null;
        const home = m.teams.find((t) => t.isHome === true) || m.teams[1];
        const away = m.teams.find((t) => t.isHome === false) || m.teams[0];
        const homeName = home?.team?.name || home?.team?.longName || '';
        const awayName = away?.team?.name || away?.team?.longName || '';
        if (!homeName && !awayName) return null;

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
          clock: m.statusText || null,
          period: m.liveInning ? `Innings ${m.liveInning}` : null,
          series,
          source: 'espncricinfo',
        };
      })
      .filter(Boolean);

    return new Response(JSON.stringify(formatted), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
}
