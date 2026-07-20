/** Колокольчик: игроки этой сущности ждут ответа мастера. */
export function PingBell({ count }: { count: number }) {
  if (count <= 0) return null;
  const word = count === 1 ? "пинг" : count < 5 ? "пинга" : "пингов";
  return (
    <span
      className="ping-bell"
      title={`${count} ${word} от игроков — ожидают ответа`}
      aria-label={`${count} ${word} от игроков`}
    >
      🔔{count > 1 && <span className="ping-count">{count}</span>}
    </span>
  );
}
