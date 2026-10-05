let activeVideo = null;

export function getActivePlaybackVideo() {
  return activeVideo;
}

export function installVideoPlaybackCoordinator(target = document) {
  const onPlay = (event) => {
    const video = event.target;
    if (video?.nodeName !== 'VIDEO') return;
    if (activeVideo && activeVideo !== video) activeVideo.pause();
    activeVideo = video;
  };
  const onPause = (event) => {
    if (event.target === activeVideo) activeVideo = null;
  };
  target.addEventListener('play', onPlay, true);
  target.addEventListener('pause', onPause, true);
  return () => {
    target.removeEventListener('play', onPlay, true);
    target.removeEventListener('pause', onPause, true);
    activeVideo = null;
  };
}
