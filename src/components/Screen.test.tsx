// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { appError } from '../lib/errors';
import type { SessionActions } from '../state/actions';
import type { Phase, SessionState, Transfer } from '../state/types';
import { Screen } from './Screen';

function actions(): SessionActions {
  return {
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    clearFiles: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    confirmPairing: vi.fn(),
    rejectPairing: vi.fn(),
    leave: vi.fn(),
    reset: vi.fn(),
    sendSelected: vi.fn(),
    acceptIncoming: vi.fn(),
    declineIncoming: vi.fn(),
    cancelTransfer: vi.fn(),
    clearFinished: vi.fn(),
  };
}

function state(overrides: Partial<SessionState> = {}): SessionState {
  return {
    support: { ok: true, missing: [], canSaveToDisk: false },
    deviceLabel: 'Firefox on Mac',
    phase: { name: 'idle' },
    selected: [],
    connection: 'unknown',
    transfers: [],
    ...overrides,
  };
}

const paired: Phase = { name: 'paired', peerLabel: 'Chrome on Android', sas: '123 456' };
const file = (name: string, size: number) => ({ id: name, file: new File([new Uint8Array(size)], name) });

function transfer(overrides: Partial<Transfer>): Transfer {
  return {
    id: 't1',
    direction: 'in',
    status: 'transferring',
    files: [{ id: 'f1', name: 'photo.jpg', size: 2_000_000, type: 'image/jpeg', status: 'active' }],
    totalBytes: 2_000_000,
    bytes: 500_000,
    bytesPerSecond: 250_000,
    etaSeconds: 6,
    ...overrides,
  };
}

describe('Screen', () => {
  it('shows the empty first screen with a drop area and pairing options', async () => {
    const a = actions();
    render(<Screen state={state()} actions={a} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Send files directly' })).toBeInTheDocument();
    expect(screen.getByText('Drop files here')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create a pairing code' }));
    expect(a.createRoom).toHaveBeenCalled();
  });

  it('validates a typed code before joining', async () => {
    const a = actions();
    render(<Screen state={state()} actions={a} />);
    const input = screen.getByLabelText('Enter a code from another device');
    await userEvent.type(input, 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('6-character code');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(a.joinRoom).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, 'k7q-m4p');
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(a.joinRoom).toHaveBeenCalledWith('K7QM4P');
  });

  it('adds files chosen with the file picker', async () => {
    const a = actions();
    render(<Screen state={state()} actions={a} />);
    const f = new File(['hi'], 'hi.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByTestId('file-input'), f);
    expect(a.addFiles).toHaveBeenCalledWith([f]);
  });

  it('shows the code, link, and countdown while waiting', () => {
    render(<Screen state={state({ phase: { name: 'waiting', code: 'K7QM4P', expiresAt: Date.now() + 125_000 } })} actions={actions()} />);
    expect(screen.getByText('K7Q-M4P')).toBeInTheDocument();
    expect(screen.getByText(/#join=K7QM4P$/)).toBeInTheDocument();
    expect(screen.getByText(/Code expires in 2:0[45]/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeInTheDocument();
  });

  it('asks both people to compare the verification code', async () => {
    const a = actions();
    const phase: Phase = { name: 'verify', peerLabel: 'Chrome on Android', sas: '482 915', localConfirmed: false, remoteConfirmed: false };
    const { rerender } = render(<Screen state={state({ phase })} actions={a} />);
    expect(screen.getByText('482 915')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Android')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    expect(a.confirmPairing).toHaveBeenCalled();

    rerender(<Screen state={state({ phase: { ...phase, localConfirmed: true } })} actions={a} />);
    expect(screen.getByText(/Waiting for the other device to confirm/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Codes match' })).not.toBeInTheDocument();
  });

  it('shows the recipient and selected files before sending', async () => {
    const a = actions();
    render(<Screen state={state({ phase: paired, connection: 'direct', selected: [file('a.pdf', 1500), file('b.zip', 2_500_000)] })} actions={a} />);
    expect(screen.getByText('Direct connection')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Selected files' });
    expect(within(list).getByText('a.pdf')).toBeInTheDocument();
    expect(within(list).getByText('b.zip')).toBeInTheDocument();
    expect(screen.getAllByText('Chrome on Android').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Send 2.5 MB' }));
    expect(a.sendSelected).toHaveBeenCalled();
  });

  it('labels a relayed connection honestly', () => {
    render(<Screen state={state({ phase: paired, connection: 'relay' })} actions={actions()} />);
    expect(screen.getByText('Relayed connection')).toBeInTheDocument();
    expect(screen.getByText(/passes through a TURN relay server/)).toBeInTheDocument();
    expect(screen.queryByText('Direct connection')).not.toBeInTheDocument();
  });

  it('disables sending until a device is paired', () => {
    render(<Screen state={state({ selected: [file('a.pdf', 10)] })} actions={actions()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Connect a device to send these files.')).toBeInTheDocument();
  });

  it('asks the receiver to accept an incoming transfer', async () => {
    const a = actions();
    render(<Screen state={state({ phase: paired, transfers: [transfer({ status: 'incoming', bytes: 0 })] })} actions={a} />);
    expect(screen.getByText('Chrome on Android wants to send you 1 file')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(a.acceptIncoming).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(a.declineIncoming).toHaveBeenCalled();
  });

  it('offers saving to disk and warns about memory for large transfers', () => {
    const big = transfer({ status: 'incoming', totalBytes: 4e9, files: [{ id: 'f', name: 'movie.mkv', size: 4e9, type: '', status: 'queued' }] });
    const { rerender } = render(<Screen state={state({ phase: paired, transfers: [big] })} actions={actions()} />);
    expect(screen.getByText('This is a large transfer')).toBeInTheDocument();
    rerender(<Screen state={state({ phase: paired, transfers: [big], support: { ok: true, missing: [], canSaveToDisk: true } })} actions={actions()} />);
    expect(screen.getByRole('button', { name: 'Save to…' })).toBeInTheDocument();
  });

  it('shows progress, speed, and a cancel button while transferring', async () => {
    const a = actions();
    render(<Screen state={state({ phase: paired, transfers: [transfer({})] })} actions={a} />);
    expect(screen.getByText('Receiving 1 file from Chrome on Android', { selector: '.transfer__title' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Receiving progress' })).toHaveAttribute('value', '25');
    expect(screen.getByText(/25% · 500 KB of 2 MB/)).toBeInTheDocument();
    expect(screen.getByText(/250 KB\/s · 6 s left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(a.cancelTransfer).toHaveBeenCalled();
  });

  it('shows verified files with download links when complete', () => {
    const done = transfer({
      status: 'complete',
      bytes: 2_000_000,
      files: [
        { id: 'a', name: 'photo.jpg', size: 2_000_000, type: '', status: 'done', url: 'blob:x' },
        { id: 'b', name: 'bad.bin', size: 10, type: '', status: 'failed', error: 'Checksum mismatch — the file was corrupted in transit.' },
      ],
    });
    render(<Screen state={state({ phase: paired, transfers: [done] })} actions={actions()} />);
    expect(screen.getByText('Received 1 of 2 files', { selector: '.transfer__title' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Download photo.jpg' });
    expect(link).toHaveAttribute('href', 'blob:x');
    expect(link).toHaveAttribute('download', 'photo.jpg');
    expect(screen.getByText(/Checksum mismatch/)).toBeInTheDocument();
  });

  it('explains errors with a recovery step', async () => {
    const a = actions();
    render(<Screen state={state({ phase: { name: 'error', error: appError('room_expired') } })} actions={a} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The pairing code expired');
    expect(screen.getByText(/Create a new code/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(a.reset).toHaveBeenCalled();
  });

  it('keeps received files available after the other device disconnects', () => {
    const done = transfer({ status: 'complete', files: [{ id: 'a', name: 'photo.jpg', size: 1, type: '', status: 'done', url: 'blob:y' }] });
    render(<Screen state={state({ phase: { name: 'disconnected', peerLabel: 'Chrome on Android' }, transfers: [done] })} actions={actions()} />);
    expect(screen.getByText('Chrome on Android disconnected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download photo.jpg' })).toBeInTheDocument();
  });

  it('tells people on unsupported browsers what to do', () => {
    render(<Screen state={state({ support: { ok: false, missing: ['WebRTC data channels'], canSaveToDisk: false } })} actions={actions()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This browser can’t send files directly');
    expect(screen.getByText(/WebRTC data channels/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a pairing code' })).not.toBeInTheDocument();
  });
});
