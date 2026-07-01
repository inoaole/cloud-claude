import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Unlock } from './Unlock';
import { login } from '../lib/api';

vi.mock('../lib/api', () => ({ login: vi.fn() }));
const mockLogin = vi.mocked(login);

const filled = () =>
  within(screen.getByTestId('pin-dots'))
    .queryAllByRole('generic')
    .filter((el) => el.getAttribute('data-filled') === 'true').length;

describe('Unlock', () => {
  beforeEach(() => mockLogin.mockReset());

  it('fills a dot per digit and submits the entered PIN', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ kind: 'ok' });
    const onAuthed = vi.fn();
    render(<Unlock onAuthed={onAuthed} />);

    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: '9' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(filled()).toBe(3);

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(mockLogin).toHaveBeenCalledWith('092');
  });

  it('shows an error and clears the PIN on a wrong code', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ kind: 'bad_pin' });
    render(<Unlock onAuthed={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Wrong PIN')).toBeInTheDocument();
    expect(filled()).toBe(0);
  });

  it('locks the keypad and counts down on 429', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ kind: 'locked', retryAfter: 60 });
    render(<Unlock onAuthed={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText(/retry in 60s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('reports when the hub has no PIN configured', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ kind: 'no_pin' });
    render(<Unlock onAuthed={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('No PIN set on the hub')).toBeInTheDocument();
  });
});
