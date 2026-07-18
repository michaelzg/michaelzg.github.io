import { mountImmersiveLanding } from './immersive-landing-engine.js';
import './styles.css';

const MEDIA_ROOT = '/assets/demos/tiny-forest-shrine/immersive-landing';
const MEDIA_VERSION = '5';

const chapters = [
  {
    id: 'threshold',
    label: 'Threshold',
    accent: '#ee9b62',
    eyebrow: 'The threshold',
    title: 'Tiny Forest Shrine',
    body: 'A handcrafted storybook world, connected by lantern light and explored one quiet scroll at a time.',
    tags: ['Scroll-scrubbed', 'Hand-painted'],
    scroll: 1.7,
    linger: 0.24
  },
  {
    id: 'crossing',
    label: 'Crossing',
    accent: '#f0a45f',
    eyebrow: 'Follow the lanterns',
    title: 'A path suspended in dusk.',
    body: 'Every uneven stone, warm window and curved bridge points toward the next pocket of the world.',
    tags: ['Golden hour', 'Connected flight'],
    scroll: 1.55,
    linger: 0.28
  },
  {
    id: 'pond',
    label: 'Moon pond',
    accent: '#62c6bd',
    eyebrow: 'The moon pond',
    title: 'The water remembers motion.',
    body: 'Koi circle beneath ripples while tiny falls disappear into clouds. Nothing is ever perfectly still.',
    tags: ['Water study', 'Ambient motion'],
    scroll: 1.65,
    linger: 0.34
  },
  {
    id: 'sakura',
    label: 'Sakura',
    accent: '#f0a2ad',
    eyebrow: 'The ancient canopy',
    title: 'A held breath in blossom.',
    body: 'The old sakura leans into the light. Petals carry the route onward, from warm amber into indigo.',
    tags: ['Painterly light', 'Soft parallax'],
    scroll: 1.8,
    linger: 0.42
  },
  {
    id: 'grotto',
    label: 'Grotto',
    accent: '#6dd3ba',
    eyebrow: 'The spirit grotto',
    title: 'Some visitors are shy.',
    body: 'Behind moss and mushrooms, the smallest forest spirits gather where the cool water glows.',
    tags: ['Original spirits', 'Twilight palette'],
    scroll: 1.55,
    linger: 0.32
  },
  {
    id: 'awakening',
    label: 'Awaken',
    accent: '#f3ad68',
    eyebrow: 'The awakening',
    title: 'The little shrine answers.',
    body: 'Lanterns kindle. Fireflies rise. For a few luminous seconds, the whole forest leans closer.',
    tags: ['Final state', 'Scroll to replay'],
    scroll: 1.9,
    linger: 0.5,
    cta: {
      primary: { label: 'Wander again', href: '#tiny-forest-shrine' },
      secondary: { label: 'Back to projects', href: '/projects/' }
    }
  }
].map((chapter, index) => {
  const file = [
    '01-threshold',
    '02-lantern-crossing',
    '03-moon-pond',
    '04-ancient-sakura',
    '05-spirit-grotto',
    '06-awakened-shrine'
  ][index];

  return {
    ...chapter,
    still: `${MEDIA_ROOT}/stills/${file}.webp?v=${MEDIA_VERSION}`,
    stillMobile: `${MEDIA_ROOT}/stills/${file}-mobile.webp?v=${MEDIA_VERSION}`,
    clip: `${MEDIA_ROOT}/vid/${file}.mp4?v=${MEDIA_VERSION}`,
    clipMobile: `${MEDIA_ROOT}/vid/${file}-mobile.mp4?v=${MEDIA_VERSION}`
  };
});

const root = document.getElementById('tiny-forest-shrine-root');

if (root) {
  root.replaceChildren();
  root.classList.add('shrine-immersive-landing');
  root.setAttribute('aria-label', 'Tiny Forest Shrine scroll story');

  mountImmersiveLanding(root, {
    hint: 'scroll to follow the lanterns',
    crossfade: 0.22,
    sections: chapters
  });

  const meta = document.createElement('div');
  meta.className = 'shrine-immersive-meta';
  meta.setAttribute('aria-hidden', 'true');
  meta.innerHTML = '<span>Scroll film</span><i></i><span>01—06</span>';
  root.appendChild(meta);

  const replay = root.querySelector('.sw-btn--primary');
  replay?.addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  });
}
