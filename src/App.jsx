import { useEffect, useMemo, useState } from "react";

const DEFAULT_MAX = 50;

const normalizeMs = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return Date.now();
  return num < 10_000_000_000 ? num * 1000 : num;
};

const formatMonthKey = (ms) => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const toMonthInputValue = (ms) => {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const parseNdjsonOrJson = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const safeNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const getUserName = (entry) =>
  entry?.username || entry?.name || entry?.user?.name || entry?.user?.id;

const buildQueryParams = (params) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      search.set(key, String(value));
    }
  });
  return search.toString();
};

const apiBase = import.meta.env.DEV ? "/lichess" : "https://lichess.org";

const fetchText = async (url, token) => {
  const headers = {
    Accept: "application/x-ndjson",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} - ${body.slice(0, 160)}`);
  }
  return res.text();
};

const sumStats = (target, update) => {
  target.points += update.points;
  target.w += update.w;
  target.d += update.d;
  target.l += update.l;
  target.tournaments += update.tournaments;
  target.perfSum += update.perfSum;
  target.perfWeight += update.perfWeight;
};

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const nowMonth = toMonthInputValue(Date.now());

  const [teamId] = useState(params.get("team") || "");
  const [nameFilter] = useState(params.get("name") || "");
  const [monthFilter] = useState(params.get("month") || nowMonth);
  const [statusFilter] = useState(params.get("status") || "finished");
  const [maxTournaments] = useState(() => {
    const raw = Number(params.get("max"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX;
  });
  const [token] = useState("");
  const [includeGames] = useState(params.get("games") !== "0");

  const hasRequiredParams = Boolean(params.get("team")) && Boolean(params.get("month"));

  const [setupTeam, setSetupTeam] = useState(params.get("team") || "");
  const [setupMonth, setSetupMonth] = useState(params.get("month") || nowMonth);
  const [setupName, setSetupName] = useState(params.get("name") || "");
  const [setupStatus, setSetupStatus] = useState(params.get("status") || "finished");
  const [setupMax, setSetupMax] = useState(() => {
    const raw = Number(params.get("max"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX;
  });
  const [setupGames, setSetupGames] = useState(params.get("games") !== "0");

  const [tournaments, setTournaments] = useState([]);
  const [resultsByTournament, setResultsByTournament] = useState({});
  const [gamesByTournament, setGamesByTournament] = useState({});
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [autoLoad, setAutoLoad] = useState(hasRequiredParams);

  const filterTournaments = (list) => {
    const byMonth = (t) =>
      !monthFilter || formatMonthKey(t.startsAt) === monthFilter;
    const byName = (t) =>
      !nameFilter || t.fullName.toLowerCase().includes(nameFilter.toLowerCase());
    return list.filter((t) => byMonth(t) && byName(t));
  };

  const filteredTournaments = useMemo(
    () => filterTournaments(tournaments),
    [tournaments, monthFilter, nameFilter]
  );

  const aggregatedStats = useMemo(() => {
    const aggregate = {};
    filteredTournaments.forEach((t) => {
      const results = resultsByTournament[t.id] || [];
      const games = gamesByTournament[t.id] || {};

      results.forEach((player) => {
        const name = getUserName(player);
        if (!name) return;
        const points = safeNumber(player.score ?? player.points);
        const performance = safeNumber(
          player.performance ?? player.perf ?? player.performanceRating
        );
        const stats = games[name] || { w: 0, d: 0, l: 0, games: 0 };
        const weight = stats.games > 0 ? stats.games : points || 1;

        if (!aggregate[name]) {
          aggregate[name] = {
            name,
            points: 0,
            w: 0,
            d: 0,
            l: 0,
            tournaments: 0,
            perfSum: 0,
            perfWeight: 0,
          };
        }

        sumStats(aggregate[name], {
          points,
          w: stats.w,
          d: stats.d,
          l: stats.l,
          tournaments: 1,
          perfSum: performance * weight,
          perfWeight: weight,
        });
      });
    });

    return Object.values(aggregate)
      .map((entry) => {
        const games = entry.w + entry.d + entry.l;
        return {
          ...entry,
          games,
          winRate: games > 0 ? (entry.w / games) * 100 : 0,
          performance:
            entry.perfWeight > 0 ? entry.perfSum / entry.perfWeight : 0,
        };
      })
      .sort((a, b) => b.points - a.points || b.winRate - a.winRate);
  }, [filteredTournaments, resultsByTournament, gamesByTournament]);

  const loadTournaments = async () => {
    if (!teamId) {
      setError("Team ID is required.");
      return { ok: false, list: [] };
    }
    setError("");
    setLoadingTournaments(true);
    setResultsByTournament({});
    setGamesByTournament({});
    try {
      const query = buildQueryParams({
        max: maxTournaments,
        status: statusFilter,
      });
      const url = `${apiBase}/api/team/${teamId}/arena${
        query ? `?${query}` : ""
      }`;
      const text = await fetchText(url, token);
      const data = parseNdjsonOrJson(text).map((item) => ({
        id: item.id,
        fullName: item.fullName || item.name || "Untitled Tournament",
        startsAt: normalizeMs(item.startsAt || item.createdAt || Date.now()),
        minutes: item.minutes,
        nbPlayers: item.nbPlayers,
      }));
      const sorted = data.sort((a, b) => b.startsAt - a.startsAt);
      setTournaments(sorted);
      return { ok: true, list: sorted };
    } catch (err) {
      setError(err.message || "Failed to load tournaments.");
      return { ok: false, list: [] };
    } finally {
      setLoadingTournaments(false);
    }
  };

  const fetchTournamentResults = async (id) => {
    const url = `${apiBase}/api/tournament/${id}/results`;
    const text = await fetchText(url, token);
    return parseNdjsonOrJson(text);
  };

  const fetchTournamentGames = async (id) => {
    const query = buildQueryParams({
      pgnInJson: 1,
      moves: 0,
      clocks: 0,
    });
    const url = `${apiBase}/api/tournament/${id}/games?${query}`;
    const text = await fetchText(url, token);
    const games = parseNdjsonOrJson(text);
    const stats = {};

    games.forEach((game) => {
      const white = game?.players?.white?.user?.name || game?.players?.white?.user?.id;
      const black = game?.players?.black?.user?.name || game?.players?.black?.user?.id;
      if (!white || !black) return;

      const winner = game?.winner;
      if (!stats[white]) stats[white] = { w: 0, d: 0, l: 0, games: 0 };
      if (!stats[black]) stats[black] = { w: 0, d: 0, l: 0, games: 0 };

      stats[white].games += 1;
      stats[black].games += 1;

      if (winner === "white") {
        stats[white].w += 1;
        stats[black].l += 1;
      } else if (winner === "black") {
        stats[black].w += 1;
        stats[white].l += 1;
      } else {
        stats[white].d += 1;
        stats[black].d += 1;
      }
    });

    return stats;
  };

  const loadStats = async (list) => {
    const base = list || filteredTournaments;
    if (base.length === 0) {
      return;
    }
    setError("");
    setLoadingStats(true);

    const ids = base.map((t) => t.id);
    setProgress({ done: 0, total: ids.length });

    const nextResults = {};
    const nextGames = {};

    try {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const results = await fetchTournamentResults(id);
        nextResults[id] = results;

        if (includeGames) {
          nextGames[id] = await fetchTournamentGames(id);
        }
        setProgress({ done: i + 1, total: ids.length });
      }
      setResultsByTournament(nextResults);
      setGamesByTournament(nextGames);
    } catch (err) {
      setError(err.message || "Failed to load stats.");
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (!autoLoad) return;
    const run = async () => {
      const { ok, list } = await loadTournaments();
      if (ok) {
        const filtered = filterTournaments(list);
        if (filtered.length > 0) {
          await loadStats(filtered);
        } else {
          setError("No tournaments match the filters.");
        }
      }
      setAutoLoad(false);
    };
    run();
  }, [autoLoad]);

  const shareLink = useMemo(() => {
    const query = buildQueryParams({
      team: teamId,
      name: nameFilter,
      month: monthFilter,
      status: statusFilter,
      max: maxTournaments,
      games: includeGames ? 1 : undefined,
    });
    return `${window.location.origin}${window.location.pathname}$${
      query ? `?${query}` : ""
    }`.replace("$", "");
  }, [
    teamId,
    nameFilter,
    monthFilter,
    statusFilter,
    maxTournaments,
    includeGames,
  ]);

  const setupLink = useMemo(() => {
    const query = buildQueryParams({
      team: setupTeam.trim() || undefined,
      name: setupName.trim() || undefined,
      month: setupMonth || undefined,
      status: setupStatus || undefined,
      max: setupMax || undefined,
      games: setupGames ? 1 : 0,
    });
    return `${window.location.origin}${window.location.pathname}$${
      query ? `?${query}` : ""
    }`.replace("$", "");
  }, [setupTeam, setupName, setupMonth, setupStatus, setupMax, setupGames]);

  const goToSetupLink = () => {
    window.location.assign(setupLink);
  };

  if (!hasRequiredParams) {
    return (
      <div className="page">
        <header className="topbar">
          <div>
            <p className="eyebrow">Gambit Monthly</p>
            <h1>Setup</h1>
            <p className="subhead">
              Add your team and month to generate the stats link.
            </p>
          </div>
        </header>

        <section className="panel setup">
          <div className="controls">
            <label>
              Team ID
              <input
                value={setupTeam}
                onChange={(e) => setSetupTeam(e.target.value)}
                placeholder="team-id"
              />
            </label>
            <label>
              Month
              <input
                type="month"
                value={setupMonth}
                onChange={(e) => setSetupMonth(e.target.value)}
              />
            </label>
            <label>
              Tournament name contains
              <input
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                placeholder="Monday Arena"
              />
            </label>
            <label>
              Status
              <select
                value={setupStatus}
                onChange={(e) => setSetupStatus(e.target.value)}
              >
                <option value="finished">Finished</option>
                <option value="started">Started</option>
                <option value="created">Created</option>
              </select>
            </label>
            <label>
              Max tournaments
              <input
                type="number"
                min="1"
                max="200"
                value={setupMax}
                onChange={(e) => setSetupMax(Number(e.target.value))}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={setupGames}
                onChange={(e) => setSetupGames(e.target.checked)}
              />
              Include games for W/D/L
            </label>
          </div>
          <div className="link-box">
            <div>
              <p className="label">Generated link</p>
              <p className="link-text">{setupLink}</p>
            </div>
            <button className="primary" onClick={goToSetupLink}>
              Open stats
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Gambit Monthly</p>
          <h1>Monthly performance</h1>
          <p className="subhead">
            Shareable link: <span className="inline-link">{shareLink}</span>
          </p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>Monthly Performance</h2>
          {(loadingTournaments || loadingStats) && (
            <span>
              Loading {progress.done}/{progress.total}
            </span>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Points</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>Win %</th>
                <th>Performance</th>
                <th>Tournaments</th>
              </tr>
            </thead>
            <tbody>
              {aggregatedStats.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.points.toFixed(1)}</td>
                  <td>{row.w}</td>
                  <td>{row.d}</td>
                  <td>{row.l}</td>
                  <td>{row.winRate.toFixed(1)}%</td>
                  <td>{row.performance ? row.performance.toFixed(0) : "–"}</td>
                  <td>{row.tournaments}</td>
                </tr>
              ))}
              {aggregatedStats.length === 0 && (
                <tr>
                  <td colSpan="8" className="empty">
                    {teamId
                      ? "Waiting for stats…"
                      : "Add query parameters to load stats."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}