import { useState } from "react";
import { api } from "../../api";
import { useAsync } from "../../hooks";
import { PlayerBadge } from "../../components/PlayerBadge";
import type { DiscordMember, Member } from "../../types";

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
  const [playerId, setPlayerId] = useState("");
  const [role, setRole] = useState("");
  const [lookup, setLookup] = useState<DiscordMember | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    members.reload();
    onChanged?.();
  }

  async function check() {
    setLookup(null);
    setErr(null);
    if (!/^\d+$/.test(playerId.trim())) {
      setErr("ID должен состоять только из цифр");
      return;
    }
    try {
      setLookup(await api.getDiscordMember(projectId, playerId.trim()));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function add() {
    if (!/^\d+$/.test(playerId.trim())) {
      setErr("ID должен состоять только из цифр");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.addMember(projectId, entityId, {
        player_id: playerId.trim(),
        role,
        // Первый добавленный автоматически станет основным на бэкенде.
        is_primary: (members.data ?? []).length === 0,
      });
      setPlayerId("");
      setRole("");
      setLookup(null);
      refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(m: Member) {
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
        <div className="row spread" key={m.id} style={{ marginTop: 8 }}>
          <PlayerBadge member={m} />
          <div className="row" style={{ gap: 6 }}>
            <input
              value={m.role}
              placeholder="роль"
              style={{ width: 160 }}
              onChange={(e) => changeRole(m, e.target.value)}
            />
            {!m.is_primary && (
              <button className="ghost" onClick={() => makePrimary(m)}>
                Сделать основным
              </button>
            )}
            <button className="ghost danger" onClick={() => remove(m)}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input
          value={playerId}
          placeholder="Discord user ID"
          onChange={(e) => {
            setPlayerId(e.target.value);
            setLookup(null);
          }}
        />
        <input
          value={role}
          placeholder="роль (напр. лидер)"
          style={{ width: 180 }}
          onChange={(e) => setRole(e.target.value)}
        />
        <button className="ghost" onClick={check} disabled={!playerId.trim()}>
          Проверить
        </button>
        <button className="primary" onClick={add} disabled={busy || !playerId.trim()}>
          Добавить
        </button>
      </div>
      {lookup && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <img src={lookup.avatar_url} alt="" width={24} height={24} style={{ borderRadius: "50%" }} />
          <span>{lookup.name}</span>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  );
}
