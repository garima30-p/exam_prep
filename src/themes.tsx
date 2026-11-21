/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import { playThemeSound } from './theme-sound';

const themes = {
  minimal: { name: 'Minimal', sound: 'click' },
  'anime-jjk': { name: 'Jujutsu Kaisen', sound: 'thunder', character: 'Satoru Gojo', art: 'gojo.webp' },
  'anime-demon-slayer': { name: 'Demon Slayer', sound: 'swish', character: 'Tanjiro Kamado', art: 'tanjiro.webp' },
  'anime-aot': { name: 'Attack on Titan', sound: 'impact', character: 'Levi Ackerman', art: 'levi.webp' },
  cute: { name: 'Cute', sound: 'meow' },
} as const;

type Theme = keyof typeof themes;
type Anime = Extract<Theme, `anime-${string}`>;
const anime = Object.keys(themes).filter((id): id is Anime => id.startsWith('anime-'));
const storageKey = 'in-nocent-theme';
const muteKey = 'in-nocent-theme-muted';
const art = import.meta.glob<string>('./theme-assets/*.webp', { query: '?url', import: 'default' });

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences still apply for this session. */ }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const value = read(storageKey);
    if (value === 'anime') return 'anime-jjk';
    if (value === 'soft') return 'cute';
    return value && Object.hasOwn(themes, value) ? value as Theme : 'minimal';
  });
  const [muted, setMuted] = useState(() => read(muteKey) === 'true');
  const [transition, setTransition] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
      getComputedStyle(document.documentElement).backgroundColor);
    write(storageKey, theme);
  }, [theme]);

  function select(next: Theme) {
    if (next === theme) return;
    setTheme(next);
    setTransition(value => value + 1);
    if (!muted) void playThemeSound(themes[next].sound).catch(() => { /* Audio may be unavailable. */ });
  }

  function mute(value: boolean) {
    setMuted(value);
    write(muteKey, String(value));
  }

  return { theme, muted, transition, select, mute };
}

export function ThemePicker({ theme, muted, select, mute }: ReturnType<typeof useTheme>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showAnime, setShowAnime] = useState(false);
  function open() {
    setShowAnime(anime.some(id => id === theme));
    dialog.current?.showModal();
  }

  return <>
    <button className="secondary theme-trigger" type="button" onClick={open}>
      <span>Theme</span><span className="theme-current">{themes[theme].name}</span>
    </button>
    <dialog className="theme-dialog" ref={dialog} aria-labelledby="theme-title"
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="dialog-content">
        <div className="theme-dialog-heading">
          <h2 id="theme-title">Themes</h2>
          <form method="dialog"><button className="icon-btn" aria-label="Close themes">×</button></form>
        </div>
        <div className="theme-options">
          <ThemeCard preview="minimal" name="Minimal" active={theme === 'minimal'} onClick={() => { setShowAnime(false); select('minimal'); }}/>
          <ThemeCard preview="anime-jjk" name="Anime Coded" expanded={showAnime} onClick={() => setShowAnime(true)}/>
          <ThemeCard preview="cute" name="Cute" active={theme === 'cute'} onClick={() => { setShowAnime(false); select('cute'); }}/>
        </div>
        {showAnime && <fieldset className="anime-options"><legend>Choose an anime</legend>
          <div className="theme-options">{anime.map(id =>
            <ThemeCard key={id} preview={id} name={themes[id].name} active={theme === id} onClick={() => select(id)}/>
          )}</div>
        </fieldset>}
        <label className="theme-mute"><input type="checkbox" checked={muted} onChange={event => mute(event.target.checked)}/> Mute theme sounds</label>
      </div>
    </dialog>
  </>;
}

function ThemeCard({ preview, name, active, expanded, onClick }: {
  preview: Theme; name: string; active?: boolean; expanded?: boolean; onClick: () => void;
}) {
  return <button className="theme-card" type="button" aria-pressed={active} aria-expanded={expanded} onClick={onClick}>
    <span className="theme-preview" data-preview={preview} aria-hidden="true"><i/><i/><i/></span>
    <span>{name}</span>
  </button>;
}

function CharacterScene({ id }: { id: Anime }) {
  const { character, name, art: filename } = themes[id];
  const [source, setSource] = useState('');
  useEffect(() => {
    let current = true;
    void art['./theme-assets/' + filename]?.().then(url => { if (current) setSource(url); }).catch(() => {});
    return () => { current = false; };
  }, [filename]);
  return <figure className="character-scene">
    <div className="character-aura" aria-hidden="true"><i/><i/><i/></div>
    {source ? <img src={source} alt={character} loading="lazy" decoding="async" onError={() => setSource('')}/>
      : <figcaption><span>{name}</span><strong>{character}</strong><small>Character artwork pending</small></figcaption>}
  </figure>;
}

const props = [
  { asset: 'tumbler', label: 'Wobble the tumbler' },
  { asset: 'kitty', label: 'Wave to the kitten' },
  { asset: 'squishy', label: 'Squeeze the plush' },
] as const;

function Sticker({ asset, label }: typeof props[number]) {
  const [reaction, setReaction] = useState(0);
  return <button className="desk-prop" data-prop={asset} type="button" aria-label={label}
    onClick={() => setReaction(value => value + 1)}>
    <span key={reaction} className={reaction ? 'prop-reaction' : undefined}>
      <img src={`/theme-stickers/${asset}.svg`} alt="" width="140" height="120" draggable={false}/>
    </span>
    {reaction > 0 && <i key={'spark-' + reaction} className="prop-spark" aria-hidden="true"/>}
  </button>;
}

export function ThemeHero({ theme, transition }: { theme: Theme; transition: number }) {
  const animeId = anime.find(id => id === theme);
  return <section className={'hero' + (animeId ? ' hero-anime' : theme === 'cute' ? ' hero-cute' : '')}>
    <h1>Exam <em>planner</em></h1>
    {animeId && <CharacterScene key={animeId} id={animeId}/>}
    {theme === 'cute' && <div className="cute-desk">{props.map(prop => <Sticker key={prop.asset} {...prop}/>)}</div>}
    {transition > 0 && <span key={transition} className="theme-transition" aria-hidden="true"/>}
  </section>;
}
