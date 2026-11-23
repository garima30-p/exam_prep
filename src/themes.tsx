import { useEffect, useRef, useState } from 'react';
import { playThemeSound } from './theme-sound';
import { animeIds, animeThemes, characterImage } from './anime';
import type { Anime, Character } from './anime';

const themes = {
  minimal: { name: 'Minimal', sound: 'click' },
  ...animeThemes,
  cute: { name: 'Cute', sound: 'meow' },
} as const;

type Theme = keyof typeof themes;
const storageKey = 'in-nocent-theme';
const muteKey = 'in-nocent-theme-muted';
const characterKey = 'in-nocent-character:';

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
  const anime = animeIds.find(id => id === theme);
  const [favorites, setFavorites] = useState(() => Object.fromEntries(
    animeIds.map(id => [id, read(characterKey + id)])) as Record<Anime, string | null>);
  const character = anime && (animeThemes[anime].characters.find(person => person.id === favorites[anime])
    ?? animeThemes[anime].characters[0]);

  function selectCharacter(id: Anime, person: Character) {
    setFavorites(current => ({ ...current, [id]: person.id }));
    write(characterKey + id, person.id);
  }

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

  return { theme, anime, character, muted, transition, select, selectCharacter, mute };
}

export function ThemePicker({ theme, anime, character, muted, select, selectCharacter, mute }: ReturnType<typeof useTheme>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showAnime, setShowAnime] = useState(false);
  function open() {
    setShowAnime(Boolean(anime));
    dialog.current?.showModal();
  }

  function chooseTheme(next: 'minimal' | 'cute') {
    select(next);
    dialog.current?.close();
  }

  function chooseCharacter(id: Anime, person: Character) {
    selectCharacter(id, person);
    dialog.current?.close();
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
          <ThemeCard preview="minimal" name="Minimal" active={theme === 'minimal'} onClick={() => chooseTheme('minimal')}/>
          <ThemeCard preview="anime-jjk" name="Anime Coded" expanded={showAnime} onClick={() => setShowAnime(true)}/>
          <ThemeCard preview="cute" name="Cute" active={theme === 'cute'} onClick={() => chooseTheme('cute')}/>
        </div>
        {showAnime && <AnimeThemeSelector active={anime} character={character} select={select} selectCharacter={chooseCharacter}/>}
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

function AnimeThemeSelector({ active, character, select, selectCharacter }: {
  active?: Anime; character?: Character; select: (id: Anime) => void; selectCharacter: (id: Anime, person: Character) => void;
}) {
  return <>
    <fieldset className="anime-options"><legend>Choose an anime</legend>
      <div className="theme-options">{animeIds.map(id =>
        <ThemeCard key={id} preview={id} name={animeThemes[id].name} active={active === id} onClick={() => select(id)}/>
      )}</div>
    </fieldset>
    {active && <fieldset className="anime-options"><legend>Choose a character</legend>
      <div className="character-options">{animeThemes[active].characters.map(person =>
        <button key={person.id} className="theme-card character-card" type="button"
          aria-pressed={character?.id === person.id} onClick={() => selectCharacter(active, person)}>
          <AnimeCharacterDisplay anime={active} character={person} decorative/>
          <span>{person.name}</span>
        </button>
      )}</div>
    </fieldset>}
  </>;
}

export function AnimeCharacterDisplay({ anime, character, decorative = false, prominent = false }: {
  anime: Anime; character: Character; decorative?: boolean; prominent?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="character-fallback" aria-hidden={decorative || undefined}>{decorative ? '' : character.name}</span>
    : <img className="character-image" src={characterImage(anime, character)} alt={decorative ? '' : character.name}
        width="256" height="256" loading={prominent ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)}/>;
}

function AnimeAuraEffect() {
  return <div className="character-aura" aria-hidden="true"><i/><i/><i/></div>;
}

function CharacterScene({ anime, character }: { anime: Anime; character: Character }) {
  return <figure className="character-scene">
    <AnimeAuraEffect/>
    <div className="character-portrait">
      <AnimeCharacterDisplay anime={anime} character={character} prominent decorative/>
      <figcaption>{character.name}</figcaption>
    </div>
  </figure>;
}

export function StudyCharacter({ anime, character, pulse }: { anime: Anime; character: Character; pulse: number }) {
  return <div className="study-character">
    <AnimeCharacterDisplay key={character.id} anime={anime} character={character}/>
    {pulse > 0 && <span key={pulse} className="study-aura-pulse" aria-hidden="true"/>}
  </div>;
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

export function ThemeHero({theme,anime,character,transition,headline,compact}:Pick<ReturnType<typeof useTheme>,
  'theme'|'anime'|'character'|'transition'>&{headline?:string;compact:boolean}) {
  return <section className="hero">
    {headline&&<h1>{headline}</h1>}
    {!compact&&anime&&character&&<CharacterScene key={character.id} anime={anime} character={character}/>}
    {!compact&&theme==='cute'&&<div className="cute-desk">{props.map(prop=><Sticker key={prop.asset} {...prop}/>)}</div>}
    {theme!=='minimal'&&transition>0&&<span key={transition} className="theme-transition" aria-hidden="true"/>}
  </section>;
}
