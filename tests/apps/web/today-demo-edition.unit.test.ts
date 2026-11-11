import { expect, test } from 'bun:test';
import { DEMO_TODAY_EDITION, demoTodayEditionMarkdown } from '../../../apps/web/src/workspace/today-demo-edition';
import { parseRenderedEdition } from '../../../apps/web/src/workspace/today-edition.policy';

test('the demo edition is a complete three-story newspaper with verified links', () => {
  expect(DEMO_TODAY_EDITION.stories).toHaveLength(3);
  expect(DEMO_TODAY_EDITION.introduction.split(/(?<=[.!?])\s+/).length).toBeGreaterThanOrEqual(4);
  for (const story of DEMO_TODAY_EDITION.stories) {
    expect(story.title.length).toBeGreaterThan(8);
    expect(story.summary.length).toBeGreaterThan(40);
    expect(story.url).toMatch(/^https:\/\//);
  }
  const markdown = demoTodayEditionMarkdown();
  expect(markdown.match(/\[Read source\]/g)).toHaveLength(3);
  expect(parseRenderedEdition(markdown)).toEqual(DEMO_TODAY_EDITION);
});
