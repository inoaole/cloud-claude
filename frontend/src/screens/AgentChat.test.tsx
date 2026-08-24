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

describe('AgentChat — resuming after leaving the app', () => {
  it('rebuilds the chat from the hub transcript on reattach', async () => {
    // The bug: the transcript lived only in component state and the hub kept
    // nothing, so remounting showed an empty chat with no way to ask for history.
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => {
      lastWs!.emit({
        type: 'history',
        events: [
          { type: 'user', text: 'run the tests' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
          { type: 'tool_result', id: 't1', ok: true, output: '12 passed' },
          { type: 'assistant', text: 'All 12 tests pass.' },
          { type: 'result', ok: true, ms: 4200 },
        ],
      });
    });

    expect(screen.getByText('run the tests')).toBeInTheDocument();
    expect(screen.getByText('All 12 tests pass.')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('~4.2s')).toBeInTheDocument();
  });

  it('replays multiple turns in order', async () => {
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => {
      lastWs!.emit({
        type: 'history',
        events: [
          { type: 'user', text: 'first question' },
          { type: 'assistant', text: 'first answer' },
          { type: 'result', ok: true, ms: 1000 },
          { type: 'user', text: 'second question' },
          { type: 'assistant', text: 'second answer' },
          { type: 'result', ok: true, ms: 2000 },
        ],
      });
    });

    const first = screen.getByText('first answer');
    const second = screen.getByText('second answer');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a turn still running when the app closed shows Stopped, not a live spinner', async () => {
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => {
      lastWs!.emit({
        type: 'history',
        events: [{ type: 'user', text: 'long job' }, { type: 'assistant', text: 'working on it' }],
        running: false,
      });
    });

    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('claude is working…')).not.toBeInTheDocument();
  });

  it('history does not duplicate turns already on screen', async () => {
    // A live reconnect (socket dropped, component still mounted) replays the same
    // transcript. Folding it in again would double every turn.
    const user = userEvent.setup();
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    const input = await screen.findByLabelText('Message');

    await user.type(input, 'only once');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    act(() => {
      lastWs!.emit({ type: 'history', events: [{ type: 'user', text: 'only once' }] });
    });

    expect(screen.getAllByText('only once')).toHaveLength(1);
  });

  it('assistant output arriving with no turn yet is rendered, not dropped', async () => {
    // Every non-START action targeted turns[last]; with turns empty, map over [] threw
    // the event away. Mid-flight output after a reattach vanished silently.
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => { lastWs!.emit({ type: 'assistant', text: 'orphaned but visible' }); });

    expect(screen.getByText('orphaned but visible')).toBeInTheDocument();
  });
});

describe('AgentChat — the agent keeps working in the background', () => {
  it('an in-flight turn resumes as running, not Stopped', async () => {
    // The child now survives a detach, so an open turn is usually still working.
    // Calling that Stopped would be a lie and would invite a prompt on top of it.
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => {
      lastWs!.emit({
        type: 'history',
        events: [{ type: 'user', text: 'long refactor' }, { type: 'assistant', text: 'starting…' }],
        running: true,
      });
    });

    expect(screen.getByText('claude is working…')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
  });

  it('work done while away is visible on return, and the turn closes normally', async () => {
    render(<AgentChat sessionId="s1" id="macbook-pro" label="MacBook Pro" onStatus={() => {}} />);
    await screen.findByLabelText('Message');

    act(() => {
      lastWs!.emit({
        type: 'history',
        events: [
          { type: 'user', text: 'refactor the parser' },
          { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/src/parse.ts' } },
          { type: 'tool_result', id: 'e1', ok: true, output: 'ok' },
        ],
        running: true,
      });
    });
    expect(screen.getByText('Edit')).toBeInTheDocument();       // happened while away
    expect(screen.getByText('claude is working…')).toBeInTheDocument();

    act(() => { lastWs!.emit({ type: 'result', ok: true, ms: 61000 }); });
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('~61.0s')).toBeInTheDocument();
  });
});
