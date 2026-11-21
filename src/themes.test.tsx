// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { App } from './main';
import { playThemeSound } from './theme-sound';

vi.mock('./theme-sound', () => ({ playThemeSound: vi.fn().mockResolvedValue(undefined) }));

it('switches themes without losing exam input and restores the muted selection', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const host = document.createElement('div');
  document.body.append(host);
  let root = createRoot(host);
  const button = (name: string) => [...host.querySelectorAll('button')]
    .find(element => element.textContent === name || element.getAttribute('aria-label') === name)!;
  const click = (element: HTMLElement) => act(async () => element.click());
  try {
    await act(async () => root.render(<App/>));
    expect(document.documentElement.dataset.theme).toBe('minimal');
    const dialog = host.querySelector<HTMLDialogElement>('.theme-dialog')!;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    const openPicker = () => click(host.querySelector('.theme-trigger')!);
    const prompt = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'DBMS exam tomorrow');
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await openPicker();
    expect(dialog.open).toBe(true);
    await click(button('Cute'));
    expect(dialog.open).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('cute');
    expect(playThemeSound).toHaveBeenLastCalledWith('meow');
    await click(button('Squeeze the plush'));
    expect(host.querySelector('.prop-reaction')).not.toBeNull();
    await openPicker();
    await click(button('Anime Coded'));
    expect(button('Jujutsu Kaisen')).toBeDefined();
    await click(button('Jujutsu Kaisen'));
    expect(dialog.open).toBe(true);
    expect(playThemeSound).toHaveBeenLastCalledWith('thunder');
    expect(host.querySelectorAll('.character-card')).toHaveLength(8);
    await click(button('Nobara Kugisaki'));
    expect(dialog.open).toBe(false);
    expect(host.querySelector('.character-scene img')?.getAttribute('src')).toBe('/assets/anime/jjk/nobara.webp');
    await openPicker();
    await click(button('Demon Slayer'));
    expect(host.querySelector('.character-scene')?.textContent).toContain('Tanjiro Kamado');
    expect(button('Shinobu Kocho')).toBeDefined();
    expect(playThemeSound).toHaveBeenLastCalledWith('swish');
    await click(button('Attack on Titan'));
    expect(button('Mikasa Ackerman')).toBeDefined();
    await click(button('Levi Ackerman'));
    expect(dialog.open).toBe(false);
    expect(playThemeSound).toHaveBeenLastCalledWith('impact');
    await openPicker();
    await click(button('Minimal'));
    expect(dialog.open).toBe(false);
    expect(playThemeSound).toHaveBeenLastCalledWith('click');
    await openPicker();
    await click(host.querySelector('input[type="checkbox"]')!);
    const soundCount = vi.mocked(playThemeSound).mock.calls.length;
    await click(button('Anime Coded'));
    await click(button('Attack on Titan'));
    expect(playThemeSound).toHaveBeenCalledTimes(soundCount);
    expect(host.querySelector('textarea')).toBe(prompt);
    expect(prompt.value).toBe('DBMS exam tomorrow');
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<App/>));
    expect(document.documentElement.dataset.theme).toBe('anime-aot');
    expect(host.querySelector('.character-scene img')?.getAttribute('src')).toBe('/assets/anime/aot/levi.webp');
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(playThemeSound).toHaveBeenCalledTimes(soundCount);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});
