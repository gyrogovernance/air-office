import { describe, expect, test } from 'bun:test';
import {
  layoutViewportSize,
  readInterfaceScaleChoice,
  recommendedInterfaceScale,
  resolveInterfaceScale,
} from '../../../../apps/web/src/settings/display-scale.policy';

describe('display-scale.policy', () => {
  test('recommends compact for a small laptop window', () => {
    expect(recommendedInterfaceScale(1280, 720)).toBe('compact');
    expect(recommendedInterfaceScale(1366, 768)).toBe('compact');
    expect(recommendedInterfaceScale(1100, 800)).toBe('compact');
  });

  test('recommends comfortable for a mid-size desktop window', () => {
    expect(recommendedInterfaceScale(1440, 900)).toBe('comfortable');
    expect(recommendedInterfaceScale(1600, 900)).toBe('comfortable');
  });

  test('recommends large for a wide high window', () => {
    expect(recommendedInterfaceScale(1920, 1080)).toBe('large');
  });

  test('keeps the previous Auto band across a small threshold margin', () => {
    expect(recommendedInterfaceScale(1450, 900, 'compact')).toBe('compact');
    expect(recommendedInterfaceScale(1500, 900, 'compact')).toBe('comfortable');
    expect(recommendedInterfaceScale(1650, 980, 'large')).toBe('large');
    expect(recommendedInterfaceScale(1500, 900, 'comfortable')).toBe('comfortable');
  });

  test('layoutViewportSize prefers outer dimensions so zoom does not feed back', () => {
    expect(layoutViewportSize({ outerWidth: 1600, outerHeight: 1000, innerWidth: 1200, innerHeight: 800 })).toEqual({
      width: 1600,
      height: 1000,
    });
    expect(layoutViewportSize({ outerWidth: 0, outerHeight: 0, innerWidth: 1200, innerHeight: 800 })).toEqual({
      width: 1200,
      height: 800,
    });
  });

  test('missing preference resolves through the screen recommendation', () => {
    expect(readInterfaceScaleChoice(undefined)).toBe('auto');
    expect(resolveInterfaceScale(undefined, 1280, 720)).toBe('compact');
    expect(resolveInterfaceScale('auto', 1920, 1080)).toBe('large');
  });

  test('an explicit preference wins over the screen recommendation', () => {
    expect(resolveInterfaceScale('large', 1280, 720)).toBe('large');
    expect(resolveInterfaceScale('compact', 1920, 1080)).toBe('compact');
    expect(resolveInterfaceScale('comfortable', 1100, 700)).toBe('comfortable');
  });
});
