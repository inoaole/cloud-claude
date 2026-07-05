import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ getPtyToken: vi.fn().mockResolvedValue('tok') }));
import { CommandChat } from './CommandChat';

class FakeWS {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor() { setTimeout(() => this.onopen?.(), 0); }
  send(d: string) { this.sent.push(d); }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
let lastWs: FakeWS | null = null;

beforeEach(() => {
  lastWs = null;
  vi.stubGlobal('WebSocket', class extends FakeWS { constructor() { super(); lastWs = this; } });
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const lastRunId = () => JSON.parse(lastWs!.sent.at(-1)!).id as string;

describe('CommandChat', () => {
  it('runs a command and renders its output block + success code', async () => {
    const user = userEvent.setup();
    render(<CommandChat id="hub" label="Ubuntu hub" onStatus={() => {}} />);
    // composer enables once connected
    const input = await screen.findByLabelText('Command');
    await user.type(input, 'ls');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    const sent = JSON.parse(lastWs!.sent.at(-1)!);
    expect(sent).toMatchObject({ type: 'run', cmd: 'ls' });

    const bid = lastRunId();
    await act(async () => {
      lastWs!.emit({ type: 'out', id: bid, data: 'file1\nfile2\n' });
      lastWs!.emit({ type: 'done', id: bid, exit: 0 });
    });

    expect(screen.getByText(/file1/)).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('shows a failure code for a non-zero exit', async () => {
    const user = userEvent.setup();
    render(<CommandChat id="hub" label="hub" onStatus={() => {}} />);
    await user.type(await screen.findByLabelText('Command'), 'false');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await act(async () => { lastWs!.emit({ type: 'done', id: lastRunId(), exit: 1 }); });
    expect(screen.getByText('✗ 1')).toBeInTheDocument();
  });

  it('a preset chip runs in one tap', async () => {
    const user = userEvent.setup();
    render(<CommandChat id="hub" label="hub" onStatus={() => {}} />);
    await screen.findByLabelText('Command');
    await user.click(screen.getByRole('button', { name: 'git status' }));
    expect(JSON.parse(lastWs!.sent.at(-1)!)).toMatchObject({ type: 'run', cmd: 'git status' });
  });
});
