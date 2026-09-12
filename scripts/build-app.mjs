import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformBootstrapResilienceSource } from './bootstrap-resilience-source-transform.mjs';
import { transformMediaPerformanceSource } from './media-performance-source-transform.mjs';
import { transformMemberBootstrapResilienceSource } from './member-bootstrap-resilience-source-transform.mjs';
import { transformMentionNotificationSource } from './mention-notification-source-transform.mjs';
import { transformPostMediaSource } from './post-media-source-transform.mjs';
import { transformProfileTabIconsSource } from './profile-tab-icons-source-transform.mjs';
import { transformRoomsStartupIsolationSource } from './rooms-startup-isolation-source-transform.mjs';
import { transformVideoPlayerSource } from './video-player-source-transform.mjs';
import { transformWhatsAppOtpSource } from './whatsapp-otp-source-transform.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSourcePath = resolve(projectRoot, 'src/app.js');
const appSource = transformMemberBootstrapResilienceSource(
  appSourcePath,
  transformBootstrapResilienceSource(
    appSourcePath,
    transformWhatsAppOtpSource(
      appSourcePath,
      transformVideoPlayerSource(
        appSourcePath,
        transformMentionNotificationSource(
          appSourcePath,
          transformMediaPerformanceSource(
            appSourcePath,
            transformPostMediaSource(appSourcePath, await readFile(appSourcePath, 'utf8')),
          ),
        ),
      ),
    ),
  ),
);

const profileTabIconsPlugin = {
  name: 'profile-tab-icons',
  setup(buildApi) {
    buildApi.onLoad({ filter: /profile-activity\.js$/ }, async ({ path }) => ({
      contents: transformProfileTabIconsSource(path, await readFile(path, 'utf8')),
      loader: 'js',
    }));
  },
};

const roomsStartupIsolationPlugin = {
  name: 'rooms-startup-isolation',
  setup(buildApi) {
    buildApi.onLoad({ filter: /rooms-(?:platform|facebook-ui)\.js$/ }, async ({ path }) => ({
      contents: transformRoomsStartupIsolationSource(path, await readFile(path, 'utf8')),
      loader: 'js',
    }));
  },
};

await build({
  stdin: {
    contents: appSource,
    resolveDir: resolve(projectRoot, 'src'),
    sourcefile: 'src/app.js',
    loader: 'js',
  },
  inject: [
    resolve(projectRoot, 'src/language-preference.js'),
    resolve(projectRoot, 'src/post-translation.js'),
    resolve(projectRoot, 'src/caption-entities.js'),
    resolve(projectRoot, 'src/composer-formats.js'),
    resolve(projectRoot, 'src/username-login.js'),
    resolve(projectRoot, 'src/verified-identity-controls.js'),
    resolve(projectRoot, 'src/profile-activity.js'),
    resolve(projectRoot, 'src/profile-route-states.js'),
    resolve(projectRoot, 'src/profile-x-ui.js'),
    resolve(projectRoot, 'src/professional-profile-category.js'),
    resolve(projectRoot, 'src/profile-media-upload-icons.js'),
    resolve(projectRoot, 'src/home-feed-author-profile-links.js'),
    resolve(projectRoot, 'src/messages-whatsapp-ui.js'),
    resolve(projectRoot, 'src/rooms-platform.js'),
    resolve(projectRoot, 'src/room-post-images.js'),
    resolve(projectRoot, 'src/rooms-invitations-style.js'),
    resolve(projectRoot, 'src/rooms-invitations.js'),
    resolve(projectRoot, 'src/rooms-facebook-ui.js'),
    resolve(projectRoot, 'src/mobile-nav-icon-style.js'),
    resolve(projectRoot, 'src/mobile-more-drawer.js'),
    resolve(projectRoot, 'src/post-media-carousel.js'),
    resolve(projectRoot, 'src/short-videos-feed.js'),
    resolve(projectRoot, 'src/social-oauth-auth.js'),
    resolve(projectRoot, 'src/whatsapp-otp-auth.js'),
    resolve(projectRoot, 'src/sautilink-video-player.js'),
  ],
  plugins: [profileTabIconsPlugin, roomsStartupIsolationPlugin],
  outfile: resolve(projectRoot, 'app/assets/app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
});