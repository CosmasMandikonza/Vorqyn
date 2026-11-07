import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import Home from '../app/page';
import Demo from '../app/demo/page';
import Workspace from '../app/workspace/page';
import { ThemeProvider } from '../components/theme-provider';
import { ThemeSelector } from '../components/theme-selector';
import { MobileNavigation } from '../components/mobile-navigation';

describe('VQ-02 entry routes', () => {
  it('gives both hero actions real destinations and identifies the concept', () => {
    render(<Home />);
    expect(screen.getAllByRole('link', { name: /Explore Demo/ })[0]).toHaveAttribute('href', '/demo');
    expect(screen.getAllByRole('link', { name: /Create Workspace/ })[0]).toHaveAttribute('href', '/workspace');
    expect(screen.getAllByText(/concept preview/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Autonomous work. Accountable outcomes.');
  });
  it('lets guests read the scenario without wallet or invented telemetry', () => {
    render(<Demo />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One mission. Three environments.');
    expect(screen.getByText(/No live telemetry, simulation or transactions/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /connect wallet|start mission/i })).not.toBeInTheDocument();
  });
  it('shows a truthful empty workspace and a readable builder outline', async () => {
    render(<Workspace />);
    expect(screen.getByRole('heading', { name: 'Your first mission starts here.' })).toBeVisible();
    expect(screen.getByText(/No organization or mission has been created/)).toBeVisible();
    await userEvent.click(screen.getByText('Preview mission structure'));
    expect(screen.getByText('Evidence & budget')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('accessible controls', () => {
  it('stores an explicit theme and supports keyboard selection', async () => {
    render(<ThemeProvider><ThemeSelector /></ThemeProvider>);
    const dark = await screen.findByRole('button', { name: 'Dark' });
    await userEvent.click(dark);
    expect(dark).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('vorqyn-theme')).toBe('dark');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('vorqyn-theme')).toBe('system');
  });
  it('opens the mobile sheet, closes on Escape and returns focus', async () => {
    render(<ThemeProvider><MobileNavigation /></ThemeProvider>);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Navigate VORQYN' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Explore Demo' })).toHaveAttribute('href', '/demo');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
