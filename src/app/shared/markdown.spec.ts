import { markdownToHtml } from './markdown';

describe('markdownToHtml', () => {
  it('writes headings, paragraphs, lists, emphasis, code and links', () => {
    const html = markdownToHtml('# Robot arm\n\nServo **MG996R**, *metal gears*.\nSee `M3 x 12`.\n\n- base\n- arm\n\n1. print\n2. assemble\n\n[Datasheet](https://example.com/servo.pdf)');
    expect(html).toBe(
      '<h3>Robot arm</h3><p>Servo <strong>MG996R</strong>, <em>metal gears</em>.<br>See <code>M3 x 12</code>.</p><ul><li>base</li><li>arm</li></ul><ol><li>print</li><li>assemble</li></ol><p><a href="https://example.com/servo.pdf" target="_blank" rel="noopener">Datasheet</a></p>',
    );
  });

  it('keeps markup and scripts as text, and links to web pages and mail only', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)> [click](javascript:alert(1)) `<b>`');
    expect(html).toBe('<p>&lt;img src=x onerror=alert(1)&gt; [click](javascript:alert(1)) <code>&lt;b&gt;</code></p>');
  });
});
