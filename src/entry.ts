// Entry point. The page shell (header, controls, Help text) is plain HTML + CSS and paints first; the 3D engine (Three.js and the
// simulator, the bulk of the JavaScript) is loaded as a separate chunk right after, so it no longer blocks first paint.
import './style.css';

const status = document.getElementById('sceneLoading');
import('./main.ts')
  .then(() => status?.remove())
  .catch((error: unknown) => {
    console.error('Volta Lab: the 3D simulator failed to start', error);
    if (status) {
      status.setAttribute('role', 'alert');
      status.innerHTML = 'The 3D simulator could not start. It needs a browser with WebGL enabled. The <a href="/learn/">Learning Hub</a> works without it.';
    }
  });
