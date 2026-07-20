import { useMemo, useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { PlayerBadge } from "../../components/PlayerBadge";
import type { GuildPlayer, Member } from "../../types";

/** Игроки сущности: несколько человек с ролями, один основной. */
export function MembersSection({
  projectId,
  entityId,
  onChanged,
}: {
  projectId: number;
  entityId: number;
  onChanged?: () => void;
}) {
  const members = useAsync<Member[]>(
    () => api.listMembers(projectId, entityId),
    [projectId, entityId],
  );
  // Участники сервера с ролями проекта — выбор вместо ввода Discord ID.
  const players = useAsync<GuildPlayer[]>(
    () => api.listGuildPlayers(projectId),
    [projectId],
  );

  const [playerId, setPlayerId] = useState("");
  const [role, setRole] = useState("");
  const [primary, setPrimary] = useState(false);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasPrimary = (members.data ?? []).some((m) => m.is_primary);

  const filtered = useMemo(() => {
    const taken = new Set((members.data ?? []).map((m) => m.player_id));
    const q = search.trim().toLowerCase();
    return (players.data ?? []).filter(
      (p) => !taken.has(p.player_id) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [players.data, search, members.data]);

  const selected = filtered.find((p) => p.player_id === playerId);

  function refresh() {
    members.reload();
    onChanged?.();
  }

  async function add() {
    if (!playerId) return;
    setBusy(true);
    setErr(null);
    try {
      await api.addMember(projectId, entityId, {
        player_id: playerId,
        role,
        // Первый добавленный становится основным сам — сущность не должна
        // остаться без ответственного игрока.
        is_primary: primary || !hasPrimary,
      });
      setPlayerId("");
      setRole("");
      setPrimary(false);
      setSearch("");
      refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePrimary(m: Member) {
    if (m.is_primary) return; // основного снимают назначением другого
    await api.updateMember(projectId, entityId, m.id, { is_primary: true });
    refresh();
  }

  async function changeRole(m: Member, value: string) {
    await api.updateMember(projectId, entityId, m.id, { role: value });
    members.reload();
  }

  async function remove(m: Member) {
    if (!confirm(`Убрать ${m.player_name || m.player_id} из сущности?`)) return;
    await api.removeMember(projectId, entityId, m.id);
    refresh();
  }

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Игроки</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Сущностью могут управлять несколько игроков с разными ролями. Основной — тот, кто
        отвечает за неё в целом; смена лидера = смена основного.
      </p>

      {members.loading && <p className="muted">Загрузка…</p>}
      {members.error && <p className="error">{members.error}</p>}
      {members.data?.length === 0 && <p className="muted">Игроков нет.</p>}

      {members.data?.map((m) => (
        <div className="member-row" key={m.id}>
          <PlayerBadge member={m} />
          <input
            value={m.role}
            placeholder="роль (напр. лидер)"
            onChange={(e) => changeRole(m, e.target.value)}
          />
          <label className="check" title="Отвечает за сущность в целом">
            <input
              type="checkbox"
              checked={m.is_primary}
              disabled={m.is_primary}
              onChange={() => togglePrimary(m)}
            />
            Основной игрок
          </label>
          <button className="ghost danger" onClick={() => remove(m)}>
            ✕
          </button>
        </div>
      ))}

      <label style={{ marginTop: 16 }}>Добавить игрока</label>
      {players.error && (
        <div className="stack">
          <div className="error">{players.error}</div>
          <p className="muted" style={{ fontSize: 13 }}>
            Список участников недоступен — проверьте роли проекта в настройках и интент
            SERVER MEMBERS у бота.
          </p>
        </div>
      )}
      {players.loading && <p className="muted">Загружаю участников сервера…</p>}

      {players.data && (
        <>
          <input
            value={search}
            placeholder="поиск по имени…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="player-picker">
            {filtered.length === 0 && (
              <p className="muted" style={{ padding: 8, margin: 0 }}>
                {players.data.length === 0
                  ? "Ни у кого нет ролей проекта."
                  : "Никого не найдено."}
              </p>
            )}
            {filtered.map((p) => (
              <button
                key={p.player_id}
                type="button"
                className={`player-option${playerId === p.player_id ? " selected" : ""}`}
                onClick={() => setPlayerId(p.player_id)}
              >
                <img src={p.avatar_url} alt="" width={28} height={28} />
                <span className="player-option-name">{p.name}</span>
                {p.role_names.length > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {p.role_names.join(", ")}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <input
              value={role}
              placeholder="роль (напр. лидер)"
              style={{ flex: 1 }}
              onChange={(e) => setRole(e.target.value)}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={primary || !hasPrimary}
                disabled={!hasPrimary}
                onChange={(e) => setPrimary(e.target.checked)}
              />
              Основной игрок
            </label>
            <button className="primary" onClick={add} disabled={busy || !playerId}>
              Добавить{selected ? ` ${selected.name}` : ""}
            </button>
          </div>
          {!hasPrimary && (
            <p className="muted" style={{ fontSize: 13 }}>
              Первый игрок станет основным автоматически.
            </p>
          )}
        </>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  );
}
