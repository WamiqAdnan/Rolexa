import type { ReactNode } from "react";

/**
 * Minimal Markdown renderer for the subset the tailorer emits: headings,
 * bullet lists, paragraphs and bold runs. Deliberately not a general-purpose
 * parser — CV content is rendered as text, never as HTML.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let list: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={key++}>
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={key++}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushAll = () => {
    flushList();
    flushParagraph();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = inline(heading[2]);
      if (level === 1) blocks.push(<h1 key={key++}>{text}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++}>{text}</h2>);
      else blocks.push(<h3 key={key++}>{text}</h3>);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushAll();

  return <div className="prose-cv text-sm">{blocks}</div>;
}

/** Handle **bold** and `code`; everything else stays literal text. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={key++} className="rounded bg-ink-100 px-1 py-0.5 text-xs dark:bg-ink-800">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
