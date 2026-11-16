if (!document.querySelector('link[href^="/app/assets/rooms-chat.css"]')) {
  const roomInvitationStyles = document.createElement('link');
  roomInvitationStyles.rel = 'stylesheet';
  roomInvitationStyles.href = '/app/assets/rooms-chat.css?v=20261117-chat2';
  roomInvitationStyles.dataset.roomsInvitationsStyle = 'true';
  document.head.append(roomInvitationStyles);
}
