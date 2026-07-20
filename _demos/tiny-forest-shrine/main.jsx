import { mountImmersiveLanding } from './immersive-landing-engine.js';
import './styles.css';

const MEDIA_ROOT = '/assets/demos/tiny-forest-shrine/immersive-landing';
const MEDIA_VERSION = '5';

const chapters = [
  {
    id: 'threshold',
    label: 'Threshold',
    accent: '#ee9b62',
    body: 'Red gate above clouds\nStone steps climb through lantern light\nPetals cross the dark',
    scroll: 1.7,
    linger: 0.24
  },
  {
    id: 'crossing',
    label: 'Crossing',
    accent: '#f0a45f',
    body: 'Red bridge over clouds\nLanterns follow stepping stones\nPink petals drift on',
    scroll: 1.55,
    linger: 0.28
  },
  {
    id: 'pond',
    label: 'Moon pond',
    accent: '#62c6bd',
    body: 'Koi circle the light\nSmall falls feed the floating pond\nClouds wait underneath',
    scroll: 1.65,
    linger: 0.34
  },
  {
    id: 'sakura',
    label: 'Sakura',
    accent: '#f0a2ad',
    body: 'Old roots guard the path\nPink branches shelter the stars\nSmall spirits wait near',
    scroll: 1.8,
    linger: 0.42
  },
  {
    id: 'grotto',
    label: 'Grotto',
    accent: '#6dd3ba',
    body: 'Green light fills the cave\nFour spirits ring the water\nThe shrine glows beyond',
    scroll: 1.55,
    linger: 0.32
  },
  {
    id: 'awakening',
    label: 'Awaken',
    accent: '#f3ad68',
    body: 'Lanterns wake the shrine\nSpirits rest among flowers\nFireflies fill the dark',
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
