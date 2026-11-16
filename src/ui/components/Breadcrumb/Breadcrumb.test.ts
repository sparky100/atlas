import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { reportsSection } from '../../nav/reportsSection';
import { Breadcrumb } from './Breadcrumb';

function render(withSection: boolean): string {
  const props = {
    org: { label: 'Demonstration', href: '/o/demo' },
    model: { label: 'Distribution', href: '/o/demo/m/dist' },
    refLabel: 'live model',
    segments: [{ label: 'Boundary crossings', href: '/o/demo/m/dist/boundary-crossings' }],
    ...(withSection ? { section: reportsSection('demo', 'dist') } : {}),
  };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Breadcrumb, props)));
}

describe('Breadcrumb section step', () => {
  it('shows Reports as a link to the hub between the version chip and the page', () => {
    const html = render(true);
    expect(html).toContain('href="/o/demo/m/dist/reports"');
    expect(html.indexOf('live model')).toBeLessThan(html.indexOf('Reports'));
    expect(html.indexOf('Reports')).toBeLessThan(html.indexOf('Boundary crossings'));
  });

  it('shows no section step when none is given', () => {
    expect(render(false)).not.toContain('Reports');
  });
});
