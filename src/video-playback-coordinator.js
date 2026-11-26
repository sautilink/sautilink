let activeVideo = null;
let activeAudio = null;

export function getActivePlaybackVideo() {
  return activeVideo;
}

export function installVideoPlaybackCoordinator(target = document) {
  const onPlay = (event) => {
    const video = event.target;
    if (!['VIDEO', 'AUDIO'].includes(video?.nodeName)) return;
    if (activeVideo && activeVideo !== video) activeVideo.pause();
    if (activeAudio && activeAudio !== video) activeAudio.pause();
    if (video.nodeName === 'VIDEO') { activeVideo = video; activeAudio = null; }
    else { activeAudio = video; activeVideo = null; }
  };
  const onPause = (event) => {
    if (event.target === activeVideo) activeVideo = null;
    if (event.target === activeAudio) activeAudio = null;
  };
  target.addEventListener('play', onPlay, true);
  target.addEventListener('pause', onPause, true);
  return () => {
    target.removeEventListener('play', onPlay, true);
    target.removeEventListener('pause', onPause, true);
    activeVideo = null;
    activeAudio = null;
  };
}
