/** An XML element as the readers need it: name (without namespace prefix), attributes, children. Text is dropped. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
}

const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return entities[code] ?? match;
  });

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/**
 * A small, forgiving XML reader for the structure of 3MF models and SVG drawings (workers have no
 * DOMParser). Declarations, comments, CDATA and doctype are skipped.
 */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attributes: {}, children: [] };
  const stack: XmlElement[] = [root];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attribute = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    const [, closing, opening, attributeText, selfClosing] = match;
    if (closing) {
      const name = localName(closing);
      while (stack.length > 1 && (stack.pop() as XmlElement).name !== name);
      continue;
    }
    if (!opening) continue;
    const attributes: Record<string, string> = {};
    for (let a = attribute.exec(attributeText ?? ''); a; a = attribute.exec(attributeText ?? '')) attributes[localName(a[1] as string)] = decode(a[2] ?? a[3] ?? '');
    const element: XmlElement = { name: localName(opening), attributes, children: [] };
    (stack[stack.length - 1] as XmlElement).children.push(element);
    if (!selfClosing) stack.push(element);
  }
  return root;
}

/** All descendants with the given name, in document order. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  return element.children.flatMap((child) => [...(child.name === name ? [child] : []), ...descendants(child, name)]);
}
