import { render, fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import Sidebar from './Sidebar.svelte';
import { activeView, status } from '../lib/store';

describe('Sidebar', () => {
  beforeEach(() => {
    activeView.set('overview');
    status.set({ connected: false, port: '', error: '', capabilities: {} });
  });

  it('renders every product area and changes the active view', async () => {
    const items = [
      { id: 'overview', icon: '⌂', label: 'Overview' },
      { id: 'network', icon: '◉', label: 'Network' },
      { id: 'data', icon: '⇄', label: 'Mobile data' },
    ];
    const { getByRole } = render(Sidebar, { props: { items } });
    expect(getByRole('button', { name: /Overview$/ })).toBeTruthy();
    expect(getByRole('button', { name: /Network$/ })).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: /Mobile data$/ }));
    let selected = '';
    const unsubscribe = activeView.subscribe((value) => {
      selected = value;
    });
    expect(selected).toBe('data');
    unsubscribe();
  });

  it('communicates disconnected state clearly', () => {
    const { getByText } = render(Sidebar, { props: { items: [] } });
    expect(getByText('Disconnected')).toBeTruthy();
  });
});
