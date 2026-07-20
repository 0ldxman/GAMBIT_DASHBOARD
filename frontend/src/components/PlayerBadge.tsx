import type { Member } from "../types";

/** Игрок: аватар + имя на сервере, с ID в подсказке. */
export function PlayerBadge({ member, size = 22 }: { member: Member; size?: number }) {
  const name = member.player_name || member.player_id;
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }} title={member.player_id}>
      {member.player_avatar_url && (
        <img
          src={member.player_avatar_url}
          alt=""
          width={size}
          height={size}
          style={{ borderRadius: "50%", flexShrink: 0 }}
        />
      )}
      <span>{name}</span>
      {member.role && <span className="muted">— {member.role}</span>}
      {member.is_primary && <span className="badge published">основной</span>}
    </span>
  );
}

/** Компактная сводка по составу игроков для таблиц. */
export function MembersSummary({ members }: { members: Member[] }) {
  if (members.length === 0) return <span className="muted">нет игроков</span>;
  const primary = members.find((m) => m.is_primary) ?? members[0];
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }}>
      <PlayerBadge member={primary} />
      {members.length > 1 && (
        <span className="muted" title={members.map((m) => m.player_name || m.player_id).join(", ")}>
          +{members.length - 1}
        </span>
      )}
    </span>
  );
}
