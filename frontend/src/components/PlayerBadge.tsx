import type { Assignment } from "../types";

/** Игрок: аватар + имя на сервере, с ID в подсказке. */
export function PlayerBadge({
  assignment,
  size = 22,
}: {
  assignment: Assignment | null | undefined;
  size?: number;
}) {
  if (!assignment?.player_id) return <span className="muted">не закреплён</span>;

  const name = assignment.player_name || assignment.player_id;
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }} title={assignment.player_id}>
      {assignment.player_avatar_url && (
        <img
          src={assignment.player_avatar_url}
          alt=""
          width={size}
          height={size}
          style={{ borderRadius: "50%", flexShrink: 0 }}
        />
      )}
      <span>{name}</span>
    </span>
  );
}
