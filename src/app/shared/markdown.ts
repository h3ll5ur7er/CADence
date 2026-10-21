/**
 * A project description in Markdown as HTML (CAD-149): headings, paragraphs, lists, emphasis, code and
 * links. Everything is escaped first, so the text can hold no markup of its own; links go only to
 * web pages and mail addresses.
 */
export function markdownToHtml(markdown: string): string {
  const html: string[] = [];
  let list: 'ul' | 'ol' | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const close = () => {
    if (list) html.push(`</${list}>`);
    list = undefined;
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      close();
    } else if (heading) {
      flush();
      close();
      const level = (heading[1] as string).length + 2;
      html.push(`<h${level}>${inline(heading[2] as string)}</h${level}>`);
    } else if (item) {
      flush();
      const kind = item[1] ? 'ul' : 'ol';
      if (list !== kind) {
        close();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline(item[3] as string)}</li>`);
    } else {
      close();
      paragraph.push(line.trim());
    }
  }
  flush();
  close();
  return html.join('');
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Code, links, bold and italics within a line. */
function inline(text: string): string {
  // Code spans first: nothing inside them is Markdown.
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${escape(part.slice(1, -1))}</code>`
        : escape(part)
            .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>'),
    )
    .join('');
}
