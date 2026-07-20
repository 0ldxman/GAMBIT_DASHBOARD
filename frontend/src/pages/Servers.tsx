import { Link } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { DiscordGuild } from "../types";

/** Серверы, на которых стоит бот. Точка входа: сервер → проекты на нём. */
export function Servers() {
  const guilds = useAsync<DiscordGuild[]>(() => api.listGuilds(), []);

  return (
    <div>
      <h1>Серверы</h1>
      <p className="muted">
        Серверы, куда приглашён бот. Внутри сервера — проекты, которые на нём идут.
      </p>

      {guilds.loading && <p className="muted">Загрузка…</p>}
      {guilds.error && (
        <div className="stack">
          <div className="error">{guilds.error}</div>
          <p className="muted">
            Проверьте, что боту задан DISCORD_BOT_TOKEN и он приглашён хотя бы на один
            сервер: <code>GET /health/config</code>
          </p>
        </div>
      )}
      {guilds.data?.length === 0 && (
        <p className="muted">Бот пока не добавлен ни на один сервер.</p>
      )}

      <div className="server-grid">
        {guilds.data?.map((g) => (
          <Link key={g.guild_id} to={`/servers/${g.guild_id}`} className="card server-card">
            <GuildIcon guild={g} size={72} />
            <h3 className="server-name">{g.name}</h3>
            <div className="server-stats">
              <Stat value={g.project_count} label={plural(g.project_count, "проект", "проекта", "проектов")} />
              {g.member_count != null && (
                <Stat
                  value={g.member_count}
                  label={plural(g.member_count, "участник", "участника", "участников")}
                />
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Русское склонение числительных: 1 проект, 2 проекта, 5 проектов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Иконка сервера, а без неё — инициалы, как это делает сам Discord. */
export function GuildIcon({ guild, size = 48 }: { guild: DiscordGuild; size?: number }) {
  const initials = guild.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  if (guild.icon_url) {
    return (
      <img
        src={guild.icon_url}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: "50%", flexShrink: 0 }}
      />
    );
  }
  return (
    <div className="guild-fallback" style={{ width: size, height: size, fontSize: size / 2.6 }}>
      {initials}
    </div>
  );
}
