// Choose the first-paint loader before the app bundle starts. Home keeps its existing loader.
const pathname = window.location.pathname;
document.documentElement.dataset.sautiBootLoading = /^(?:\/|\/home\/?|\/app\/?)$/.test(pathname) ? 'home' : 'content';
