import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessions } from './AgentSessions';
import { listAgentSessions, createAgentSession, killAgentSession, type AgentSession } from '../lib/api';

vi.mock('../lib/api', () => ({
  listAgentSessions: vi.fn(),
  createAgentSession: vi.fn(),
  killAgentSession: vi.fn().mockResolvedValue(undefined),
}));
const mkSession = (over: Partial<AgentSession>): AgentSession => ({
  id: 'x', deviceId: 'macbook-pro', kind: 'agent', title: 'x', cwd: null, status: 'running', createdAt: Date.now(), ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('AgentSessions', () => {
  it('lists sessions and opens one on tap', async () => {
    const user = userEvent.setup();
    vi.mocked(listAgentSessions).mockResolvedValue([mkSession({ id: 's1', title: 'bugfix' })]);
    const onOpen = vi.fn();
    render(<AgentSessions device="macbook-pro" onOpen={onOpen} />);

    await user.click(await screen.findByText('bugfix'));
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('creates a New session and opens it', async () => {
    const user = userEvent.setup();
    vi.mocked(listAgentSessions).mockResolvedValue([]);
    vi.mocked(createAgentSession).mockResolvedValue(mkSession({ id: 'new1' }));
    const onOpen = vi.fn();
    render(<AgentSessions device="macbook-pro" onOpen={onOpen} />);

    await user.click(await screen.findByRole('button', { name: '+ New session' }));
    expect(createAgentSession).toHaveBeenCalledWith('macbook-pro');
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith('new1'));
  });

  it('kills a session', async () => {
    const user = userEvent.setup();
    vi.mocked(listAgentSessions).mockResolvedValue([mkSession({ id: 's1', title: 'old' })]);
    render(<AgentSessions device="macbook-pro" onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Kill old' }));
    expect(killAgentSession).toHaveBeenCalledWith('s1');
  });
});
