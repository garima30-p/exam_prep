export const animeThemes = {
  'anime-jjk': {
    name: "Jujutsu Kaisen", sound: 'thunder', folder: 'jjk',
    characters: [
      { id: 'gojo', name: "Satoru Gojo" },
      { id: 'sukuna', name: "Ryomen Sukuna" },
      { id: 'yuji', name: "Yuji Itadori" },
      { id: 'megumi', name: "Megumi Fushiguro" },
      { id: 'nobara', name: "Nobara Kugisaki" },
      { id: 'toji', name: "Toji Fushiguro" },
      { id: 'nanami', name: "Kento Nanami" },
      { id: 'geto', name: "Suguru Geto" },
    ],
  },
  'anime-demon-slayer': {
    name: "Demon Slayer", sound: 'swish', folder: 'demon-slayer',
    characters: [
      { id: 'tanjiro', name: "Tanjiro Kamado" },
      { id: 'nezuko', name: "Nezuko Kamado" },
      { id: 'rengoku', name: "Kyojuro Rengoku" },
      { id: 'giyu', name: "Giyu Tomioka" },
      { id: 'shinobu', name: "Shinobu Kocho" },
      { id: 'tengen', name: "Tengen Uzui" },
      { id: 'muichiro', name: "Muichiro Tokito" },
      { id: 'akaza', name: "Akaza" },
    ],
  },
  'anime-aot': {
    name: "Attack on Titan", sound: 'impact', folder: 'aot',
    characters: [
      { id: 'eren', name: "Eren Yeager" },
      { id: 'levi', name: "Levi Ackerman" },
      { id: 'mikasa', name: "Mikasa Ackerman" },
      { id: 'armin', name: "Armin Arlert" },
      { id: 'erwin', name: "Erwin Smith" },
      { id: 'hange', name: "Hange Zoë" },
      { id: 'reiner', name: "Reiner Braun" },
      { id: 'annie', name: "Annie Leonhart" },
    ],
  },
} as const;

export type Anime = keyof typeof animeThemes;
export type Character = (typeof animeThemes)[Anime]['characters'][number];
export const animeIds = Object.keys(animeThemes) as Anime[];

export function characterImage(anime: Anime, character: Character) {
  return `/assets/anime/${animeThemes[anime].folder}/${character.id}.webp`;
}
