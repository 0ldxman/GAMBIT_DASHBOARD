import type { Attachment } from "../types";

const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const isImage = (a: Attachment) => a.content_type.startsWith("image/");

/** Предпросмотр сообщения так, как его увидят в Discord. */
export function DiscordPreview({
  authorName,
  authorAvatar,
  content,
  useEmbed,
  embedTitle,
  embedDescription,
  embedImage,
  embedColor,
  attachments,
}: {
  authorName: string;
  authorAvatar: string;
  content: string;
  useEmbed: boolean;
  embedTitle: string;
  embedDescription: string;
  embedImage: string;
  embedColor: string;
  attachments: Attachment[];
}) {
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const images = attachments.filter(isImage);
  const files = attachments.filter((a) => !isImage(a));

  return (
    <div className="dc-message">
      <img
        className="dc-avatar"
        src={authorAvatar || DEFAULT_AVATAR}
        alt=""
        onError={(e) => {
          (e.target as HTMLImageElement).src = DEFAULT_AVATAR;
        }}
      />
      <div className="dc-body">
        <div className="dc-header">
          <span className="dc-author">{authorName || "Gambit Dashboard"}</span>
          <span className="dc-bot">BOT</span>
          <span className="dc-time">сегодня, {now}</span>
        </div>

        {content && <div className="dc-content">{content}</div>}

        {useEmbed && (
          <div
            className="dc-embed"
            style={{ borderLeftColor: /^#[0-9a-fA-F]{6}$/.test(embedColor) ? embedColor : "#4f545c" }}
          >
            {authorName && (
              <div className="dc-embed-author">
                {authorAvatar && <img src={authorAvatar} alt="" />}
                <span>{authorName}</span>
              </div>
            )}
            {embedTitle && <div className="dc-embed-title">{embedTitle}</div>}
            {embedDescription && <div className="dc-embed-desc">{embedDescription}</div>}
            {embedImage && (
              <img
                className="dc-embed-image"
                src={embedImage}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>
        )}

        {images.map((a) => (
          <img key={a.url} className="dc-attach-image" src={`/api${a.url}`} alt={a.filename} />
        ))}
        {files.map((a) => (
          <div key={a.url} className="dc-attach-file">
            <span>📎</span>
            <a href={`/api${a.url}`} target="_blank" rel="noreferrer">
              {a.filename}
            </a>
            <span className="muted">{formatSize(a.size)}</span>
          </div>
        ))}

        {!content && !useEmbed && attachments.length === 0 && (
          <div className="muted">Пустое сообщение — нечего отправлять.</div>
        )}
      </div>
    </div>
  );
}
