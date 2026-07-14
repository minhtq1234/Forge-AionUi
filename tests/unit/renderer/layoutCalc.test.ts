import { describe, expect, it } from 'vitest';
import {
  calcLayoutMetrics,
  MIN_CHAT_PANEL_PX,
  MIN_ARTIFACT_PANEL_PX,
} from '@/renderer/pages/conversation/utils/layoutCalc';

const base = {
  containerWidth: 1400,
  chatSplitRatio: 50,
  workspaceEnabled: true,
  isDesktop: true,
  artifactCollapsed: false,
};

describe('calcLayoutMetrics (2-region)', () => {
  it('exposes chat + artifact minimums', () => {
    expect(MIN_CHAT_PANEL_PX).toBe(360);
    expect(MIN_ARTIFACT_PANEL_PX).toBe(340);
  });

  it('splits chat vs artifact by ratio when the artifact pane is open', () => {
    const m = calcLayoutMetrics(base);
    expect(m.chatFlex).toBe(50);
    expect(m.artifactVisible).toBe(true);
  });

  it('gives chat the full width when the artifact pane is collapsed', () => {
    const m = calcLayoutMetrics({ ...base, artifactCollapsed: true });
    expect(m.chatFlex).toBe(100);
    expect(m.artifactVisible).toBe(false);
  });

  it('clamps the chat ratio so neither pane drops below its min', () => {
    const m = calcLayoutMetrics({ ...base, containerWidth: 800 });
    expect(m.dynamicChatMinRatio).toBeCloseTo(45, 0); // 360/800*100
    expect(m.dynamicChatMaxRatio).toBeCloseTo(57.5, 0); // 100 - 340/800*100
  });
});
