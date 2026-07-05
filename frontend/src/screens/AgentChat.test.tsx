import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  createAgentSession: vi.fn().mockResolvedValue({ id: 'sess1' }),
  getPtyToken: vi.fn().mockResolvedValue('tok'),
}));
import { AgentChat } from './AgentChat';

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
  emit(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }); }
}
let lastWs: FakeWS | null = null;
beforeEach(() => {
  lastWs = null;
  vi.stubGlobal('WebSocket', class extends FakeWS { constructor() { super(); lastWs = this; } });
});
afterEach(() => vi.unstubAllGlobals());

describe('AgentChat', () => {
  it('runs a turn: streams assistant text, shows a tool chip + result, closes with a summary', async () => {
    const user = userEvent.setup();
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    const input = await screen.findByLabelText('Message');

    await user.type(input, 'fix the bug');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(JSON.parse(lastWs!.sent.at(-1)!)).toMatchObject({ type: 'user', text: 'fix the bug' });
    expect(screen.getByText('fix the bug')).toBeInTheDocument();

    await act(async () => {
      lastWs!.emit({ type: 'assistant_delta', text: 'Look' });
      lastWs!.emit({ type: 'assistant_delta', text: 'ing…' });
      lastWs!.emit({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } });
      lastWs!.emit({ type: 'tool_result', id: 't1', ok: true, output: 'ok' });
      lastWs!.emit({ type: 'result', ok: true, ms: 2400 });
    });

    expect(screen.getByText('Looking…')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Ran 1')).toBeInTheDocument();
    expect(screen.getByText('~2.4s')).toBeInTheDocument();
  });

  it('surfaces the error text on a failed turn (e.g. claude not authenticated)', async () => {
    const user = userEvent.setup();
    render(<AgentChat sessionId="s1" id="hub" label="hub" onStatus={() => {}} />);
    await user.type(await screen.findByLabelText('Message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      lastWs!.emit({ type: 'result', ok: false, ms: 800, text: 'Failed to authenticate. API Error: 401' });
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/Failed to authenticate/)).toBeInTheDocument();
  });

  it('shows Stop while running and sends a stop message', async () => {
    const user = userEvent.setup();
    render(<AgentChat sessionId="s1" id="d" label="D" onStatus={() => {}} />);
    await user.type(await screen.findByLabelText('Message'), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const stopBtn = await screen.findByRole('button', { name: 'Stop' });
    await user.click(stopBtn);
    expect(JSON.parse(lastWs!.sent.at(-1)!)).toEqual({ type: 'stop' });
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('expands a tool chip to show input + output on tap', async () => {
    const user = userEvent.setup();
    render(<AgentChat sessionId="s1" id="d" label="D" onStatus={() => {}} />);
    await user.type(await screen.findByLabelText('Message'), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      lastWs!.emit({ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/auth.ts' } });
      lastWs!.emit({ type: 'tool_result', id: 't1', ok: true, output: 'FILE BODY' });
    });
    // collapsed: target shows basename
    expect(screen.getByText('auth.ts')).toBeInTheDocument();
    await user.click(screen.getByText('Read'));
    expect(screen.getByText(/FILE BODY/)).toBeInTheDocument();
  });
});
