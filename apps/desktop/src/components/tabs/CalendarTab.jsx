import { tallyResidence } from '../../utils/residence';

const LOCATION_COLORS = {
  canada: "#ef4444",
  mexico: "#10b981",
  international: "#3b82f6",
  transit: "#f59e0b",
};
const LOCATION_EMOJIS = {
  canada: "🏠",
  mexico: "🌴",
  international: "🌍",
  transit: "✈️",
};
const MONTH_NAMES = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function CalendarTab({
  residence,
  flights,
  boardingPassDates,
  setDayPanelDate,
  year = new Date().getFullYear(),
}) {
  const resMap = {};
  residence.forEach((r) => { resMap[r.date] = r; });

  const flightsByDate = {};
  flights.forEach((f) => {
    if (!flightsByDate[f.date]) flightsByDate[f.date] = [];
    flightsByDate[f.date].push(f);
  });

  const today = new Date();
  const isCurrentYear = year === today.getFullYear();
  const lastMonth = isCurrentYear ? Math.max(today.getMonth(), 2) : 11;
  const monthsToShow = [];
  for (let m = 0; m <= lastMonth; m++) monthsToShow.push(m);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.04em", margin: 0 }}>
            CALENDRIER FISCAL {year}
          </h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { color: "#ef4444", label: "🏠 Canada" },
              { color: "#10b981", label: "🌴 Mexique" },
              { color: "#3b82f6", label: "🌍 International" },
              { color: "#f59e0b", label: "✈️ Transit" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <div style={{ width: 14, height: 14, borderRadius: 4, background: item.color }} />
                <span style={{ color: "#94a3b8" }}>{item.label}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a78bfa" }} />
              <span style={{ color: "#94a3b8" }}>📎 Boarding pass</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        {monthsToShow.map((month) => {
          const firstDay = new Date(year, month, 1);
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          let startDay = firstDay.getDay() - 1;
          if (startDay < 0) startDay = 6;

          const monthlyCounts = { canada: 0, mexico: 0, international: 0, transit: 0 };
          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const entry = resMap[dateStr];
            if (entry && entry.location != null) monthlyCounts[entry.location] = (monthlyCounts[entry.location] || 0) + 1;
          }
          const totalTracked = Object.values(monthlyCounts).reduce((a, b) => a + b, 0);

          return (
            <div key={month} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
                  {MONTH_NAMES[month]} {year}
                </h4>
                <span style={{ fontSize: 11, color: "#475569" }}>{totalTracked}/{daysInMonth} jours</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 6 }}>
                {DAY_NAMES.map((d) => (
                  <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#475569", fontWeight: 600, padding: "2px 0" }}>
                    {d}
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                {Array.from({ length: startDay }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ aspectRatio: "1", borderRadius: 6 }} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const entry = resMap[dateStr];
                  const hasLoc = !!entry && entry.location != null;
                  const bg = hasLoc ? LOCATION_COLORS[entry.location] : "transparent";
                  const border = hasLoc ? "none" : "1px solid #1e2a45";
                  const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
                  const hasBP = boardingPassDates.has(dateStr);
                  const dayFlights = flightsByDate[dateStr] || [];

                  let cellLabel = null;
                  if (dayFlights.length > 0) {
                    if (dayFlights.length === 2 && dayFlights[0].departure === dayFlights[1].arrival) {
                      cellLabel = dayFlights[0].arrival;
                    } else {
                      const f = dayFlights[0];
                      const isLongHaul = (f.totalTime || 0) >= 8;
                      cellLabel = isLongHaul ? "787" : `${f.arrival}`;
                    }
                  } else if (hasLoc) {
                    cellLabel = LOCATION_EMOJIS[entry.location];
                  }

                  const titleFlights = dayFlights.map(f => `${f.flightNumber} ${f.departure}→${f.arrival}`).join(' / ');
                  const titleText = titleFlights || (entry ? (entry.notes || entry.location || dateStr) : dateStr);

                  return (
                    <div
                      key={day}
                      title={`${titleText}${hasBP ? ' 📎' : ''}`}
                      onClick={() => setDayPanelDate(dateStr)}
                      style={{
                        aspectRatio: "1",
                        borderRadius: 6,
                        background: hasLoc ? `${bg}22` : "transparent",
                        border: isToday ? "2px solid #f1f5f9" : border,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        overflow: "hidden",
                        cursor: "pointer",
                      }}
                    >
                      {hasLoc && (
                        <div style={{
                          position: "absolute", bottom: 0, left: 0, right: 0, height: "3px",
                          background: bg,
                        }} />
                      )}
                      {hasBP && (
                        <div style={{
                          position: "absolute", top: 2, right: 2,
                          width: 5, height: 5, borderRadius: "50%",
                          background: "#a78bfa",
                        }} />
                      )}
                      <span style={{ fontSize: 11, fontWeight: hasLoc ? 600 : 400, color: hasLoc ? "#f1f5f9" : "#374151" }}>
                        {day}
                      </span>
                      {cellLabel && (
                        <span style={{ fontSize: dayFlights.length > 0 ? 7 : 8, marginTop: 1, color: dayFlights.length > 0 ? bg : undefined, fontWeight: dayFlights.length > 0 ? 700 : 400 }}>
                          {cellLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {Object.entries(monthlyCounts).filter(([, v]) => v > 0).map(([loc, count]) => (
                  <div key={loc} style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
                    background: `${LOCATION_COLORS[loc]}15`, borderRadius: 6, fontSize: 11,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: 3, background: LOCATION_COLORS[loc] }} />
                    <span style={{ color: LOCATION_COLORS[loc], fontWeight: 600 }}>{count}j</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.04em", marginBottom: 16 }}>
          RÉSUMÉ CUMULATIF
        </h3>
        {(() => {
          const counts = tallyResidence(residence);
          const outsideCanada = counts.outside;
          const margin = 183 - outsideCanada;
          const pct = Math.min((outsideCanada / 183) * 100, 100);
          const barColor = pct < 60 ? "#10b981" : pct < 85 ? "#f59e0b" : "#ef4444";

          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
                {[
                  { label: "🏠 Canada", count: counts.canada, color: "#ef4444" },
                  { label: "🌴 Mexique", count: counts.mexico, color: "#10b981" },
                  { label: "🌍 International", count: counts.international, color: "#3b82f6" },
                  { label: "✈️ Transit", count: counts.transit, color: "#f59e0b" },
                  { label: "Total suivi", count: counts.total, color: "#94a3b8" },
                ].map((item) => (
                  <div key={item.label} style={{ padding: 12, background: "#0a0f1e", borderRadius: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.count}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: 16, background: "#0a0f1e", borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
                  <span style={{ color: "#94a3b8" }}>Jours hors Canada : <strong style={{ color: "#f1f5f9" }}>{outsideCanada}</strong> / 183</span>
                  <span style={{ color: barColor, fontWeight: 600 }}>Marge : {margin} jours</span>
                </div>
                <div style={{ height: 10, background: "#1e293b", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 5, transition: "width 0.6s ease" }} />
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
